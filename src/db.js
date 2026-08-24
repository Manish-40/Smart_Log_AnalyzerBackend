import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  console.warn(
    "[db] DATABASE_URL is not set. Set it in your .env (see .env.example)."
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("sslmode=require")
    ? { rejectUnauthorized: false }
    : undefined,
  max: 5,
  // Without this, idle-but-open connections keep the Node event loop
  // non-empty, so the Vercel/Lambda function never finalizes its response
  // and the request just hangs until it times out. This tells pg it's ok
  // to let the process exit once all clients are idle.
  allowExitOnIdle: true,
});

let initPromise = null;

// Arbitrary fixed number used as the advisory lock key. Any bigint works,
// it just needs to be consistent across all instances of this app.
const SCHEMA_LOCK_KEY = 727271;

// Runs schema.sql once per warm instance (cached in initPromise). Guarded
// by a Postgres advisory lock so that concurrent COLD STARTS -- which each
// have their own initPromise = null -- don't race to run
// `CREATE TABLE IF NOT EXISTS` at the same time. That race is what caused
// the intermittent "type already exists" (42710) error: Postgres auto-
// creates a row type alongside every table, and IF NOT EXISTS is not
// concurrency-safe against that.
export function ensureSchema() {
  if (!initPromise) {
    initPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK_KEY]);
        const schema = fs.readFileSync(
          path.join(__dirname, "schema.sql"),
          "utf8"
        );
        await client.query(schema);
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK_KEY]);
        client.release();
      }
    })().catch((err) => {
      initPromise = null; // allow retry on next request
      throw err;
    });
  }
  return initPromise;
}