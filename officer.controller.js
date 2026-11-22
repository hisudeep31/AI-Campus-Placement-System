import { query } from "../config/db.js";
import { notify } from "../utils/notify.js";
import { logActivity } from "../utils/activityLog.js";
import { getPagination, sendPaginated } from "../utils/pagination.js";

// GET /api/officer/students
// V3: paginated — a full college roster can be thousands of rows.
export const listStudents = async (req, res, next) => {
  try {
    const { department, search } = req.query;
    const { page, limit, offset } = getPagination(req);
    const conditions = [];
    const params = [];
    if (department) { params.push(department); conditions.push(`s.department = $${params.length}`); }
    if (search) { params.push(`%${search}%`); conditions.push(`(s.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`); }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const total = parseInt(
      (await query(
        `SELECT count(*) FROM students s JOIN users u ON u.id = s.user_id ${where}`,
        params
      )).rows[0].count,
      10
    );

    params.push(limit, offset);
    const result = await query(
      `SELECT s.*, u.id AS user_id, u.email, u.is_approved FROM students s
       JOIN users u ON u.id = s.user_id ${where} ORDER BY s.full_name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    sendPaginated(res, result.rows, { page, limit, total });
  } catch (err) { next(err); }
};
// GET /api/officer/placed-students
// Fetch students whose applications have been selected by companies.
export const listPlacedStudents = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT ON (s.id)
              s.id AS student_id,
              s.full_name,
              s.department,
              u.email,
              j.title AS job_title,
              c.company_name,
              a.final_salary,
              a.status,
              a.id AS application_id
       FROM applications a
       JOIN students s ON s.id = a.student_id
       JOIN users u ON u.id = s.user_id
       JOIN jobs j ON j.id = a.job_id
       JOIN companies c ON c.id = j.company_id
       WHERE LOWER(BTRIM(a.status)) = 'selected'
       ORDER BY s.id, a.applied_at DESC, a.id`
    );

    res.json(result.rows);
  } catch (err) {
    next(err);
  }
};

// GET /api/officer/departments — distinct department list for filter dropdowns
export const listDepartments = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT DISTINCT department FROM students WHERE department IS NOT NULL ORDER BY department`
    );
    res.json(result.rows.map((r) => r.department));
  } catch (err) { next(err); }
};

// GET /api/officer/companies
export const listCompanies = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT c.*, u.id AS user_id, u.email, u.is_approved FROM companies c
       JOIN users u ON u.id = c.user_id ORDER BY c.company_name`
    );
    res.json(result.rows);
  } catch (err) { next(err); }
};

// PATCH /api/officer/approvals/:userId  body: { is_approved }
export const setApproval = async (req, res, next) => {
  try {
    const { userId } = req.params;
    const { is_approved } = req.body;
    const result = await query(
      `UPDATE users SET is_approved=$1 WHERE id=$2 RETURNING id, email, is_approved`,
      [is_approved, userId]
    );
    if (!result.rows.length) return res.status(404).json({ error: "User not found" });

    await notify(
      userId,
      is_approved ? "Account approved" : "Approval revoked",
      is_approved
        ? "Your account has been approved. You can now log in."
        : "Your account approval has been revoked. Contact your placement officer for details."
    );
    await logActivity(req.user.id, "user.approval_changed", { target_user_id: userId, is_approved });

    res.json(result.rows[0]);
  } catch (err) { next(err); }
};

// GET /api/officer/analytics/overview
export const analyticsOverview = async (req, res, next) => {
  try {
    const [totalStudents, placedStudents, totalCompanies, totalJobs, avgAts, openJobs] = await Promise.all([
      query(`SELECT COUNT(*) FROM students`),
      query(`SELECT COUNT(DISTINCT student_id) FROM applications WHERE status='selected'`),
      query(`SELECT COUNT(*) FROM companies`),
      query(`SELECT COUNT(*) FROM jobs`),
      query(`SELECT ROUND(AVG(ats_score),2) AS avg FROM students WHERE ats_score IS NOT NULL`),
      query(`SELECT COUNT(*) FROM jobs WHERE status='open'`),
    ]);

    const total = parseInt(totalStudents.rows[0].count, 10);
    const placed = parseInt(placedStudents.rows[0].count, 10);

    res.json({
      total_students: total,
      placed_students: placed,
      placement_percentage: total ? Math.round((placed / total) * 100) : 0,
      total_companies: parseInt(totalCompanies.rows[0].count, 10),
      total_jobs: parseInt(totalJobs.rows[0].count, 10),
      open_jobs: parseInt(openJobs.rows[0].count, 10),
      average_ats_score: avgAts.rows[0].avg || 0,
    });
  } catch (err) { next(err); }
};

// GET /api/officer/analytics/department-wise
export const analyticsDepartmentWise = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT s.department,
             COUNT(DISTINCT s.id) AS total_students,
             COUNT(DISTINCT CASE WHEN a.status='selected' THEN a.student_id END) AS placed_students
      FROM students s
      LEFT JOIN applications a ON a.student_id = s.id
      GROUP BY s.department ORDER BY s.department
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
};

