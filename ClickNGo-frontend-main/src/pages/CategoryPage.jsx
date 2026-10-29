import { useEffect, useState, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import ProviderRow from "../components/common/ProviderRow";
import { CATEGORIES } from "../data/appData";
import { useCategoryServices } from "../hooks/useCategoryServices";
import { useAppContext } from "../context/AppContext";
import { haversineKm, formatDistance } from "../utils/distance";

export default function CategoryPage() {
  const { catId } = useParams();
  const navigate = useNavigate();
  const cat = CATEGORIES.find((c) => c.id === catId);
  const [activeFilter, setActiveFilter] = useState("All");
  const [retryKey, setRetryKey] = useState(0);
  const { coords } = useAppContext();

  const { services, loading, error } = useCategoryServices(catId, retryKey);

  const filters = useMemo(() => ["All", ...(cat?.subs || []).slice(0, 5)], [cat?.subs]);

  useEffect(() => {
    setActiveFilter("All");
  }, [catId]);

  const providers = useMemo(() => {
    return (services || []).map((s) => ({
      id: s.id,
      name: s.title,
      sub: s.description || "",
      rating: 4.5,
      reviews: 0,
      dist:
        formatDistance(
          haversineKm(coords, {
            latitude: s.latitude,
            longitude: s.longitude,
          })
        ) || s.location_address || "Location unavailable",
      time: `${s.duration_minutes} mins`,
      price: s.price,
      icon: cat?.icon || "/images/GR.png",
      tags: s.tags || [],
    }));
  }, [services, cat?.icon]);

  const filteredProviders =
    activeFilter === "All"
      ? providers
      : providers.filter((p) => {
          const filterLower = activeFilter.toLowerCase();
          const subLower = (p.sub || "").toLowerCase();
          const tagsLower = (p.tags || []).map((t) => t.toLowerCase());
          const filterWords = filterLower.split(/[\s&]+/).filter((w) => w.length > 2);
          const matchesFilter = (text) =>
            text.includes(filterLower) || filterWords.some((w) => text.includes(w));
          return matchesFilter(subLower) || tagsLower.some(matchesFilter);
        });

  return (
    <div className="page" style={{ background: "var(--black)", minHeight: "100vh" }}>
      <div
        style={{
          position: "relative",
          padding: "48px 48px 36px",
          background: `linear-gradient(135deg,${cat?.bg || "rgba(255,255,255,0.05)"},transparent)`,
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at 80% 50%,${cat?.color || "#fff"}15 0%,transparent 70%)`,
          }}
        />
        <div style={{ position: "relative" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span
              style={{
                width: 52,
                height: 52,
                borderRadius: 16,
                background: cat?.bg,
                border: `1px solid ${cat?.color}40`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 24,
                backdropFilter: "blur(10px)",
              }}
            >
              {cat?.icon ? <img src={cat.icon} alt={cat?.label} style={{ width: 28, height: 28 }} /> : null}
            </span>
            <div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: "'Playfair Display',serif" }}>
                {cat?.label ?? "Category"}
              </div>
              <div style={{ fontSize: 13, color: "var(--gray-mid)" }}>
                {loading
                  ? "Loading…"
                  : `${filteredProviders.length} service${filteredProviders.length !== 1 ? "s" : ""} in this category`}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 9, flexWrap: "wrap", marginTop: 20 }}>
            {filters.map((f) => (
              <div
                key={f}
                className={`chip${activeFilter === f ? " active" : ""}`}
                onClick={() => setActiveFilter(f)}
                style={activeFilter === f ? {} : { borderColor: `${cat?.color}30`, color: "var(--gray-mid)" }}
              >
                {f}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(20px,4vw,32px) clamp(16px,4vw,48px)" }}>
        <div
          style={{
            borderRadius: "var(--r)",
            overflow: "hidden",
            border: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.02)",
          }}
        >
          {loading ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--gray-mid)", fontSize: 15 }}>
              Loading services…
            </div>
          ) : error ? (
            <div style={{ padding: 48, textAlign: "center" }}>
              <div style={{ color: "var(--gray-mid)", fontSize: 15, marginBottom: 16 }}>
                {error === "unknown_category"
                  ? "This category link does not match any category on the server. Try another category."
                  : "Could not load services."}
              </div>
              <button type="button" className="btn btn-yellow" style={{ fontSize: 13 }} onClick={() => setRetryKey((k) => k + 1)}>
                Retry
              </button>
            </div>
          ) : !loading && filteredProviders.length === 0 && activeFilter === "All" ? (
            <div style={{ padding: 48, textAlign: "center", color: "var(--gray-mid)", fontSize: 15 }}>
              No services found for this category yet.
            </div>
          ) : filteredProviders.length === 0 ? (
            <div
              style={{
                padding: 48,
                textAlign: "center",
                color: "var(--gray-mid)",
                fontSize: 15,
              }}
            >
              No services match “{activeFilter}”. Try another filter.
            </div>
          ) : (
            filteredProviders.map((p, i) => (
              <div key={p.id}>
                <ProviderRow p={p} onClick={() => navigate(`/detail/${p.id}`)} accentColor={cat?.color} />
                {i < filteredProviders.length - 1 && (
                  <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 20px" }} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
