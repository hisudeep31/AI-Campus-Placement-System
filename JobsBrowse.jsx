import { useEffect, useState } from "react";
import api from "../api/axios.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function JobsBrowse() {
  const { user } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [search, setSearch] = useState("");
  const [location, setLocation] = useState("");
  const [jobType, setJobType] = useState("");
  const [applying, setApplying] = useState(null);
  const [message, setMessage] = useState("");

  const load = async () => {
    const { data } = await api.get("/jobs", {
      params: {
        search: search || undefined,
        location: location || undefined,
        job_type: jobType || undefined,
      },
    });
    setJobs(data);
  };

  useEffect(() => { load(); }, []);

  const apply = async (jobId) => {
    setApplying(jobId);
    setMessage("");
    try {
      await api.post(`/jobs/${jobId}/apply`);
      setMessage("Application submitted!");
    } catch (err) {
      setMessage(err.response?.data?.error || "Could not apply");
    } finally {
      setApplying(null);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <h1 className="text-2xl font-display font-semibold mb-4">Open roles</h1>
      <div className="flex flex-wrap gap-2 mb-6">
        <input
          className="input-field max-w-sm"
          placeholder="Search by title or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <input
          className="input-field max-w-[180px]"
          placeholder="Location"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <select className="input-field w-auto" value={jobType} onChange={(e) => setJobType(e.target.value)}>
          <option value="">Any job type</option>
          <option value="full_time">Full-time</option>
          <option value="internship">Internship</option>
          <option value="contract">Contract</option>
        </select>
        <button className="btn-secondary" onClick={load}>Search</button>
      </div>
      {message && <p className="text-sm text-accentDark bg-accent/10 rounded-lg px-3 py-2 mb-4">{message}</p>}

      <div className="grid gap-4">
        {jobs.map((job) => (
          <div key={job.id} className="card flex items-start justify-between gap-6">
            <div>
              <h3 className="text-lg font-semibold">{job.title}</h3>
              <p className="text-sm text-slate">
                {job.company_name}{job.verification_status === "verified" && <span className="badge ml-1 bg-green-100 text-green-700">Verified</span>} · {job.location || "Remote"} · {job.job_type?.replace("_", " ")}
                {job.min_cgpa && <> · Min CGPA {job.min_cgpa}</>}
                {job.application_deadline && <> · Apply by {new Date(job.application_deadline).toLocaleDateString()}</>}
              </p>
              <p className="text-sm mt-2 line-clamp-2">{job.description}</p>
              <div className="flex flex-wrap gap-1.5 mt-3">
                {(job.required_skills || []).map((s) => (
                  <span key={s} className="badge bg-mist text-slate border border-slate-200">{s}</span>
                ))}
              </div>
            </div>
            
{user?.role === "student" ? (
  <button
    className="btn-primary whitespace-nowrap"
    disabled={applying === job.id}
    onClick={() => apply(job.id)}
  >
    {applying === job.id ? "Applying..." : "Apply"}
  </button>
) : !user ? (
  <a
    href="/login"
    className="btn-primary whitespace-nowrap"
  >
    Log in to Apply
  </a>
) : null}

          </div>
        ))}
        {!jobs.length && <p className="text-slate text-sm">No open roles match your search.</p>}
      </div>
    </div>
  );
}
