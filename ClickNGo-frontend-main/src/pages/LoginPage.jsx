import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import GoogleAuthButton from "../components/auth/GoogleAuthButton";

export default function LoginPage() {
  const { loginFn, googleAuthFn, showToast } = useAppContext();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (new URLSearchParams(location.search).get("session") === "expired") {
      showToast("Your session expired. Please log in again to continue booking.");
    }
  }, [location.search, showToast]);

  async function handleLogin() {
    if (!email || !pass) {
      showToast("Please fill all fields");
      return;
    }
    setLoading(true);
    try {
      await loginFn(email, pass);
      showToast("Login successful. Welcome back!");
      navigate("/");
    } catch (error) {
      showToast(error.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleCredential(credential) {
    setLoading(true);
    try {
      await googleAuthFn({ credential, role: "CUSTOMER" });
      showToast("Google login successful");
      navigate("/");
    } catch (error) {
      showToast(error.message || "Google login failed");
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
          right: "-5%",
          background: "rgba(255,224,51,0.06)",
          borderRadius: "50%",
          filter: "blur(100px)",
          animation: "liquidBlob 10s ease-in-out infinite",
        }}
      />
      <div
        style={{
          position: "absolute",
          width: 350,
          height: 350,
          bottom: "5%",
          left: "-5%",
          background: "rgba(155,89,182,0.08)",
          borderRadius: "50%",
          filter: "blur(80px)",
          animation: "liquidBlob 8s ease-in-out 3s infinite",
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
        <div className="animate-fade-up" style={{ padding: "20px 0" }}>
          <div
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(40px,5vw,56px)",
              fontWeight: 900,
              lineHeight: 1.1,
              marginBottom: 20,
            }}
          >
            Welcome
            <br />
            back to
            <br />
            <span style={{ color: "var(--yellow)" }}>ClicknGo</span>
          </div>
          <p style={{ fontSize: 15, color: "var(--gray-mid)", lineHeight: 1.7 }}>
            Your trusted platform for booking local services — from grooming to gaming, healthcare to home.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, marginTop: 32 }}>
            {[
              { icon: "GR", text: "Grooming" },
              { icon: "RE", text: "Real Estate" },
              { icon: "HC", text: "HealthCare" },
              { icon: "SG", text: "Sports & Gaming" },
            ].map((item, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  fontSize: 14,
                  color: "var(--gray-mid)",
                  animationDelay: `${0.1 + i * 0.08}s`,
                }}
                className="animate-fade-up"
              >
                <span
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 9,
                    background: "var(--yellow-dim)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 16,
                  }}
                >
                  {item.icon}
                </span>
                {item.text}
              </div>
            ))}
          </div>
        </div>

        <div className="glass-card animate-scale" style={{ padding: 36 }}>
          <h2 style={{ fontFamily: "'Playfair Display',serif", fontSize: 26, fontWeight: 700, marginBottom: 4 }}>
            Login Now
          </h2>
          <p style={{ fontSize: 13, color: "var(--gray-text)", marginBottom: 28 }}>Enter your details to continue</p>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label className="form-label">Email</label>
              <input
                className="form-input"
                placeholder="Enter your email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Enter your password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
              />
            </div>
            <div style={{ textAlign: "right", marginTop: -8 }}>
              <span style={{ fontSize: 12, color: "var(--yellow)", cursor: "pointer" }}>Forgot Password?</span>
            </div>
            <button className="btn btn-yellow" style={{ width: "100%", borderRadius: 12, padding: 14 }} onClick={handleLogin} disabled={loading}>
              {loading ? "Logging in..." : "Log In"}
            </button>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--gray-text)" }}>
              Have no account?{" "}
              <span
                style={{ color: "var(--yellow)", cursor: "pointer", fontWeight: 600 }}
                onClick={() => navigate("/signup")}
              >
                Create Now
              </span>
            </div>
            <div style={{ textAlign: "center", fontSize: 13, color: "var(--gray-text)" }}>
              Need admin access?{" "}
              <span
                style={{ color: "var(--yellow)", cursor: "pointer", fontWeight: 600 }}
                onClick={() => navigate("/admin/login")}
              >
                Open admin portal
              </span>
            </div>
            <div className="divider">or</div>
            <button className="social-btn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" marginleft="10px">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              Continue with Apple
            </button>
            <GoogleAuthButton onCredential={handleGoogleCredential} disabled={loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
