import { useNavigate } from "react-router-dom";
import ReviewCard from "../components/common/ReviewCard";
import Footer from "../components/layout/Footer";
import { CATEGORIES, REVIEWS } from "../data/appData";
import { useAppContext } from "../context/AppContext";

export default function HomePage() {
  const navigate = useNavigate();
  const { user, authHydrated } = useAppContext();

  
  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div
        style={{
          position: "relative",
          minHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: "80px 32px 48px",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              width: 600,
              height: 600,
              top: "-10%",
              left: "-5%",
              background: "rgba(255,224,51,0.08)",
              borderRadius: "50%",
              filter: "blur(100px)",
              animation: "liquidBlob 10s ease-in-out infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 400,
              height: 400,
              bottom: "5%",
              right: "5%",
              background: "rgba(155,89,182,0.1)",
              borderRadius: "50%",
              filter: "blur(80px)",
              animation: "liquidBlob 8s ease-in-out 3s infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              width: 300,
              height: 300,
              top: "50%",
              left: "40%",
              background: "rgba(39,174,96,0.07)",
              borderRadius: "50%",
              filter: "blur(80px)",
              animation: "liquidBlob 12s ease-in-out 1s infinite",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage:
                "linear-gradient(rgba(255,255,255,0.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.025) 1px,transparent 1px)",
              backgroundSize: "60px 60px",
            }}
          />
        </div>

        <div style={{ position: "relative", textAlign: "center", maxWidth: 800 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 18px",
              borderRadius: 999,
              background: "rgba(255,224,51,0.1)",
              border: "1px solid rgba(255,224,51,0.25)",
              backdropFilter: "blur(10px)",
              fontSize: 13,
              fontWeight: 600,
              color: "var(--yellow2)",
              marginBottom: 24,
              animation: "fadeUp .5s .1s var(--ease) both",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--yellow)",
                display: "inline-block",
                animation: "pulse 2s infinite",
              }}
            />
            Trusted by 50,000+ users across the city
          </div>

          <h1
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(42px,7vw,82px)",
              fontWeight: 900,
              lineHeight: 1.05,
              letterSpacing: "-2px",
              animation: "fadeUp .6s .2s var(--ease) both",
            }}
          >
            Book Local.
            <br />
            <span
              style={{
                background: "linear-gradient(135deg,var(--yellow),var(--yellow2))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
              }}
            >
              Live Better.
            </span>
          </h1>
          <p
            style={{
              fontSize: "clamp(15px,2vw,18px)",
              color: "var(--gray-mid)",
              marginTop: 20,
              lineHeight: 1.7,
              maxWidth: 520,
              margin: "20px auto 0",
              animation: "fadeUp .6s .35s var(--ease) both",
            }}
          >
            Discover and book trusted services around you — whether it's a haircut, a massage, or home repairs — all in a
            few taps.
          </p>

          <div
            style={{
              display: "flex",
              gap: 14,
              justifyContent: "center",
              marginTop: 36,
              flexWrap: "wrap",
              animation: "fadeUp .5s .45s var(--ease) both",
            }}
          >
            <button className="btn btn-yellow" onClick={() => navigate("/category/grooming")}>
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 3l14 9-14 9V3z" />
              </svg>
              Book Now
            </button>
            {authHydrated && user?.role === "PROVIDER" && (
              <button className="btn btn-glass" onClick={() => navigate("/provider")}>
                List Your Business
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 20,
            marginTop: 64,
            flexWrap: "wrap",
            justifyContent: "center",
            animation: "fadeUp .6s .55s var(--ease) both",
          }}
        >
          {CATEGORIES.map((c, i) => (
            <div
              key={c.id}
              className="glass card-hover"
              onClick={() => navigate(`/category/${c.id}`)}
              style={{
                padding: "14px 22px",
                borderRadius: 16,
                display: "flex",
                alignItems: "center",
                gap: 10,
                cursor: "pointer",
                animationDelay: `${0.6 + i * 0.1}s`,
              }}
            >
              <img src={c.icon} alt={c.label} style={{ width: 30, height: 30 }} />
              <span style={{ fontSize: 14, fontWeight: 600 }}>{c.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          background: "var(--black2)",
          padding: "clamp(36px,6vw,72px) clamp(18px,4vw,48px)",
        }}
      >
        <div style={{ maxWidth: 1100, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <h2 className="section-title animate-fade-up">
              Everything you need,
              <br />
              All in One App
            </h2>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
              gap: 24,
            }}
          >
            {CATEGORIES.map((cat, i) => (
              <div
                key={cat.id}
                className="glass-card card-hover animate-fade-up"
                style={{
                  padding: 28,
                  animationDelay: `${i * 0.1}s`,
                  cursor: "pointer",
                }}
                onClick={() => navigate(`/category/${cat.id}`)}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: cat.bg,
                    border: `1px solid ${cat.color}30`,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 24,
                    marginBottom: 16,
                  }}
                >
                  <img src={cat.icon} alt={cat.label} style={{ width: 32, height: 32 }} />
                </div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 10 }}>{cat.label}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {cat.subs.slice(0, 3).map((s) => (
                    <span
                      key={s}
                      style={{
                        padding: "4px 12px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,0.06)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        fontSize: 12,
                        color: "var(--gray-mid)",
                      }}
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "clamp(36px,6vw,72px) clamp(18px,4vw,48px)" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <h2 className="section-title" style={{ textAlign: "center", marginBottom: 48 }}>
            How it Works
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
              gap: 24,
            }}
          >
            {[
              {
                n: "1",
                title: "Browse Services",
                desc: "Choose from a wide range of local providers categorized by your needs.",
                icon: "",
              },
              {
                n: "2",
                title: "Pick a Time",
                desc: "View real-time availability and lock in a time that suits you perfectly.",
                icon: "",
              },
              {
                n: "3",
                title: "Book & Pay Securely",
                desc: "Pay online and get instant confirmation. It's that simple.",
                icon: "",
              },
            ].map((step, i) => (
              <div
                key={i}
                className="glass-card animate-fade-up"
                style={{ padding: 28, animationDelay: `${i * 0.12}s` }}
              >
                <div
                  style={{
                    fontFamily: "'Playfair Display',serif",
                    fontSize: 52,
                    fontWeight: 900,
                    color: "var(--yellow)",
                    opacity: 0.9,
                    lineHeight: 1,
                    marginBottom: 12,
                  }}
                >
                  {step.n}
                </div>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{step.icon}</div>
                <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{step.title}</div>
                <div style={{ fontSize: 14, color: "var(--gray-mid)", lineHeight: 1.6 }}>{step.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          background: "var(--black2)",
          padding: "clamp(36px,6vw,72px) clamp(18px,4vw,48px)",
        }}
      >
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <h2 className="section-title" style={{ textAlign: "center", marginBottom: 48 }}>
            Why Choose Us?
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))",
              gap: 20,
            }}
          >
            {[
              {
                icon: "RT",
                title: "Real-Time Booking Calendar",
                desc: "See instantly when your provider is available — powered by live data.",
              },
              {
                icon: "SP",
                title: "Secure Payments",
                desc: "Safe and fast transactions through Razorpay or Stripe. Fully encrypted.",
              },
              {
                icon: "IN",
                title: "Instant Notifications",
                desc: "Stay informed with SMS and email updates at every step.",
              },
              {
                icon: "BD",
                title: "Business Dashboard",
                desc: "Manage services and appointments from one powerful place.",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="glass-card animate-fade-up"
                style={{
                  padding: 24,
                  display: "flex",
                  gap: 16,
                  alignItems: "flex-start",
                  animationDelay: `${i * 0.1}s`,
                }}
              >
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    background: "var(--yellow-dim)",
                    border: "1px solid rgba(255,224,51,0.2)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    flexShrink: 0,
                  }}
                >
                  {f.icon}
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 5 }}>{f.title}</div>
                  <div style={{ fontSize: 13, color: "var(--gray-mid)", lineHeight: 1.6 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "clamp(36px,6vw,72px) clamp(18px,4vw,48px)" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 36,
            }}
          >
            <h2 className="section-title">What People Say</h2>
            <button
              className="btn btn-glass"
              style={{ fontSize: 13, padding: "9px 20px" }}
              onClick={() => navigate("/reviews")}
            >
              View All
            </button>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))",
              gap: 20,
            }}
          >
            {REVIEWS.slice(0, 3).map((r, i) => (
              <ReviewCard key={i} r={r} i={i} />
            ))}
          </div>
        </div>
      </div>

      <div
        style={{
          margin: "0 clamp(18px,4vw,48px) clamp(32px,6vw,72px)",
          borderRadius: 24,
          overflow: "hidden",
          position: "relative",
          background: "linear-gradient(135deg,rgba(255,224,51,0.15),rgba(255,224,51,0.05))",
          border: "1px solid rgba(255,224,51,0.2)",
          padding: "56px 48px",
          textAlign: "center",
          backdropFilter: "blur(20px)",
        }}
      >
        <div style={{ position: "absolute", inset: 0, overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              width: 300,
              height: 300,
              top: "-30%",
              right: "-5%",
              background: "rgba(255,224,51,0.08)",
              borderRadius: "50%",
              filter: "blur(60px)",
            }}
          />
        </div>
        <div style={{ position: "relative" }}>
          <h2
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(28px,4vw,42px)",
              fontWeight: 800,
              marginBottom: 12,
            }}
          >
            Try the Easiest Way to
            <br />
            Book Local Services
          </h2>
          <p style={{ color: "var(--gray-mid)", fontSize: 16, marginBottom: 32 }}>
            Join thousands who trust us for their daily needs.
          </p>
          <button
            className="btn btn-yellow"
            style={{ fontSize: 16, padding: "15px 36px" }}
            onClick={() => navigate("/category/grooming")}
          >
            Get Started
          </button>
        </div>
      </div>

      <Footer />
    </div>
  );
}
