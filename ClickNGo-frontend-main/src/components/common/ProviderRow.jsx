import StarRating from "./StarRating";

export default function ProviderRow({ p, onClick, accentColor }) {
  return (
    <div className="provider-card animate-fade-up" onClick={onClick}>
      <div
        className="provider-img"
        style={{
          background: `${accentColor || "#fff"}10`,
          border: `1px solid ${accentColor || "#fff"}20`,
        }}
      >
        <img src={p.icon} alt={p.name} style={{ width: "60px", height: "60px", objectFit: "contain" }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{p.name}</div>
          {p.price > 0 && (
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--yellow)" }}>₹{p.price}</div>
          )}
        </div>
        <div style={{ fontSize: 13, color: "var(--gray-mid)", marginBottom: 8 }}>{p.sub}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
          <StarRating rating={p.rating} count={p.reviews} />
          <span
            style={{
              fontSize: 12,
              color: "var(--gray-text)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            {p.dist}
          </span>
          <span
            style={{
              fontSize: 12,
              color: "var(--gray-text)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            {p.time}
          </span>
        </div>
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {(p.tags || []).map((t) => (
            <span
              key={t}
              style={{
                padding: "3px 10px",
                borderRadius: 999,
                background: "rgba(255,255,255,0.05)",
                border: "1px solid rgba(255,255,255,0.08)",
                fontSize: 11,
                color: "var(--gray-mid)",
              }}
            >
              {t}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
