import bcrypt from "bcryptjs";
import { query } from "../config/db.js";
import { logActivity } from "../utils/activityLog.js";
import { notify } from "../utils/notify.js";
import { getPagination, sendPaginated } from "../utils/pagination.js";

// GET /api/admin/users
// V3: paginated — a growing campus deployment means this list can't
// safely be "everyone, every time" forever.
export const listUsers = async (req, res, next) => {
  try {
    const { page, limit, offset } = getPagination(req);
    const total = parseInt((await query(`SELECT count(*) FROM users`)).rows[0].count, 10);
    const result = await query(
      `SELECT u.id, u.email, r.name AS role, u.is_approved, u.is_active, u.created_at
       FROM users u JOIN roles r ON r.id = u.role_id ORDER BY u.created_at DESC
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    sendPaginated(res, result.rows, { page, limit, total });
  } catch (err) { next(err); }
};

// PATCH /api/admin/users/:id  body: { is_active, is_approved, role }
export const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { is_active, is_approved, role } = req.body;
    let roleId = null;
    if (role) {
      const r = await query("SELECT id FROM roles WHERE name=$1", [role]);
      if (!r.rows.length) return res.status(400).json({ error: "Invalid role" });
      roleId = r.rows[0].id;
    }
    const result = await query(
      `UPDATE users SET
         is_active = COALESCE($1, is_active),
         is_approved = COALESCE($2, is_approved),
         role_id = COALESCE($3, role_id)
       WHERE id = $4 RETURNING id, email, is_active, is_approved`,
      [is_active, is_approved, roleId, id]
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });

    await notify(result.rows[0].id, "Account updated", "An administrator updated your account settings.");
    await logActivity(req.user.id, "admin.user_updated", { target_user_id: id, is_active, is_approved, role });

    res.json(result.rows[0]);
  } catch (err) { next(err); }
};

// POST /api/admin/users  — create admin/officer accounts directly.
// This is the ONLY way to create admin/placement_officer accounts —
// the public /auth/register endpoint explicitly rejects those roles.
export const createUser = async (req, res, next) => {
  try {
    const { email, password, role } = req.body;
    if (!email || !password || !role) {
      return res.status(400).json({ error: "email, password and role are required" });
    }
    if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      return res.status(400).json({ error: "Password must be at least 8 characters and include a letter and a number" });
    }
    const existing = await query("SELECT id FROM users WHERE email=$1", [email]);
    if (existing.rows.length) return res.status(409).json({ error: "Email already registered" });

    const roleRow = await query("SELECT id FROM roles WHERE name=$1", [role]);
    if (!roleRow.rows.length) return res.status(400).json({ error: "Invalid role" });
    const hash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, role_id, is_approved) VALUES ($1,$2,$3,true)
       RETURNING id, email`,
      [email, hash, roleRow.rows[0].id]
    );

    await logActivity(req.user.id, "admin.user_created", { email, role });

    res.status(201).json(result.rows[0]);
  } catch (err) { next(err); }
};

// GET /api/admin/logs
export const getActivityLogs = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT 200`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};
