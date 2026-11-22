import { useEffect, useState } from "react";
import api from "../api/axios.js";
import StatCard from "../components/StatCard.jsx";

const TABS = ["Users", "Create Account", "Activity Log"];

export default function AdminDashboard() {
  const [tab, setTab] = useState("Users");
  const [users, setUsers] = useState([]);

  const loadUsers = async () => {
    const { data } = await api.get("/admin/users");
    setUsers(data);
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const toggleActive = async (user) => {
    await api.patch(`/admin/users/${user.id}`, {
      is_active: !user.is_active,
    });
    loadUsers();
  };

  const toggleApproval = async (user) => {
    await api.patch(`/admin/users/${user.id}`, {
      is_approved: !user.is_approved,
    });
    loadUsers();
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-semibold mb-1">Admin dashboard</h1>
      <p className="text-slate text-sm mb-6">Manage users, approvals, account status, and audit history.</p>

      <div className="grid sm:grid-cols-4 gap-4 mb-6">
        <StatCard label="Users" value={users.length} accent />
        <StatCard label="Admins" value={users.filter((u) => u.role === "admin").length} />
        <StatCard label="Officers" value={users.filter((u) => u.role === "placement_officer").length} />
        <StatCard label="Companies" value={users.filter((u) => u.role === "company").length} />
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? "border-accent text-accent" : "border-transparent text-slate hover:text-ink"}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Users" && (
        <div className="card">
          <h2 className="font-semibold mb-4">User management</h2>
          <div className="space-y-3">
            {users.map((user) => (
              <div key={user.id} className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-slate-200">
                <div>
                  <p className="font-semibold">{user.email}</p>
                  <p className="text-sm text-slate capitalize">{user.role.replace("_", " ")}</p>
                  <p className="text-sm text-slate">Approved: {user.is_approved ? "Yes" : "No"} · Active: {user.is_active ? "Yes" : "No"}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    className="btn-secondary"
                    onClick={() => toggleActive(user)}
                  >
                    {user.is_active ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn-secondary"
                    onClick={() => toggleApproval(user)}
                  >
                    {user.is_approved ? "Revoke approval" : "Approve"}
                  </button>
                </div>
              </div>
            ))}
            {!users.length && <p className="text-slate text-sm">No users found yet.</p>}
          </div>
        </div>
      )}

      {tab === "Create Account" && <CreateAccountTab onCreated={loadUsers} />}
      {tab === "Activity Log" && <ActivityLogTab />}
    </div>
  );
}

function CreateAccountTab({ onCreated }) {
  const [form, setForm] = useState({ email: "", password: "", role: "placement_officer" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      await api.post("/admin/users", form);
      setMessage(`Account created for ${form.email}.`);
      setForm({ email: "", password: "", role: "placement_officer" });
      onCreated();
    } catch (err) {
      setError(err.response?.data?.error || "Could not create account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="card space-y-4 max-w-md">
      <h3 className="font-semibold">Create a placement officer or admin account</h3>
      <p className="text-sm text-slate">
        Officer and admin accounts can only be created here — the public sign-up
        page only allows student and company accounts.
      </p>
      {message && <p className="text-sm text-accentDark bg-accent/10 rounded-lg px-3 py-2">{message}</p>}
      {error && <p className="text-danger text-sm">{error}</p>}
      <div>
        <label className="text-sm font-medium">Role</label>
        <select className="input-field mt-1" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
          <option value="placement_officer">Placement Officer</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <div>
        <label className="text-sm font-medium">Email</label>
        <input type="email" required className="input-field mt-1" value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })} />
      </div>
      <div>
        <label className="text-sm font-medium">Password</label>
        <input type="password" required minLength={8} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,}" title="At least 8 characters, with a letter and a number" className="input-field mt-1" value={form.password}
          onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </div>
      <button className="btn-primary" disabled={saving}>{saving ? "Creating..." : "Create account"}</button>
    </form>
  );
}

function ActivityLogTab() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get("/admin/logs").then(({ data }) => setLogs(data)).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-slate text-sm">Loading activity log...</p>;

  return (
    <div className="card">
      <h3 className="font-semibold mb-4">Recent activity (last 200 entries)</h3>
      {logs.length ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate border-b border-slate-200">
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 last:border-0 align-top">
                  <td className="py-2 pr-4 whitespace-nowrap text-slate">{new Date(log.created_at).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-medium">{log.action}</td>
                  <td className="py-2 text-slate">
                    <code className="text-xs">{JSON.stringify(log.metadata)}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-slate text-sm">No activity recorded yet.</p>
      )}
    </div>
  );
}
