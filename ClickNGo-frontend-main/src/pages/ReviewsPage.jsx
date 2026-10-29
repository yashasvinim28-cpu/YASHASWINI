import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import ReviewCard from "../components/common/ReviewCard";
import { fetchWithAuth } from "../utils/api";

export default function ReviewsPage() {
  const [searchParams] = useSearchParams();
  const serviceId = searchParams.get("serviceId");
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function run() {
      if (!serviceId) {
        setReviews([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const { data } = await fetchWithAuth(`/reviews/service/${serviceId}`);
        setReviews(Array.isArray(data) ? data : []);
      } catch {
        setReviews([]);
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [serviceId]);

  const avg = useMemo(() => {
    if (!reviews.length) return 0;
    return (reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length).toFixed(1);
  }, [reviews]);

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(24px,4vw,40px) clamp(16px,4vw,48px)" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 32, fontWeight: 800, marginBottom: 4 }}>Reviews & Ratings</div>
        <p style={{ color: "var(--gray-mid)", fontSize: 14, marginBottom: 24 }}>
          {serviceId ? "Service-specific reviews" : "Choose a service to view reviews"}
        </p>

        <div className="glass-card" style={{ padding: 20, marginBottom: 20 }}>
          <div style={{ fontSize: 42, color: "var(--yellow)", fontWeight: 800, lineHeight: 1 }}>{avg || "0.0"}</div>
          <div style={{ fontSize: 12, color: "var(--gray-text)" }}>{reviews.length} review{reviews.length === 1 ? "" : "s"}</div>
        </div>

        {loading ? (
          <div className="glass-card" style={{ padding: 20, color: "var(--gray-text)" }}>Loading reviews…</div>
        ) : !reviews.length ? (
          <div className="glass-card" style={{ padding: 20, color: "var(--gray-text)" }}>No reviews yet for this service.</div>
        ) : (
          <div style={{ display: "grid", gap: 14 }}>
            {reviews.map((r, i) => (
              <ReviewCard
                key={r.id}
                i={i}
                r={{
                  avatar: (r.reviewer_name || "U")[0],
                  name: r.reviewer_name || "User",
                  rating: r.rating,
                  date: new Date(r.created_at).toLocaleDateString(),
                  text: r.comment || "",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
