import bcrypt from "bcryptjs";
import { query, pool } from "../config/db.js";
import { logActivity } from "../utils/activityLog.js";
import { logger } from "../utils/logger.js";
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeRefreshToken } from "../utils/tokens.js";

// Roles the PUBLIC /register endpoint is allowed to create.
// "admin" and "placement_officer" accounts must be provisioned by an
// existing admin (see admin.controller.js:createUser) — never self-registered.
// This was previously a security hole: the API accepted any of the four
// roles here even though the frontend only exposed two.
const PUBLIC_ROLES = ["student", "company"];

// POST /api/auth/register
// body: { email, password, role, full_name, ...roleSpecificFields }
// Request body is already validated+coerced by validate(registerSchema).
export const register = async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { email, password, role, full_name, company_name } = req.body;
    if (!PUBLIC_ROLES.includes(role)) {
      return res.status(403).json({
        error: "Self-registration is only available for student and company accounts. " +
               "Placement officer and admin accounts are created by an administrator.",
      });
    }

    await client.query("BEGIN");

    const existing = await client.query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Email already registered" });
    }

    const roleRow = await client.query("SELECT id FROM roles WHERE name=$1", [role]);
    if (!roleRow.rows.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Invalid role" });
    }
    const roleId = roleRow.rows[0].id;
    const passwordHash = await bcrypt.hash(password, 10);

    // Students and companies both require placement-officer/admin approval
    // before they can log in. is_approved starts false for everyone created
    // through this public endpoint.
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, role_id, is_approved)
       VALUES ($1,$2,$3,false) RETURNING id, email`,
      [email, passwordHash, roleId]
    );
    const userId = userResult.rows[0].id;

    if (role === "student") {
      if (!full_name) throw Object.assign(new Error("full_name is required for students"), { status: 400 });
      await client.query(
        `INSERT INTO students (user_id, full_name) VALUES ($1,$2)`,
        [userId, full_name]
      );
    } else if (role === "company") {
      if (!company_name) throw Object.assign(new Error("company_name is required"), { status: 400 });
      await client.query(
        `INSERT INTO companies (user_id, company_name) VALUES ($1,$2)`,
        [userId, company_name]
      );
    }

    await client.query("COMMIT");

    await logActivity(userId, "user.registered", { email, role });
    logger.info("user registered", { userId, email, role });

    // No token is issued yet — the account needs placement-officer/admin
    // approval first (enforced in login()). We tell the client that plainly
    // instead of handing back a usable session.
    res.status(201).json({
      message: "Account created. A placement officer or admin must approve it before you can log in.",
      user: { id: userId, email, role, is_approved: false },
    });
  } catch (err) {
    await client.query("ROLLBACK");
    next(err);
  } finally {
    client.release();
  }
};

// POST /api/auth/login
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await query(
      `SELECT u.id, u.email, u.password_hash, u.is_approved, u.is_active, u.token_version, r.name AS role_name
       FROM users u JOIN roles r ON u.role_id = r.id
       WHERE u.email = $1`,
      [email]
    );
    if (!result.rows.length) return res.status(401).json({ error: "Invalid credentials" });

    const user = result.rows[0];
    if (!user.is_active) return res.status(403).json({ error: "Account disabled. Contact your placement officer." });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      logger.warn("failed login attempt", { email });
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Enforce approval for the roles that need it. Admins and placement
    // officers are provisioned as pre-approved (see seedAdmin.js and
    // admin.controller.js:createUser), so this really only gates
    // students and companies, but checking it for everyone is harmless
    // and future-proof if that ever changes.
    if (!user.is_approved) {
      return res.status(403).json({
        error: "Your account is pending approval by a placement officer. Please check back later.",
      });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    await query(`UPDATE users SET last_login = now() WHERE id = $1`, [user.id]);
    await logActivity(user.id, "user.login", { email });
    logger.info("user login", { userId: user.id, email });

    res.json({
      token: accessToken,
      refreshToken,
      user: { id: user.id, email: user.email, role: user.role_name, is_approved: user.is_approved },
    });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/refresh
// body: { refreshToken }
// Rotates the refresh token (old one revoked, new one issued) and returns
// a fresh short-lived access token. See utils/tokens.js for why rotation
// matters — it turns a stolen refresh token into a one-shot, detectable
// problem instead of a silent, indefinite one.
export const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken is required" });

    const rotated = await rotateRefreshToken(refreshToken);
    if (!rotated) {
      return res.status(401).json({ error: "Refresh token is invalid, expired, or already used" });
    }

    const userResult = await query(
      `SELECT u.id, u.email, u.token_version, u.is_active, r.name AS role_name
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [rotated.userId]
    );
    if (!userResult.rows.length || !userResult.rows[0].is_active) {
      return res.status(401).json({ error: "Account unavailable" });
    }

    const accessToken = signAccessToken(userResult.rows[0]);
    res.json({ token: accessToken, refreshToken: rotated.refreshToken });
  } catch (err) {
    next(err);
  }
};

// POST /api/auth/logout
// body: { refreshToken }
// Revokes just the one refresh token that was used to log in on this
// device/browser. (A separate "log out everywhere" action, exposed via
// admin/profile tooling, bumps token_version instead — see
// utils/tokens.js:revokeAllSessions.)
export const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) await revokeRefreshToken(refreshToken);
    res.json({ message: "Logged out" });
  } catch (err) {
    next(err);
  }
};

// GET /api/auth/me
export const me = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT u.id, u.email, r.name AS role, u.is_approved
       FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = $1`,
      [req.user.id]
    );
    res.json(result.rows[0] || null);
  } catch (err) {
    next(err);
  }
};
