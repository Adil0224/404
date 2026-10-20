import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const fullName = (process.env.ADMIN_NAME || "").trim();
const email = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD || "";

try {
  if (!fullName || !email || password.length < 14 || password.startsWith("replace_") || Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("Set ADMIN_NAME, ADMIN_EMAIL, and a 14+ character ADMIN_PASSWORD in server/.env.");
  }

  const existing = await pool.query("SELECT 1 FROM users WHERE role = 'admin' LIMIT 1");
  if (existing.rowCount) throw new Error("An administrator already exists; bootstrap can only run once.");

  const passwordHash = await bcrypt.hash(password, 12);
  await pool.query(
    "INSERT INTO users (full_name, email, password_hash, role) VALUES ($1, $2, $3, 'admin')",
    [fullName, email, passwordHash]
  );
  console.log("Administrator account created.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
