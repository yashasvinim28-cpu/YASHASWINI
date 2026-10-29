import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import GoogleAuthButton from "../components/auth/GoogleAuthButton";

export default function SignupPage() {
  const { registerFn, loginFn, googleAuthFn, showToast } = useAppContext();
  const navigate = useNavigate();
  const [form, setForm] = useState({ first: "", last: "", email: "", phone: "", pass: "", confirm: "" });
  const [role, setRole] = useState("");
  const [loading, setLoading] = useState(false);

  function set(k) {
    return (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  }

  async function handleSignup() {
    if (!form.first || !form.last || !form.email || !form.phone || !form.pass) {
      showToast("Please fill all fields");
      return;
    }
    if (!role) {
      showToast("Please select a role");
      return;
    }
    if (form.pass !== form.confirm) {
      showToast("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const name = `${form.first} ${form.last}`;
      await registerFn(name, form.email, form.pass, role, form.phone);
      
      // Auto-login after successful registration
      await loginFn(form.email, form.pass);
      
      showToast(`Welcome to ClicknGo, ${form.first}.`);
      navigate("/");
    } catch (error) {
      showToast(error.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential) {
    if (!role) {
      showToast("Please select a role before continuing with Google");
      return;
    }

    setLoading(true);
    try {
      await googleAuthFn({
        credential,
        role,
        phone: form.phone,
      });
      showToast(`Welcome to ClicknGo, ${form.first || "there"}.`);
      navigate("/");
    } catch (error) {
      showToast(error.message || "Google signup failed");
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
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          top: "-10%",
          left: "-5%",
          background: "rgba(255,224,51,0.05)",
          borderRadius: "50%",
          filter: "blur(100px)",
          animation: "liquidBlob 10s ease-in-out infinite",
        }}
      />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
          gap: 36,
          maxWidth: 980,
          width: "100%",
          alignItems: "center",
        }}
      >
        <div className="glass-card animate-scale" style={{ padding: 36 }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
            Sign Up
          </h2>
          <p style={{ fontSize: 13, color: "var(--gray-text)", marginBottom: 28 }}>Create your ClicknGo account</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14 }}>
              <div>
                <label className="form-label">First Name</label>
                <input className="form-input" placeholder="First name" value={form.first} onChange={set("first")} />
              </div>
              <div>
                <label className="form-label">Last Name</label>
                <input className="form-input" placeholder="Last name" value={form.last} onChange={set("last")} />
              </div>
            </div>
            <div>
              <label className="form-label">Email Address</label>
              <input
                className="form-input"
                placeholder="sarah@email.com"
                value={form.email}
                onChange={set("email")}
              />
            </div>
            <div>
              <label className="form-label">Contact No.</label>
              <input
                className="form-input"
                placeholder="+1 (555) 000-0000"
                value={form.phone}
                onChange={set("phone")}
              />
            </div>
            <div>
              <label className="form-label">Role</label>
              <select
                required
                className="form-input"
                value={role}
                onChange={(e) => setRole(e.target.value)}
                style={{ background: "#fff", color: "var(--white)" }}
              >
                <option value="">Select Role</option>
                <option value="CUSTOMER">Customer</option>
                <option value="PROVIDER">Provider</option>
              </select>
            </div>
            <div>
              <label className="form-label">Create Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Min. 8 characters"
                value={form.pass}
                onChange={set("pass")}
              />
            </div>
            <div>
              <label className="form-label">Confirm Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Repeat password"
                value={form.confirm}
                onChange={set("confirm")}
              />
            </div>
            <button
              className="btn btn-yellow"
              style={{ width: "100%", borderRadius: 12, padding: 14, marginTop: 4 }}
              onClick={handleSignup}
              disabled={loading}
            >
              {loading ? "Creating Account..." : "Sign Up"}
            </button>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--gray-text)" }}>
              Already have an account?{" "}
              <span
                style={{ color: "var(--yellow)", cursor: "pointer", fontWeight: 600 }}
                onClick={() => navigate("/login")}
              >
                Log In
              </span>
            </div>
            <div className="divider">or</div>
            <button className="social-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              Continue with Apple
            </button>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"></svg>
            <GoogleAuthButton onCredential={handleGoogleCredential} disabled={loading || !role} />
          </div>
        </div>

        <div className="animate-fade-up">
          <div
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(36px,5vw,52px)",
              fontWeight: 900,
              lineHeight: 1.1,
              marginBottom: 20,
            }}
          >
            Join
            <br />
            <span style={{ color: "var(--yellow)" }}>ClicknGo</span>
            <br />
            Today
          </div>
          <p style={{ fontSize: 15, color: "var(--gray-mid)", lineHeight: 1.7, marginBottom: 28 }}>
            Thousands of users trust ClicknGo every day to discover and book the best local services.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              "Free to join, zero hidden fees",
              "Instant booking confirmation",
              "Secure payments via Razorpay / Stripe",
              "Manage all your bookings in one place",
            ].map((t, i) => (
              <div
                key={i}
                className="animate-fade-up"
                style={{ display: "flex", gap: 12, alignItems: "center", animationDelay: `${0.2 + i * 0.08}s` }}
              >
                <div
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--green-dim)",
                    border: "1px solid var(--green)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    color: "var(--green)",
                    flexShrink: 0,
                  }}
                >
                  ✓
                </div>
                <span style={{ fontSize: 14, color: "var(--gray-mid)" }}>{t}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
