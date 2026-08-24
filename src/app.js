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

// IMPORTANT: health check MUST be before database middleware
app.get("/api/health", (req, res) => {
  console.log("[health check] /api/health");

  res.status(200).json({
    ok: true,
    service: "smart-log-analyzer-backend",
    uptime: process.uptime()
  });
});

// Database initialization only for actual API requests
app.use(async (req, res, next) => {
  try {
    await ensureSchema();

    console.log(
      "[schema init] schema exists, proceeding to request handler"
    );

    next();
  } catch (err) {
    console.error("[schema init]", err);

    return res.status(500).json({
      error: "Database not reachable",
      detail: err.message,
    });
  }
});

app.use("/api", logsRouter);

app.use((req, res) => {
  res.status(404).json({
    error: "Not found",
  });
});

export default app;