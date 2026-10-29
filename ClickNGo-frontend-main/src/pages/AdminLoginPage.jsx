import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";

export default function AdminLoginPage() {
  const navigate = useNavigate();
  const { adminLoginFn, showToast } = useAppContext();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();

    if (!email.trim() || !password || !adminCode.trim()) {
      showToast("Email, password, and admin code are required");
      return;
    }

    setLoading(true);
    try {
      await adminLoginFn(email.trim(), password, adminCode.trim());
      showToast("Admin access granted");
      navigate("/admin/dashboard");
    } catch (error) {
      showToast(error.message || "Admin login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="page"
      style={{
        background: "var(--black)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "80px 24px",
      }}
    >
      <div style={{ maxWidth: 960, width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 28 }}>
        <div className="animate-fade-up" style={{ padding: "24px 0" }}>
          <div
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(38px,5vw,54px)",
              lineHeight: 1.05,
              fontWeight: 900,
              marginBottom: 18,
            }}
          >
            Admin
            <br />
            control
            <br />
            <span style={{ color: "var(--yellow)" }}>center</span>
          </div>
          <p style={{ color: "var(--gray-mid)", lineHeight: 1.7, fontSize: 15, maxWidth: 440 }}>
            Sign in with your existing account and the private admin code. Only users with the correct code can unlock the moderation dashboard.
          </p>
          <div style={{ display: "grid", gap: 12, marginTop: 28 }}>
            {[
              "Approve or reject newly listed services",
              "Review provider submissions with notes",
              "Track service, booking, and user metrics",
            ].map((item) => (
              <div key={item} className="glass-card" style={{ padding: 16, borderRadius: 20 }}>
                <div style={{ fontSize: 14, color: "var(--white)" }}>{item}</div>
              </div>
            ))}
          </div>
        </div>

        <form className="glass-card animate-scale" style={{ padding: 32 }} onSubmit={handleSubmit}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 700, marginBottom: 8 }}>
            Admin Portal
          </h2>
          <p style={{ color: "var(--gray-text)", fontSize: 13, marginBottom: 24 }}>
            Use the same email and password as your normal account, plus the admin access code.
          </p>

          <div style={{ display: "grid", gap: 16 }}>
            <div>
              <label className="form-label">Email</label>
              <input className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@company.com" />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input className="form-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Your account password" />
            </div>
            <div>
              <label className="form-label">Admin Code</label>
              <input className="form-input" type="password" value={adminCode} onChange={(e) => setAdminCode(e.target.value)} placeholder="Enter your private admin code" />
            </div>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 26 }}>
            <button className="btn btn-yellow" type="submit" style={{ flex: 1, minWidth: 170 }} disabled={loading}>
              {loading ? "Verifying..." : "Enter Dashboard"}
            </button>
            <button className="btn btn-glass" type="button" onClick={() => navigate("/login")}>
              Back to login
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
