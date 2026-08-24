const VALID_SEVERITIES = new Set(["info", "warning", "error", "critical"]);

// Normalizes + validates a single incoming raw log entry.
// Returns { ok: true, value } or { ok: false, errors }
export function validateLogEntry(raw) {
  const errors = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["entry is not a JSON object"] };
  }

  // timestamp
  let timestamp = raw.timestamp ?? raw.time ?? raw.ts;
  if (!timestamp) {
    errors.push("missing timestamp");
  } else {
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) {
      errors.push(`malformed timestamp: ${JSON.stringify(timestamp)}`);
    } else {
      timestamp = d.toISOString();
    }
  }

  // source (IP / service name)
  const source = raw.source ?? raw.ip ?? raw.ip_address ?? raw.host;
  if (!source || typeof source !== "string" || !source.trim()) {
    errors.push("missing source/ip");
  }

  // event type
  const eventType =
    raw.event_type ?? raw.eventType ?? raw.event ?? raw.request ?? raw.path;
  if (!eventType || typeof eventType !== "string" || !eventType.trim()) {
    errors.push("missing event_type");
  }

  // severity - derive from status code if absent
  let severity = (raw.severity ?? raw.level ?? "").toString().toLowerCase();
  const statusCode = raw.status_code ?? raw.status ?? raw.statusCode ?? null;
  if (!VALID_SEVERITIES.has(severity)) {
    severity = deriveSeverityFromStatus(statusCode);
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      timestamp,
      source: String(source).trim(),
      event_type: String(eventType).trim(),
      severity,
      status_code:
        statusCode !== null && statusCode !== undefined && statusCode !== ""
          ? Number(statusCode)
          : null,
      message: raw.message ?? raw.msg ?? null,
      raw,
    },
  };
}

function deriveSeverityFromStatus(statusCode) {
  const code = Number(statusCode);
  if (!Number.isFinite(code)) return "info";
  if (code >= 500) return "critical";
  if (code >= 400) return "error";
  if (code >= 300) return "warning";
  return "info";
}

// Validates an array (or single object) payload, splitting into valid/rejected.
export function validateBatch(payload) {
  const entries = Array.isArray(payload) ? payload : [payload];
  const valid = [];
  const rejected = [];

  if (entries.length === 0) {
    return { valid, rejected, empty: true };
  }

  for (const entry of entries) {
    const result = validateLogEntry(entry);
    if (result.ok) {
      valid.push(result.value);
    } else {
      rejected.push({ raw: entry, errors: result.errors });
    }
  }

  return { valid, rejected, empty: false };
}
