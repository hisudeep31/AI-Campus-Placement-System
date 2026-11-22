
import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import api from "../api/axios.js";
import InstitutionalInsights from "../components/officer/InstitutionalInsights.jsx";
import VerificationTab from "../components/officer/VerificationTab.jsx";
import DrivesManageTab from "../components/officer/DrivesManageTab.jsx";
import AlumniPanel from "../components/shared/AlumniPanel.jsx";
import StatCard from "../components/StatCard.jsx";

const TABS = [
  "Analytics",
  "Placed Students",
  "Students",
  "Companies",
  "Verification",
  "Drives",
  "Alumni",
];

export default function OfficerDashboard() {
  const [tab, setTab] = useState("Analytics");

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-semibold mb-1">
        Placement officer dashboard
      </h1>

      <p className="text-slate text-sm mb-6">
        Track placement progress across the college.
      </p>

      <div className="flex gap-1 border-b border-slate-200 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap ${
              tab === t
                ? "border-accent text-accent"
                : "border-transparent text-slate hover:text-ink"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Analytics" && <AnalyticsTab />}
      {tab === "Placed Students" && <PlacedStudentsTab />}
      {tab === "Students" && <StudentsTab />}
      {tab === "Companies" && <CompaniesTab />}
      {tab === "Verification" && <VerificationTab />}
      {tab === "Drives" && <DrivesManageTab />}
      {tab === "Alumni" && <AlumniPanel canEdit />}
    </div>
  );
}

async function downloadReport(type, filename) {
  const res = await api.get("/officer/reports/export", {
    params: { type },
    responseType: "blob",
  });

  const url = window.URL.createObjectURL(new Blob([res.data]));
  const link = document.createElement("a");

  link.href = url;
  link.setAttribute("download", filename);

  document.body.appendChild(link);
  link.click();
  link.remove();

  window.URL.revokeObjectURL(url);
}

