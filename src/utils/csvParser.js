const { Readable } = require('stream');
const csv = require('csv-parser');

/**
 * Parses a CSV buffer into structured log objects.
 * Maps common CSV column names (timestamp, level, message, service) flexibly.
 */
function parseCSVBuffer(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString());

    stream
      .pipe(csv())
      .on('data', (row) => {
        // Normalize column keys (case-insensitive)
        const normalized = {};
        for (const [key, val] of Object.entries(row)) {
          normalized[key.trim().toLowerCase()] = val ? val.trim() : '';
        }

        const logEntry = {
          timestamp:
            normalized.timestamp ||
            normalized.time ||
            normalized.date ||
            normalized.datetime ||
            new Date().toISOString(),
          level: (
            normalized.level ||
            normalized.severity ||
            normalized.status ||
            'INFO'
          ).toUpperCase(),
          service:
            normalized.service ||
            normalized.source ||
            normalized.app ||
            'default-service',
          message:
            normalized.message ||
            normalized.msg ||
            normalized.log ||
            normalized.error ||
            JSON.stringify(row),
          metadata: row
        };

        results.push(logEntry);
      })
      .on('end', () => resolve(results))
      .on('error', (err) => reject(err));
  });
}

module.exports = { parseCSVBuffer };