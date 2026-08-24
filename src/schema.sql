-- Raw ingested log entries
CREATE TABLE IF NOT EXISTS logs (
  id            SERIAL PRIMARY KEY,
  timestamp     TIMESTAMPTZ NOT NULL,
  source        TEXT NOT NULL,          -- e.g. IP address / service name
  event_type    TEXT NOT NULL,          -- e.g. GET /api/users, LOGIN, PAYMENT
  severity      TEXT NOT NULL,          -- info | warning | error | critical
  status_code   INTEGER,                -- optional HTTP-style status code
  message       TEXT,
  raw           JSONB,                  -- original raw entry as received
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs (timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_source ON logs (source);

-- Anomaly detection results (one row per flagged log)
CREATE TABLE IF NOT EXISTS flagged_logs (
  id                SERIAL PRIMARY KEY,
  log_id            INTEGER NOT NULL REFERENCES logs(id) ON DELETE CASCADE,
  score             NUMERIC NOT NULL,          -- 0..1 anomaly score
  reasons           JSONB NOT NULL,            -- list of rule codes that triggered
  reason_summary    TEXT,                      -- short human-readable reason (non-AI)
  ai_explanation    TEXT,                      -- AI-generated plain english explanation
  ai_root_cause     TEXT,                      -- AI-generated likely root cause / next step
  ai_generated_at   TIMESTAMPTZ,
  ai_status         TEXT NOT NULL DEFAULT 'pending', -- pending | ok | failed
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(log_id)
);

-- Entries that failed basic validation (quarantined, not deleted)
CREATE TABLE IF NOT EXISTS rejected_logs (
  id            SERIAL PRIMARY KEY,
  raw           JSONB NOT NULL,
  errors        JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
