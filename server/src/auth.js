import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { rateLimit } from "express-rate-limit";
import { pool } from "./db.js";

export const authRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sign-in attempts. Try again in 15 minutes." }
});

function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePhone(value) {
  return value ? value.replace(/[\s()-]/g, "") : null;
}

function publicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    role: user.role
  };
}

function tokenSecret() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32 ||
      process.env.JWT_SECRET.startsWith("replace_")) {
    throw authError(500, "The server JWT_SECRET is not configured.");
  }
  return process.env.JWT_SECRET;
}

async function issueSession(user) {
  const session = await pool.query(
    "INSERT INTO auth_sessions (user_id, expires_at) VALUES ($1, NOW() + INTERVAL '1 hour') RETURNING id, expires_at",
    [user.id]
  );
  const sessionId = session.rows[0].id;
  const token = jwt.sign(
    { sub: user.id, sid: sessionId, role: user.role },
    tokenSecret(),
    { expiresIn: "1h", issuer: "akniet-clinic-api", audience: "akniet-clinic-client" }
  );
  return { token, expiresAt: session.rows[0].expires_at };
}

authRouter.post("/register", async (request, response) => {
  const fullName = typeof request.body.fullName === "string" ? request.body.fullName.trim() : "";
  const email = typeof request.body.email === "string" ? request.body.email.trim().toLowerCase() : null;
  const phone = normalizePhone(typeof request.body.phone === "string" ? request.body.phone.trim() : null);
  const password = typeof request.body.password === "string" ? request.body.password : "";

  if (fullName.length < 2 || fullName.length > 120) {
    throw authError(400, "Full name must contain 2 to 120 characters.");
  }
  if (!email && !phone) throw authError(400, "Provide an email or phone number.");
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)) {
    throw authError(400, "Enter a valid email address.");
  }
  if (phone && !/^\+?[0-9]{7,15}$/.test(phone)) {
    throw authError(400, "Enter a valid phone number.");
  }
  if (password.length < 10 || Buffer.byteLength(password, "utf8") > 72) {
    throw authError(400, "Password must be at least 10 characters and no more than 72 bytes.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  let result;
  try {
    result = await pool.query(
      "INSERT INTO users (full_name, email, phone, password_hash, role) VALUES ($1, $2, $3, $4, 'patient') RETURNING id, full_name, email, phone, role",
      [fullName, email, phone, passwordHash]
    );
  } catch (error) {
    if (error.code === "23505") throw authError(409, "An account with this email or phone already exists.");
    throw error;
  }

  const user = result.rows[0];
  const session = await issueSession(user);
  response.status(201).json({ user: publicUser(user), token: session.token, expiresAt: session.expiresAt });
});

authRouter.post("/login", loginLimiter, async (request, response) => {
  const identifier = typeof request.body.identifier === "string" ? request.body.identifier.trim() : "";
  const password = typeof request.body.password === "string" ? request.body.password : "";
  if (!identifier || !password) throw authError(400, "Provide your email/phone and password.");

  const isEmail = identifier.includes("@");
  const normalizedIdentifier = isEmail ? identifier.toLowerCase() : normalizePhone(identifier);
  const result = await pool.query(
    "SELECT id, full_name, email, phone, password_hash, role FROM users WHERE (email = $1 OR phone = $1) AND role IN ('patient', 'doctor', 'admin') LIMIT 1",
    [normalizedIdentifier]
  );
  const user = result.rows[0];
  const passwordMatches = user && await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) throw authError(401, "Email/phone or password is incorrect.");

  const session = await issueSession(user);
  response.json({ user: publicUser(user), token: session.token, expiresAt: session.expiresAt });
});

export async function requireAuth(request, _response, next) {
  try {
    const header = request.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) throw authError(401, "Sign in is required.");

    const payload = jwt.verify(token, tokenSecret(), {
      issuer: "akniet-clinic-api",
      audience: "akniet-clinic-client"
    });
    const result = await pool.query(
      "SELECT u.id, u.full_name, u.email, u.phone, u.role FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > NOW()",
      [payload.sid, payload.sub]
    );
    if (!result.rowCount) throw authError(401, "Session expired or signed out.");
    request.user = publicUser(result.rows[0]);
    return next();
  } catch (error) {
    if (error.name === "JsonWebTokenError" || error.name === "TokenExpiredError") {
      return next(authError(401, "Invalid or expired access token."));
    }
    return next(error);
  }
}

export function requireRole(...roles) {
  return (request, _response, next) => {
    if (!request.user || !roles.includes(request.user.role)) {
      return next(authError(403, "You do not have permission to access this resource."));
    }
    return next();
  };
}

authRouter.get("/me", requireAuth, (request, response) => {
  response.json({ user: request.user });
});

authRouter.post("/logout", requireAuth, async (request, response) => {
  const token = request.get("authorization").slice(7);
  const payload = jwt.verify(token, tokenSecret(), {
    issuer: "akniet-clinic-api",
    audience: "akniet-clinic-client"
  });
  await pool.query("UPDATE auth_sessions SET revoked_at = NOW() WHERE id = $1", [payload.sid]);
  response.json({ message: "Signed out successfully." });
});