function ExportButton({ type, filename, label }) {
  const [downloading, setDownloading] = useState(false);

  const run = async () => {
    setDownloading(true);

    try {
      await downloadReport(type, filename);
    } catch (error) {
      console.error("Report export failed:", error);
      alert("Unable to export the report. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      className="btn-secondary text-xs"
      onClick={run}
      disabled={downloading}
    >
      {downloading ? "Exporting..." : label}
    </button>
  );
}

function AnalyticsTab() {
  const [overview, setOverview] = useState(null);
  const [deptWise, setDeptWise] = useState([]);
  const [topRecruiters, setTopRecruiters] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadAnalytics = async () => {
      try {
        const [overviewRes, deptRes, recruitersRes] = await Promise.all([
          api.get("/officer/analytics/overview"),
          api.get("/officer/analytics/department-wise"),
          api.get("/officer/analytics/top-recruiters"),
        ]);

        setOverview(overviewRes.data);
        setDeptWise(deptRes.data);
        setTopRecruiters(recruitersRes.data);
      } catch (err) {
        console.error("Analytics loading failed:", err);
        setError("Unable to load analytics. Please refresh the page.");
      }
    };

    loadAnalytics();
  }, []);

  if (error) {
    return <p className="text-red-600 text-sm">{error}</p>;
  }

  if (!overview) {
    return <p className="text-slate text-sm">Loading analytics...</p>;
  }

  const chartData = deptWise.map((d) => ({
    department: d.department || "Unassigned",
    placed: parseInt(d.placed_students, 10) || 0,
    total: parseInt(d.total_students, 10) || 0,
  }));

  return (
    <div className="space-y-6">
      <InstitutionalInsights />

      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Overview</h3>
        <ExportButton
          type="overview"
          filename="placement_overview.csv"
          label="Export overview CSV"
        />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard
          label="Placement %"
          value={`${overview.placement_percentage}%`}
          accent
        />

        <StatCard
          label="Students placed"
          value={`${overview.placed_students} / ${overview.total_students}`}
        />

        <StatCard
          label="Companies"
          value={overview.total_companies}
        />

        <StatCard
          label="Jobs posted"
          value={`${overview.open_jobs} open / ${overview.total_jobs} total`}
        />

        <StatCard
          label="Avg ATS score"
          value={overview.average_ats_score || "—"}
        />
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Department-wise placement</h3>

          <ExportButton
            type="department"
            filename="department_wise.csv"
            label="Export CSV"
          />
        </div>

        {chartData.length ? (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chartData}>
              <XAxis dataKey="department" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar
                dataKey="total"
                fill="#EEF2F6"
                name="Total students"
              />
              <Bar
                dataKey="placed"
                fill="#2F6F5E"
                name="Placed"
              />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-slate text-sm">
            No department data yet.
          </p>
        )}
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold">Top recruiters</h3>

          <ExportButton
            type="top-recruiters"
            filename="top_recruiters.csv"
            label="Export CSV"
          />
        </div>

        {topRecruiters.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate border-b border-slate-200">
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4">Jobs posted</th>
                  <th className="py-2 pr-4">Applications</th>
                  <th className="py-2">Offers made</th>
                </tr>
              </thead>

              <tbody>
                {topRecruiters.map((r) => (
                  <tr
                    key={r.company_name}
                    className="border-b border-slate-100 last:border-0"
                  >
                    <td className="py-2 pr-4 font-medium">
                      {r.company_name}
                    </td>
                    <td className="py-2 pr-4">{r.jobs_posted}</td>
                    <td className="py-2 pr-4">{r.total_applications}</td>
                    <td className="py-2">{r.offers_made}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-slate text-sm">
            No recruiter activity yet.
          </p>
        )}
      </div>
    </div>
  );
}

// Placed Students tab
function PlacedStudentsTab() {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  const loadPlacedStudents = async () => {
    setLoading(true);
    setError("");

    try {
      const { data } = await api.get("/officer/placed-students");

      // Supports either a direct array or { students: [...] } response.
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.students)
          ? data.students
          : [];

      setStudents(list);
    } catch (err) {
      console.error("Placed students loading failed:", err);
      setError(
        err.response?.data?.error ||
        "Unable to load placed students. Please check the backend route."
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlacedStudents();
  }, []);

  const filteredStudents = students.filter((student) => {
    const term = search.toLowerCase();

    return [
      student.full_name,
      student.department,
      student.company_name,
      student.job_title,
      student.email,
    ].some((value) =>
      String(value || "").toLowerCase().includes(term)
    );
  });

  if (loading) {
    return (
      <p className="text-slate text-sm">
        Loading placed students...
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Placed Students</h2>
          <p className="text-sm text-slate">
            Students selected by companies after the recruitment process.
          </p>
        </div>

        <button
          className="btn-secondary text-sm"
          onClick={loadPlacedStudents}
        >
          Refresh
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <StatCard
          label="Total placed students"
          value={students.length}
          accent
        />
        <StatCard
          label="Companies represented"
          value={
            new Set(
              students
                .map((s) => s.company_name)
                .filter(Boolean)
            ).size
          }
        />
      </div>

      <div className="card">
        <input
          className="input-field w-full"
          placeholder="Search by student, department or company..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {error && (
        <div className="card">
          <p className="text-red-600 text-sm">{error}</p>
          <p className="text-slate text-xs mt-2">
            The frontend expects GET /api/officer/placed-students.
          </p>
        </div>
      )}

      {!error && filteredStudents.length > 0 && (
        <div className="grid gap-3">
          {filteredStudents.map((student, index) => (
            <div
              key={student.id || student.application_id || index}
              className="card"
            >
              <div className="flex flex-wrap justify-between gap-3">
                <div>
                  <h3 className="font-semibold">
                    {student.full_name || "Student"}
                  </h3>

                  <p className="text-sm text-slate mt-1">
                    {student.email || "Email unavailable"}
                  </p>

                  <p className="text-sm text-slate mt-1">
                    {student.department || "Department not specified"}
                  </p>
                </div>

                <span className="badge bg-green-100 text-green-700 h-fit">
                  Selected
                </span>
              </div>

              <div className="border-t border-slate-100 mt-4 pt-3 grid sm:grid-cols-2 gap-2 text-sm">
                <p>
                  <span className="text-slate">Company: </span>
                  {student.company_name || "Not available"}
                </p>

                <p>
                  <span className="text-slate">Job role: </span>
                  {student.job_title || "Not available"}
                </p>

                <p>
                  <span className="text-slate">Package: </span>
                  {student.final_salary != null
                    ? student.final_salary
                    : "Not disclosed"}
                </p>

                <p>
                  <span className="text-slate">CGPA: </span>
                  {student.cgpa ?? "—"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {!error && filteredStudents.length === 0 && (
        <div className="card text-center py-8">
          <h3 className="font-semibold">No placed students found</h3>
          <p className="text-sm text-slate mt-2">
            Students will appear here when a company marks their application as Selected.
          </p>
        </div>
      )}
    </div>
  );
}

function StudentsTab() {
  const [students, setStudents] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("");

  const load = async () => {
    try {
      const { data } = await api.get("/officer/students", {
        params: {
          search,
          department: department || undefined,
        },
      });

      setStudents(data);
    } catch (err) {
      console.error("Students loading failed:", err);
    }
  };

  useEffect(() => {
    load();

    api
      .get("/officer/departments")
      .then(({ data }) => setDepartments(data))
      .catch((err) => console.error("Departments loading failed:", err));
  }, []);

  useEffect(() => {
    load();
  }, [department]);

  const toggleApproval = async (userId, current) => {
    try {
      await api.patch(`/officer/approvals/${userId}`, {
        is_approved: !current,
      });

      load();
    } catch (err) {
      console.error("Student approval update failed:", err);
      alert("Unable to update student approval.");
    }
  };

  return (
    <div>
      <div className="flex gap-2 mb-4 flex-wrap items-center">
        <input
          className="input-field max-w-sm"
          placeholder="Search students or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />

        <select
          className="input-field w-auto"
          value={department}
          onChange={(e) => setDepartment(e.target.value)}
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <button className="btn-secondary" onClick={load}>
          Search
        </button>

        <ExportButton
          type="students"
          filename="students.csv"
          label="Export CSV"
        />
      </div>

      <div className="grid gap-3">
        {students.map((s) => (
          <div
            key={s.id}
            className="card flex items-center justify-between"
          >
            <div>
              <h4 className="font-semibold">{s.full_name}</h4>
              <p className="text-sm text-slate">
                {s.email} · {s.department || "No department"} · CGPA{" "}
                {s.cgpa || "—"}
              </p>
            </div>

            <button
              onClick={() => toggleApproval(s.user_id, s.is_approved)}
              className={`badge ${
                s.is_approved
                  ? "bg-green-100 text-green-700"
                  : "bg-warn/10 text-warn"
              }`}
            >
              {s.is_approved
                ? "Approved"
                : "Pending — click to approve"}
            </button>
          </div>
        ))}

        {!students.length && (
          <p className="text-slate text-sm">No students found.</p>
        )}
      </div>
    </div>
  );
}

function CompaniesTab() {
  const [companies, setCompanies] = useState([]);

  const load = async () => {
    try {
      const { data } = await api.get("/officer/companies");
      setCompanies(data);
    } catch (err) {
      console.error("Companies loading failed:", err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const toggleApproval = async (userId, current) => {
    try {
      await api.patch(`/officer/approvals/${userId}`, {
        is_approved: !current,
      });

      load();
    } catch (err) {
      console.error("Company approval update failed:", err);
      alert("Unable to update company approval.");
    }
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <ExportButton
          type="companies"
          filename="companies.csv"
          label="Export CSV"
        />
      </div>

      <div className="grid gap-3">
        {companies.map((c) => (
          <div
            key={c.id}
            className="card flex items-center justify-between"
          >
            <div>
              <h4 className="font-semibold">{c.company_name}</h4>
              <p className="text-sm text-slate">
                {c.email} · {c.industry || "Industry not set"}
              </p>
            </div>

            <button
              onClick={() => toggleApproval(c.user_id, c.is_approved)}
              className={`badge ${
                c.is_approved
                  ? "bg-green-100 text-green-700"
                  : "bg-warn/10 text-warn"
              }`}
            >
              {c.is_approved
                ? "Approved"
                : "Pending — click to approve"}
            </button>
          </div>
        ))}

        {!companies.length && (
          <p className="text-slate text-sm">
            No companies registered yet.
          </p>
        )}
      </div>
    </div>
  );
}