// GET /api/officer/analytics/top-recruiters
export const analyticsTopRecruiters = async (req, res, next) => {
  try {
    const result = await query(`
      SELECT c.company_name, COUNT(a.id) FILTER (WHERE a.status='selected') AS offers_made,
             COUNT(DISTINCT j.id) AS jobs_posted,
             COUNT(a.id) AS total_applications
      FROM companies c
      LEFT JOIN jobs j ON j.company_id = c.id
      LEFT JOIN applications a ON a.job_id = j.id
      GROUP BY c.company_name
      HAVING COUNT(DISTINCT j.id) > 0
      ORDER BY offers_made DESC, jobs_posted DESC LIMIT 10
    `);
    res.json(result.rows);
  } catch (err) { next(err); }
};

// Escapes a value for inclusion in a CSV cell.
const csvCell = (val) => {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
};

const toCsv = (rows, columns) => {
  const header = columns.join(",");
  const body = rows.map((row) => columns.map((col) => csvCell(row[col])).join(",")).join("\n");
  return `${header}\n${body}`;
};

// GET /api/officer/reports/export?type=overview|department|students|companies|top-recruiters
export const exportReport = async (req, res, next) => {
  try {
    const { type } = req.query;
    let rows = [];
    let columns = [];
    let filename = "report.csv";

    switch (type) {
      case "students": {
        const result = await query(
          `SELECT s.full_name, u.email, s.department, s.cgpa, s.graduation_year, s.ats_score, u.is_approved
           FROM students s JOIN users u ON u.id = s.user_id ORDER BY s.full_name`
        );
        rows = result.rows;
        columns = ["full_name", "email", "department", "cgpa", "graduation_year", "ats_score", "is_approved"];
        filename = "students_report.csv";
        break;
      }
      case "companies": {
        const result = await query(
          `SELECT c.company_name, u.email, c.industry, u.is_approved,
                  (SELECT COUNT(*) FROM jobs WHERE company_id = c.id) AS jobs_posted
           FROM companies c JOIN users u ON u.id = c.user_id ORDER BY c.company_name`
        );
        rows = result.rows;
        columns = ["company_name", "email", "industry", "is_approved", "jobs_posted"];
        filename = "companies_report.csv";
        break;
      }
      case "department": {
        const result = await query(`
          SELECT s.department,
                 COUNT(DISTINCT s.id) AS total_students,
                 COUNT(DISTINCT CASE WHEN a.status='selected' THEN a.student_id END) AS placed_students
          FROM students s
          LEFT JOIN applications a ON a.student_id = s.id
          GROUP BY s.department ORDER BY s.department
        `);
        rows = result.rows;
        columns = ["department", "total_students", "placed_students"];
        filename = "department_wise_report.csv";
        break;
      }
      case "top-recruiters": {
        const result = await query(`
          SELECT c.company_name, COUNT(a.id) FILTER (WHERE a.status='selected') AS offers_made,
                 COUNT(DISTINCT j.id) AS jobs_posted
          FROM companies c
          LEFT JOIN jobs j ON j.company_id = c.id
          LEFT JOIN applications a ON a.job_id = j.id
          GROUP BY c.company_name
          ORDER BY offers_made DESC LIMIT 50
        `);
        rows = result.rows;
        columns = ["company_name", "offers_made", "jobs_posted"];
        filename = "top_recruiters_report.csv";
        break;
      }
      default: {
        // overview — a single summary row
        const [totalStudents, placedStudents, totalCompanies, totalJobs] = await Promise.all([
          query(`SELECT COUNT(*) FROM students`),
          query(`SELECT COUNT(DISTINCT student_id) FROM applications WHERE status='selected'`),
          query(`SELECT COUNT(*) FROM companies`),
          query(`SELECT COUNT(*) FROM jobs`),
        ]);
        const total = parseInt(totalStudents.rows[0].count, 10);
        const placed = parseInt(placedStudents.rows[0].count, 10);
        rows = [{
          generated_at: new Date().toISOString(),
          total_students: total,
          placed_students: placed,
          placement_percentage: total ? Math.round((placed / total) * 100) : 0,
          total_companies: parseInt(totalCompanies.rows[0].count, 10),
          total_jobs: parseInt(totalJobs.rows[0].count, 10),
        }];
        columns = ["generated_at", "total_students", "placed_students", "placement_percentage", "total_companies", "total_jobs"];
        filename = "placement_overview_report.csv";
      }
    }

    const csv = toCsv(rows, columns);

    await query(
      `INSERT INTO reports (generated_by, report_type, filters) VALUES ($1, $2, $3)`,
      [req.user.id, type || "overview", JSON.stringify(req.query)]
    );
    await logActivity(req.user.id, "report.exported", { type: type || "overview" });

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err) { next(err); }
};
