import { useNavigate } from "react-router-dom";

export default function NotFoundPage() {
  const navigate = useNavigate();

  return (
    <div
      className="page"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--black)",
      }}
    >
      <div className="animate-scale" style={{ textAlign: "center", padding: 48 }}>
        <div
          style={{
            fontFamily: "'Playfair Display',serif",
            fontSize: "clamp(80px,15vw,140px)",
            fontWeight: 900,
            color: "var(--yellow)",
            lineHeight: 1,
            opacity: 0.7,
          }}
        >
          404
        </div>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
          Page Not Found
        </div>
        <p style={{ fontSize: 14, color: "var(--gray-mid)", marginBottom: 28 }}>
          The page you're looking for doesn't exist or was moved.
        </p>
        <button className="btn btn-yellow" onClick={() => navigate("/")}>
          Back to Home
        </button>
      </div>
    </div>
  );
}
