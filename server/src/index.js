import "dotenv/config";
import { randomUUID } from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./db.js";
import { authRouter } from "./auth.js";
import { clinicRouter } from "./routes/clinic.js";
const app = express();
const requestCounts = new Map();
const port = Number(process.env.PORT) || 3000;
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 || process.env.JWT_SECRET.startsWith("replace_")) {
  throw new Error("Set a random JWT_SECRET with at least 32 characters in server/.env.");
}
const allowedOrigins = (process.env.FRONTEND_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin) return callback(null, false);
    return callback(null, allowedOrigins.includes(origin));
  }
}));
app.use(express.json({ limit: "20kb" }));
app.use((request, _response, next) => {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) request.body = {};
  next();
});

app.use((request, response, next) => {
  const requestId = randomUUID();
  request.id = requestId;
  const started = Date.now();
  response.setHeader("X-Request-Id", requestId);
  response.on("finish", () => {
    const path = request.path.replace(/\/[0-9a-f-]{36}(?=\/|$)/gi, "/:id");
    const key = request.method + " " + path + " " + response.statusCode;
    requestCounts.set(key, (requestCounts.get(key) || 0) + 1);
    console.log(JSON.stringify({ level: "info", event: "http_request", requestId, method: request.method, path, status: response.statusCode, durationMs: Date.now() - started }));
  });
  next();
});

app.get("/api/metrics", (_request, response) => {
  response.type("text/plain; version=0.0.4").send(
    "# HELP clinic_http_requests_total HTTP requests since process start.\n" +
    "# TYPE clinic_http_requests_total counter\n" +
    [...requestCounts].map(([key, value]) => {
      const [method, route, status] = key.split(" ");
      const escapedRoute = route.replaceAll("\\\\", "\\\\\\\\").replaceAll('"', '\\\"');
      return `clinic_http_requests_total{method="${method}",route="${escapedRoute}",status="${status}"} ${value}`;
    }).join("\n") + "\n"
  );
});

app.get("/api/health", async (_request, response, next) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok", database: "connected" });
  } catch (error) {
    next(error);
  }
});

app.use("/api/auth", authRouter);
app.use("/api", clinicRouter);

app.use((_request, response) => {
  response.status(404).json({ error: "API route not found" });
});

app.use((error, _request, response, _next) => {
  console.error(JSON.stringify({ level: "error", event: "api_error", requestId: _request.id, message: error.message, status: error.status || 500 }));
  const status = Number.isInteger(error.status) ? error.status : 500;
  response.status(status).json({
    error: status >= 500 ? "Internal server error" : error.message
  });
});

const server = app.listen(port, () => {
  console.log(`Clinic API listening on port ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
