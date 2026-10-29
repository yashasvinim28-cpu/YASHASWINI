import { useNavigate } from "react-router-dom";
import Footer from "../../components/layout/Footer";

export default function ProviderLandingPage() {
  const navigate = useNavigate();

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div
        style={{
          position: "relative",
          padding: "64px 48px 48px",
          textAlign: "center",
          overflow: "hidden",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "radial-gradient(ellipse at 50% 100%,rgba(255,224,51,0.08),transparent 70%)",
          }}
        />
        <div style={{ position: "relative" }}>
          <span className="badge badge-yellow" style={{ marginBottom: 16, display: "inline-flex" }}>
            For Business Owners
          </span>
          <h1
            style={{
              fontFamily: "'Playfair Display',serif",
              fontSize: "clamp(32px,5vw,52px)",
              fontWeight: 900,
              marginBottom: 16,
            }}
          >
            Grow Your Business
            <br />
            with ClicknGo
          </h1>
          <p style={{ fontSize: 16, color: "var(--gray-mid)", maxWidth: 540, margin: "0 auto 32px" }}>
            Join 3,000+ local businesses already using ClicknGo to manage bookings, reach new customers, and grow
            revenue.
          </p>
          <button className="btn btn-yellow" style={{ fontSize: 16, padding: "15px 36px" }} onClick={() => navigate("/provider/service/create")}>
            Get Started
          </button>
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))",
          gap: 20,
          maxWidth: 980,
          margin: "48px auto",
          padding: "0 clamp(16px,4vw,48px)",
        }}
      >
        {[
          {
            icon: "SD",
            title: "Smart Dashboard",
            desc: "Track bookings, revenue, and customer reviews in real-time.",
          },
          {
            icon: "BC",
            title: "Booking Calendar",
            desc: "Manage your availability. Customers book only when you're free.",
          },
          {
            icon: "IP",
            title: "Instant Payouts",
            desc: "Get paid instantly via Razorpay or Stripe. Zero delays.",
          },
        ].map((f, i) => (
          <div
            key={i}
            className="glass-card animate-fade-up"
            style={{ padding: 24, animationDelay: `${i * 0.1}s`, textAlign: "center" }}
          >
            <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{f.title}</div>
            <div style={{ fontSize: 13, color: "var(--gray-mid)", lineHeight: 1.6 }}>{f.desc}</div>
          </div>
        ))}
      </div>

      <Footer />
    </div>
  );
}
