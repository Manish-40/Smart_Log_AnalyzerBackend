import * as logsService from "../services/logs.service.js";

export async function postLogs(req, res) {
  try {
    const result = await logsService.ingestLogs(req.body);
    if (result.empty) {
      return res.status(400).json({ error: "Empty dataset: no log entries were provided." });
    }
    res.status(201).json(result);
  } catch (err) {
    console.error("[postLogs]", err);
    res.status(500).json({ error: "Failed to ingest logs", detail: err.message });
  }
}

export async function getLogs(req, res) {
  try {
    const {
      flagged,
      severity,
      source,
      search,
      page = "1",
      pageSize = "25",
    } = req.query;

    const result = await logsService.listLogs({
      flaggedOnly: flagged === "true",
      severity: severity || null,
      source: source || null,
      search: search || null,
      page: Number(page) || 1,
      pageSize: Math.min(100, Number(pageSize) || 25),
    });
    res.json(result);
  } catch (err) {
    console.error("[getLogs]", err);
    res.status(500).json({ error: "Failed to fetch logs", detail: err.message });
  }
}

export async function getLogById(req, res) {
  try {
    const log = await logsService.getLogDetail(Number(req.params.id));
    if (!log) return res.status(404).json({ error: "Log not found" });
    res.json(log);
  } catch (err) {
    console.error("[getLogById]", err);
    res.status(500).json({ error: "Failed to fetch log", detail: err.message });
  }
}

export async function retryExplanation(req, res) {
  try {
    const log = await logsService.retryExplanation(Number(req.params.id));
    res.json(log);
  } catch (err) {
    console.error("[retryExplanation]", err);
    res.status(500).json({ error: "Failed to generate explanation", detail: err.message });
  }
}

export async function getStats(req, res) {
  try {
    const stats = await logsService.getStats();
    res.json(stats);
  } catch (err) {
    console.error("[getStats]", err);
    res.status(500).json({ error: "Failed to fetch stats", detail: err.message });
  }
}
