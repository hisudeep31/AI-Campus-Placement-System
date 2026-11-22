import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="max-w-4xl mx-auto px-6 py-20 text-center">
      <h1 className="text-4xl font-display font-semibold mb-4">
        AI-powered campus placements
      </h1>
      <p className="text-slate max-w-xl mx-auto mb-8">
        Resume scoring, skill-gap analysis, job matching, and mock interviews —
        one platform for students, companies, and placement officers.
      </p>
      <div className="flex gap-3 justify-center">
        <Link to="/jobs" className="btn-primary">Browse open roles</Link>
        <Link to="/register" className="btn-secondary">Create an account</Link>
      </div>
    </div>
  );
}
