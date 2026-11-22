import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";

export default function Register() {
  const { register } = useAuth();
  const [role, setRole] = useState("student");
  const [form, setForm] = useState({ email: "", password: "", full_name: "", company_name: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      
const payload = {
  email: form.email.trim(),
  password: form.password,
  role,
  ...(role === "student"
    ? { full_name: form.full_name.trim() }
    : { company_name: form.company_name.trim() })
};

      const data = await register(payload);
      setSuccess(data.message || "Account created. Wait for approval, then log in.");
    } catch (err) {
      setError(err.response?.data?.error || "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="max-w-md mx-auto mt-16 px-6">
        <div className="card text-center">
          <h1 className="text-xl font-display font-semibold mb-2">Account created</h1>
          <p className="text-slate text-sm mb-6">{success}</p>
          <Link to="/login" className="btn-primary inline-block">Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto mt-16 px-6">
      <h1 className="text-2xl font-display font-semibold mb-1">Create an account</h1>
      <p className="text-slate text-sm mb-6">
        Join as a student or a hiring company. A placement officer or admin
        will need to approve your account before you can log in.
      </p>
      <form onSubmit={submit} className="card space-y-4">
        {error && <p className="text-danger text-sm bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-2">
          {["student", "company"].map((r) => (
            <button type="button" key={r}
              onClick={() => setRole(r)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${role === r ? "bg-accent text-white border-accent" : "border-slate-300 text-slate"}`}>
              {r === "student" ? "Student" : "Company"}
            </button>
          ))}
        </div>

        {role === "student" && (
          <div>
            <label className="text-sm font-medium">Full name</label>
            <input required className="input-field mt-1"
              value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          </div>
        )}
        {role === "company" && (
          <div>
            <label className="text-sm font-medium">Company name</label>
            <input required className="input-field mt-1"
              value={form.company_name} onChange={(e) => setForm({ ...form, company_name: e.target.value })} />
          </div>
        )}

        <div>
          <label className="text-sm font-medium">Email</label>
          <input type="email" required className="input-field mt-1"
            value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="text-sm font-medium">Password</label>
          <input type="password" required minLength={8} pattern="(?=.*[A-Za-z])(?=.*[0-9]).{8,}" title="At least 8 characters, with a letter and a number" className="input-field mt-1"
            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? "Creating account..." : "Sign up"}
        </button>
      </form>
      <p className="text-sm text-slate mt-4">
        Already have an account? <Link to="/login" className="text-accent font-medium">Log in</Link>
      </p>
    </div>
  );
}
