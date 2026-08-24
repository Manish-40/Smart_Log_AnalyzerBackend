/**
 * Generates a synthetic dataset (mostly-normal entries + a handful of
 * injected anomalies) and posts it to the running API's /api/logs endpoint.
 *
 * Usage:
 *   API_URL=http://localhost:8080 npm run seed
 */
import "dotenv/config";

const API_URL = process.env.API_URL || `http://localhost:${process.env.PORT || 8080}`;

const NORMAL_SOURCES = ["192.168.1.14", "192.168.1.22", "10.0.0.55", "10.0.0.61"];
const NORMAL_EVENTS = [
  { event: "GET /api/users", status: 200 },
  { event: "GET /api/orders", status: 200 },
  { event: "POST /api/orders", status: 201 },
  { event: "GET /api/products", status: 200 },
  { event: "PUT /api/profile", status: 200 },
  { event: "GET /api/orders/9981", status: 404 },
];

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function isoAt(baseMs, offsetSeconds) {
  return new Date(baseMs + offsetSeconds * 1000).toISOString();
}

function buildDataset() {
  const base = Date.parse("2026-08-20T09:00:00Z");
  const entries = [];
  let t = 0;

  // ~180 mostly-normal entries spread over ~40 minutes
  for (let i = 0; i < 180; i++) {
    t += 10 + Math.floor(Math.random() * 15);
    const { event, status } = randomChoice(NORMAL_EVENTS);
    entries.push({
      timestamp: isoAt(base, t),
      source: randomChoice(NORMAL_SOURCES),
      event_type: event,
      status_code: status,
      severity: status >= 500 ? "critical" : status >= 400 ? "error" : "info",
      message: `${event} — ${status}`,
    });
  }

  // Anomaly 1: brute-force style rate spike from a single IP hitting /login
  const attackerIp = "203.0.113.7";
  const spikeStart = t + 30;
  for (let i = 0; i < 40; i++) {
    entries.push({
      timestamp: isoAt(base, spikeStart + i * 0.5),
      source: attackerIp,
      event_type: "POST /api/login",
      status_code: 401,
      severity: "warning",
      message: "POST /api/login — invalid credentials",
    });
  }

  // Anomaly 2: internal server errors from the payment service
  for (let i = 0; i < 4; i++) {
    entries.push({
      timestamp: isoAt(base, spikeStart + 60 + i * 5),
      source: "10.0.0.55",
      event_type: "POST /api/payment",
      status_code: 500,
      severity: "critical",
      message: "POST /api/payment — internal server error",
    });
  }

  // Anomaly 3: off-hours admin access denied
  const offHoursBase = Date.parse("2026-08-21T03:12:00Z");
  entries.push({
    timestamp: new Date(offHoursBase).toISOString(),
    source: "198.51.100.23",
    event_type: "GET /admin/config",
    status_code: 403,
    severity: "error",
    message: "GET /admin/config — access denied",
  });

  // Anomaly 4: a rare event type that appears exactly once
  entries.push({
    timestamp: isoAt(base, spikeStart + 200),
    source: "10.0.0.61",
    event_type: "DELETE /api/admin/export-database",
    status_code: 200,
    severity: "warning",
    message: "DELETE /api/admin/export-database — completed",
  });

  // A couple of intentionally malformed entries to exercise validation
  entries.push({ source: "10.0.0.61", event_type: "GET /api/users" }); // missing timestamp
  entries.push({ timestamp: "not-a-date", source: "10.0.0.61", event_type: "GET /api/users" });

  return entries;
}

async function main() {
  const dataset = buildDataset();
  console.log(`Posting ${dataset.length} synthetic log entries to ${API_URL}/api/logs ...`);

  const res = await fetch(`${API_URL}/api/logs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(dataset),
  });

  const body = await res.json();
  console.log(`Status: ${res.status}`);
  console.log(body);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
