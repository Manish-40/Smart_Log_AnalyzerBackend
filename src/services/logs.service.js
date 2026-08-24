import { pool } from "../db.js";
import { validateBatch } from "../utils/validate.js";
import { detectAnomalies } from "./anomalyDetector.service.js";
import { explainFlaggedLog } from "./ai.service.js";

const AI_BATCH_LIMIT = 40; // cap synchronous AI calls per ingest request

/**
 * Validates, persists, runs anomaly detection, and (best-effort) generates
 * AI explanations for newly flagged entries.
 */
export async function ingestLogs(payload) {
  // console.log("ingestLogs payload ", payload);
  const { valid, rejected, empty } = validateBatch(payload);
  console.log("valid ", valid.length);
  console.log("rejected ", rejected);
  console.log("empty ", empty);
  if (empty) {
    console.log("empty dataset, returning early");
    return { insertedCount: 0, rejectedCount: 0, flaggedCount: 0, empty: true };
  }

  if (rejected.length) {
    console.log("inserting rejected logs ", rejected.length);
    await Promise.all(
      rejected.map((r) =>
        pool.query(
          `INSERT INTO rejected_logs (raw, errors) VALUES ($1, $2)`,
          [r.raw, JSON.stringify(r.errors)]
        )
      )
    );
  }

  if (!valid.length) {
    console.log("no valid logs to insert, returning early");
    return {
      insertedCount: 0,
      rejectedCount: rejected.length,
      flaggedCount: 0,
      empty: false,
    };
  }

  // Replace the entire sequential for loop with chunked batch inserts
const CHUNK_SIZE = 500;
const insertedIds = [];

for (let i = 0; i < valid.length; i += CHUNK_SIZE) {
  const chunk = valid.slice(i, i + CHUNK_SIZE);
  const values = [];
  const valueRows = [];

  chunk.forEach((entry, rowIdx) => {
    const baseIndex = rowIdx * 7;
    valueRows.push(
      `($${baseIndex + 1}, $${baseIndex + 2}, $${baseIndex + 3}, $${baseIndex + 4}, $${baseIndex + 5}, $${baseIndex + 6}, $${baseIndex + 7})`
    );
    values.push(
      entry.timestamp,
      entry.source,
      entry.event_type,
      entry.severity,
      entry.status_code,
      entry.message,
      entry.raw
    );
  });

  const query = `
    INSERT INTO logs (timestamp, source, event_type, severity, status_code, message, raw)
    VALUES ${valueRows.join(", ")}
    RETURNING id
  `;

  const { rows } = await pool.query(query, values);
  rows.forEach((r) => insertedIds.push(r.id));
}

console.log("insertedIds count:", insertedIds.length);
  console.log("insertedIds ", insertedIds);

  // Run detection against the full dataset so statistical rules (rate
  // spikes, rarity) have real context, not just the current batch.
  const { rows: allLogs } = await pool.query(
    `SELECT id, timestamp, source, event_type, severity, status_code FROM logs`
  );
  console.log("allLogs ", allLogs);
  const anomalies = detectAnomalies(allLogs);
  console.log("anomalies ", anomalies.size, anomalies);
  const newlyFlagged = insertedIds.filter((id) => anomalies.has(id));

  for (const id of newlyFlagged) {
    const flag = anomalies.get(id);
    await pool.query(
      `INSERT INTO flagged_logs (log_id, score, reasons, reason_summary, ai_status)
       VALUES ($1, $2, $3, $4, 'pending')
       ON CONFLICT (log_id) DO UPDATE SET score = $2, reasons = $3, reason_summary = $4`,
      [id, flag.score, JSON.stringify(flag.reasons), flag.reasonSummary]
    ).catch((err) => {
      console.error(`Failed to insert/update flagged log for id ${id}:`, err);
    });
  }

  // Best-effort AI explanations for the first N newly flagged entries.
  // Failures are recorded per-row, never thrown - ingestion should not fail
  // just because the AI call failed.
  const toExplain = newlyFlagged.slice(0, AI_BATCH_LIMIT);
  console.log(`Generating AI explanations for ${toExplain.length} flagged logs...`);
  await Promise.all(toExplain.map((id) => generateExplanationForLog(id)));

  return {
    insertedCount: valid.length,
    rejectedCount: rejected.length,
    flaggedCount: newlyFlagged.length,
    empty: false,
  };
}

export async function generateExplanationForLog(logId) {
  const { rows } = await pool.query(
    `SELECT l.*, f.score, f.reasons, f.reason_summary
     FROM logs l JOIN flagged_logs f ON f.log_id = l.id
     WHERE l.id = $1`,
    [logId]
  );
  const row = rows[0];
  if (!row) return;

  try {
    const { explanation, rootCause } = await explainFlaggedLog(row, {
      score: row.score,
      reasons: row.reasons,
      reasonSummary: row.reason_summary,
    });
    await pool.query(
      `UPDATE flagged_logs
       SET ai_explanation = $1, ai_root_cause = $2, ai_status = 'ok', ai_generated_at = now()
       WHERE log_id = $3`,
      [explanation, rootCause, logId]
    );
  } catch (err) {
    await pool.query(
      `UPDATE flagged_logs SET ai_status = 'failed' WHERE log_id = $1`,
      [logId]
    );
  }
}

export async function listLogs({
  flaggedOnly = false,
  severity = null,
  source = null,
  search = null,
  page = 1,
  pageSize = 25,
} = {}) {
  const conditions = [];
  const params = [];

  if (severity) {
    params.push(severity);
    conditions.push(`l.severity = $${params.length}`);
  }
  if (source) {
    params.push(`%${source}%`);
    conditions.push(`l.source ILIKE $${params.length}`);
  }
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(l.event_type ILIKE $${params.length} OR l.message ILIKE $${params.length})`);
  }
  if (flaggedOnly) {
    conditions.push(`f.log_id IS NOT NULL`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const offset = (Math.max(1, page) - 1) * pageSize;

  params.push(pageSize, offset);

  const { rows } = await pool.query(
    `SELECT l.*, f.score, f.reasons, f.reason_summary, f.ai_explanation,
            f.ai_root_cause, f.ai_status
     FROM logs l
     LEFT JOIN flagged_logs f ON f.log_id = l.id
     ${where}
     ORDER BY l.timestamp DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const { rows: countRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM logs l LEFT JOIN flagged_logs f ON f.log_id = l.id ${where}`,
    params.slice(0, params.length - 2)
  );

  return { logs: rows, total: countRows[0].count, page, pageSize };
}

export async function getLogDetail(id) {
  const { rows } = await pool.query(
    `SELECT l.*, f.score, f.reasons, f.reason_summary, f.ai_explanation,
            f.ai_root_cause, f.ai_status, f.ai_generated_at
     FROM logs l LEFT JOIN flagged_logs f ON f.log_id = l.id
     WHERE l.id = $1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function getStats() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM logs)::int AS total_logs,
      (SELECT COUNT(*) FROM flagged_logs)::int AS total_flagged,
      (SELECT COUNT(*) FROM rejected_logs)::int AS total_rejected,
      (SELECT COALESCE(json_agg(t), '[]') FROM (
        SELECT severity, COUNT(*)::int AS count FROM logs GROUP BY severity
      ) t) AS by_severity
  `);
  return rows[0];
}

export async function retryExplanation(logId) {
  await pool.query(`UPDATE flagged_logs SET ai_status = 'pending' WHERE log_id = $1`, [logId]);
  await generateExplanationForLog(logId);
  return getLogDetail(logId);
}
