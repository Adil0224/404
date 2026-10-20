import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { pool } from "./db.js";
import { authRouter } from "./auth.js";
import { clinicRouter } from "./routes/clinic.js";
const app = express();
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
  console.error("API error:", error.message);
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
