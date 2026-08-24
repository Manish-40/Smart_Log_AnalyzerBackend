import express from "express";
import cors from "cors";
import "dotenv/config";
import logsRouter from "./routes/logs.routes.js";
import { ensureSchema } from "./db.js";

const app = express();

const allowedOrigins = (process.env.CORS_ORIGIN || "*")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
  })
);
app.use(express.json({ limit: "5mb" }));

// Make sure tables exist before handling any request (cheap no-op after
// the first successful run, since schema.sql uses IF NOT EXISTS).
app.use(async (req, res, next) => {
  try {
    await ensureSchema();
    next();
  } catch (err) {
    console.error("[schema init]", err);
    res.status(500).json({ error: "Database not reachable", detail: err.message });
  }
});

app.get("/api/health", (req, res) => res.json({ ok: true }));
app.use("/api", logsRouter);

app.use((req, res) => res.status(404).json({ error: "Not found" }));

export default app;
