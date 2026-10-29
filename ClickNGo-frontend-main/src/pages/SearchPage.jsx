import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import ProviderRow from "../components/common/ProviderRow";
import { CATEGORIES } from "../data/appData";
import { fetchWithAuth } from "../utils/api";
import { useAppContext } from "../context/AppContext";
import { haversineKm, formatDistance } from "../utils/distance";

const slugify = (val) => String(val || "").toLowerCase().replace(/[^a-z0-9]/g, "");

export default function SearchPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast, coords } = useAppContext();
  const query = searchParams.get("q") || "";

  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function doSearch() {
      setLoading(true);
      try {
        const { data } = await fetchWithAuth(`/services?q=${encodeURIComponent(query)}`);
        // Map backend service row to what ProviderRow expects
        const mapped = data.map(s => {
          const backendCatSlug = s.category_name ? slugify(s.category_name) : slugify(s.category_id);
          const cat = CATEGORIES.find(c => slugify(c.id) === backendCatSlug);
          return {
            id: s.id, // we will route to /detail/:service_id later
            provider_id: s.provider_id,
            catId: s.category_id,
            name: s.title,
            sub: s.description?.substring(0, 50) + '...',
            price: s.price,
            tags: s.tags || [],
            icon: cat ? cat.icon : "/images/GR.png",
            rating: 4.5, // placeholder until we join reviews
            reviews: 10,
            dist: formatDistance(
              haversineKm(coords, {
                latitude: s.latitude,
                longitude: s.longitude,
              })
            ) || s.location_address || "Location unavailable",
            time: `${s.duration_minutes} mins`
          };
        });
        setResults(mapped);
      } catch (err) {
        showToast("Error fetching search results");
      } finally {
        setLoading(false);
      }
    }
    doSearch();
  }, [query, showToast, coords]);

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "clamp(24px,4vw,40px) clamp(16px,4vw,48px)" }}>
        <div style={{ marginBottom: 8, fontSize: 13, color: "var(--gray-text)" }}>Search results for</div>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, marginBottom: 4 }}>
          "{query}"
        </div>
        <div style={{ fontSize: 13, color: "var(--gray-mid)", marginBottom: 32 }}>
          {loading ? "Searching..." : `${results.length} result${results.length !== 1 ? "s" : ""} found`}
        </div>

        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[1, 2, 3].map(i => (
              <div key={i} className="glass-card" style={{ padding: 40, opacity: 0.5, animation: "pulse 2s infinite" }} />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="glass-card" style={{ padding: 48, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>🔍</div>
            <div style={{ fontWeight: 700, marginBottom: 6 }}>No results found</div>
            <div style={{ fontSize: 13, color: "var(--gray-text)", marginBottom: 20 }}>
              Try searching for "Haircut", "Dental", "Gaming" etc.
            </div>
            <button
              className="btn btn-yellow"
              style={{ fontSize: 13, padding: "10px 24px" }}
              onClick={() => navigate("/")}
            >
              Go Home
            </button>
          </div>
        ) : (
          <div
            style={{
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 20,
              overflow: "hidden",
              background: "rgba(255,255,255,0.02)",
            }}
          >
            {results.map((p, i) => {
              const cat = CATEGORIES.find((c) => c.id === p.catId);
              return (
                <div key={p.id}>
                  {/* Notice we navigate to detail/:service_id instead of provider_id */}
                  <ProviderRow p={p} onClick={() => navigate(`/detail/${p.id}`)} accentColor={cat?.color} />
                  {i < results.length - 1 && (
                    <div style={{ height: 1, background: "rgba(255,255,255,0.05)", margin: "0 20px" }} />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
