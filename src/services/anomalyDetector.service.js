/**
 * Rule-based + statistical anomaly detector.
 *
 * This is intentionally NOT AI-driven: every flag comes from a deterministic
 * rule or a simple statistical test over the dataset. The AI layer (see
 * ai.service.js) only explains entries that this module has already flagged.
 *
 * Rules implemented:
 *  1. severity_critical / severity_error   - direct severity weight
 *  2. rate_spike                           - source sends far more requests
 *                                             in a 60s window than the norm
 *                                             (z-score over all source/window
 *                                             buckets)
 *  3. rare_event_type                      - event type that almost never
 *                                             occurs in the dataset
 *  4. sensitive_endpoint                   - error/warning on a
 *                                             sensitive-looking path
 *  5. off_hours                            - non-info severity outside
 *                                             typical business hours (UTC)
 *
 * Each triggered rule contributes a weight; weights are summed and clipped
 * to [0, 1] to produce a final anomaly score. A log is "flagged" when its
 * score >= FLAG_THRESHOLD.
 */

const FLAG_THRESHOLD = 0.45;

const RULE_WEIGHTS = {
  severity_critical: 0.5,
  severity_error: 0.3,
  severity_warning: 0.1,
  rate_spike: 0.6,
  rare_event_type: 0.35,
  sensitive_endpoint: 0.35,
  off_hours: 0.15,
};

const SENSITIVE_PATTERN = /admin|config|password|secret|token|delete|drop|root|shutdown|export/i;
const WINDOW_MS = 60 * 1000; // 1 minute buckets for rate-spike detection
const MIN_LOGS_FOR_RARITY = 20; // don't run rarity check on tiny datasets
const RARE_EVENT_FRACTION = 0.02; // event types under 2% of volume are "rare"

/**
 * @param {Array<{id:number|string, timestamp:string, source:string, event_type:string, severity:string, status_code:?number}>} logs
 * @returns {Map<id, {score:number, reasons:string[], reasonSummary:string}>}
 */
export function detectAnomalies(logs) {
  const results = new Map();
  if (!logs.length) return results;

  const eventTypeFreq = buildFrequencyMap(logs, (l) => l.event_type);
  const rateSpikeIds = detectRateSpikes(logs);

  for (const log of logs) {
    const reasons = [];
    let score = 0;

    if (log.severity === "critical") {
      reasons.push("severity_critical");
      score += RULE_WEIGHTS.severity_critical;
    } else if (log.severity === "error") {
      reasons.push("severity_error");
      score += RULE_WEIGHTS.severity_error;
    } else if (log.severity === "warning") {
      reasons.push("severity_warning");
      score += RULE_WEIGHTS.severity_warning;
    }

    if (rateSpikeIds.has(log.id)) {
      reasons.push("rate_spike");
      score += RULE_WEIGHTS.rate_spike;
    }

    if (
      logs.length >= MIN_LOGS_FOR_RARITY &&
      eventTypeFreq.get(log.event_type) / logs.length < RARE_EVENT_FRACTION
    ) {
      reasons.push("rare_event_type");
      score += RULE_WEIGHTS.rare_event_type;
    }

    if (
      SENSITIVE_PATTERN.test(log.event_type) &&
      log.severity !== "info"
    ) {
      reasons.push("sensitive_endpoint");
      score += RULE_WEIGHTS.sensitive_endpoint;
    }

    if (isOffHours(log.timestamp) && log.severity !== "info") {
      reasons.push("off_hours");
      score += RULE_WEIGHTS.off_hours;
    }

    score = Math.min(1, Number(score.toFixed(3)));

    if (score >= FLAG_THRESHOLD && reasons.length) {
      results.set(log.id, {
        score,
        reasons,
        reasonSummary: buildReasonSummary(log, reasons),
      });
    }
  }

  return results;
}

function buildFrequencyMap(logs, keyFn) {
  const map = new Map();
  for (const log of logs) {
    const key = keyFn(log);
    map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

function isOffHours(timestamp) {
  const hour = new Date(timestamp).getUTCHours();
  return hour < 5 || hour >= 22;
}

// Buckets requests per (source, 60s window), then flags entries in buckets
// whose count is a statistical outlier (z-score > 3) relative to all buckets.
function detectRateSpikes(logs) {
  const buckets = new Map(); // bucketKey -> [logIds]

  for (const log of logs) {
    const t = new Date(log.timestamp).getTime();
    if (isNaN(t)) continue;
    const bucketStart = Math.floor(t / WINDOW_MS);
    const key = `${log.source}::${bucketStart}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(log.id);
  }

  const counts = [...buckets.values()].map((ids) => ids.length);
  if (counts.length < 3) return new Set(); // not enough buckets for stats

  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance =
    counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
  const std = Math.sqrt(variance);

  const flaggedIds = new Set();
  if (std === 0) return flaggedIds;

  for (const ids of buckets.values()) {
    const z = (ids.length - mean) / std;
    // Only flag genuine bursts, not just any bucket with >1 entries
    if (z > 3 && ids.length >= 5) {
      ids.forEach((id) => flaggedIds.add(id));
    }
  }

  return flaggedIds;
}

function buildReasonSummary(log, reasons) {
  const labels = {
    severity_critical: "critical severity",
    severity_error: "error severity",
    severity_warning: "warning severity",
    rate_spike: `unusually high request volume from ${log.source}`,
    rare_event_type: `rarely seen event type "${log.event_type}"`,
    sensitive_endpoint: `error/warning on sensitive-looking endpoint "${log.event_type}"`,
    off_hours: "occurred outside typical business hours",
  };
  return reasons.map((r) => labels[r] ?? r).join("; ");
}

export const ANOMALY_CONFIG = { FLAG_THRESHOLD, RULE_WEIGHTS };
