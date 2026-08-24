import * as logsService from "../services/logs.service.js";

export async function uploadLogs(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No log file uploaded' });
    }

    let parsedLogs = [];
    const isCSV =
      req.file.mimetype === 'text/csv' ||
      req.file.originalname.toLowerCase().endsWith('.csv');

    if (isCSV) {
      parsedLogs = await parseCSVBuffer(req.file.buffer);
    } else if (req.file.originalname.toLowerCase().endsWith('.json')) {
      parsedLogs = JSON.parse(req.file.buffer.toString('utf-8'));
      if (!Array.isArray(parsedLogs)) parsedLogs = [parsedLogs];
    } else {
      // Plaintext/raw log parser
      parsedLogs = logsService.parseRawTextLogs(req.file.buffer.toString('utf-8'));
    }

    if (!parsedLogs.length) {
      return res.status(400).json({ error: 'No valid log entries found in file' });
    }

    const savedLogs = await logsService.insertBatch(parsedLogs);
    return res.status(200).json({
      success: true,
      count: savedLogs.length,
      logs: savedLogs
    });
  } catch (error) {
    console.error('Log upload error:', error);
    return res.status(500).json({ error: error.message });
  }
}

export async function postLogs(req, res) {
  try {
    console.log("hit")
    const result = await logsService.ingestLogs(req.body);
    console.log("result ", result);
    if (result.empty) {
      return res.status(400).json({ error: "Empty dataset: no log entries were provided." });
    }
    console.log("result ", result)
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
