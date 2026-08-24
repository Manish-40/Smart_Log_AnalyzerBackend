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
});

let initPromise = null;

// Runs schema.sql once (idempotent thanks to IF NOT EXISTS). Safe to call
// on every cold start of a serverless function.
export function ensureSchema() {
  if (!initPromise) {
    const schema = fs.readFileSync(
      path.join(__dirname, "schema.sql"),
      "utf8"
    );
    initPromise = pool.query(schema).catch((err) => {
      initPromise = null; // allow retry on next request
      throw err;
    });
  }
  return initPromise;
}
