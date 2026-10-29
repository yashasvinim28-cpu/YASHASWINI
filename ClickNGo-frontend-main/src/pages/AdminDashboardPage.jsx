import { useEffect, useMemo, useState } from "react";
import { fetchWithAuth } from "../utils/api";
import { useAppContext } from "../context/AppContext";

const FILTERS = ["ALL", "PENDING", "APPROVED", "REJECTED"];

export default function AdminDashboardPage() {
  const { showToast } = useAppContext();
  const [dashboard, setDashboard] = useState(null);
  const [services, setServices] = useState([]);
  const [filter, setFilter] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [actioningId, setActioningId] = useState("");
  const [notes, setNotes] = useState({});

  useEffect(() => {
    loadDashboard();
  }, []);

  useEffect(() => {
    loadServices(filter);
  }, [filter]);

  async function loadDashboard() {
    try {
      const { data } = await fetchWithAuth("/admin/dashboard");
      setDashboard(data);
    } catch (error) {
      showToast(error.message || "Could not load admin dashboard");
    }
  }

  async function loadServices(statusValue) {
    setLoading(true);
    try {
      const { data } = await fetchWithAuth(`/admin/services?status=${statusValue}`);
      setServices(Array.isArray(data) ? data : []);
    } catch (error) {
      showToast(error.message || "Could not load services");
    } finally {
      setLoading(false);
    }
  }

  async function handleReview(serviceId, approvalStatus) {
    setActioningId(serviceId);
    try {
      await fetchWithAuth(`/admin/services/${serviceId}/review`, {
        method: "PATCH",
        body: JSON.stringify({
          approval_status: approvalStatus,
          admin_review_note: notes[serviceId] ?? "",
        }),
      });
      showToast(approvalStatus === "APPROVED" ? "Service approved" : "Service rejected");
      await Promise.all([loadDashboard(), loadServices(filter)]);
    } catch (error) {
      showToast(error.message || "Could not update service review");
    } finally {
      setActioningId("");
    }
  }

  const statCards = useMemo(() => {
    const overview = dashboard?.overview || {};
    return [
      ["Pending reviews", overview.pending_services || 0],
      ["Approved services", overview.approved_services || 0],
      ["Rejected services", overview.rejected_services || 0],
      ["Providers", overview.providers_count || 0],
      ["Customers", overview.customers_count || 0],
      ["Bookings", overview.total_bookings || 0],
      ["Revenue", `₹${Number(overview.total_revenue || 0).toFixed(2)}`],
      ["Admins", overview.admins_count || 0],
    ];
  }, [dashboard]);

  function badgeClass(status) {
    if (status === "APPROVED") return "badge-green";
    if (status === "REJECTED") return "badge-red";
    return "badge-yellow";
  }

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "clamp(24px,4vw,44px) clamp(16px,4vw,44px)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(32px,4vw,42px)", fontWeight: 900 }}>
              Admin Dashboard
            </div>
            <p style={{ color: "var(--gray-mid)", fontSize: 14, marginTop: 8 }}>
              Review newly submitted services, manage approvals, and monitor platform growth from one place.
            </p>
          </div>
          <div className="glass-card" style={{ padding: "14px 18px", borderRadius: 20 }}>
            <div style={{ color: "var(--gray-text)", fontSize: 12, textTransform: "uppercase", letterSpacing: 1 }}>Review flow</div>
            <div style={{ fontSize: 14, color: "var(--white)", marginTop: 6 }}>Providers submit services, admins approve or reject them, and approved services go live.</div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12, marginBottom: 28 }}>
          {statCards.map(([label, value]) => (
            <div key={label} className="glass-card" style={{ padding: 18, borderRadius: 24 }}>
              <div style={{ color: "var(--gray-text)", fontSize: 12 }}>{label}</div>
              <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, marginTop: 6, color: "var(--yellow)" }}>
                {value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,2.1fr) minmax(300px,1fr)", gap: 18 }}>
          <div className="glass-card" style={{ padding: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h3 style={{ fontSize: 22, fontWeight: 800 }}>Service moderation queue</h3>
                <p style={{ color: "var(--gray-text)", fontSize: 13, marginTop: 6 }}>
                  Approve services to make them visible across public search and category pages.
                </p>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FILTERS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={`chip ${filter === item ? "active" : ""}`}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: "center", color: "var(--gray-text)" }}>Loading services...</div>
            ) : services.length === 0 ? (
              <div style={{ padding: 28, borderRadius: 22, background: "rgba(255,255,255,0.4)", color: "var(--gray-mid)" }}>
                No services found for the current filter.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {services.map((service) => (
                  <div key={service.id} style={{ padding: 18, borderRadius: 24, border: "1px solid rgba(255,255,255,0.7)", background: "rgba(255,255,255,0.44)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <strong style={{ fontSize: 18 }}>{service.title}</strong>
                          <span className={`badge ${badgeClass(service.approval_status)}`}>
                            {service.approval_status}
                          </span>
                        </div>
                        <div style={{ fontSize: 13, color: "var(--gray-mid)", marginTop: 8 }}>
                          {service.provider_name} • {service.provider_email} • {service.category_name || "Uncategorized"}
                        </div>
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--yellow)" }}>
                        ₹{Number(service.price || 0).toFixed(2)}
                      </div>
                    </div>

                    <div style={{ fontSize: 14, color: "var(--gray-mid)", lineHeight: 1.6, marginTop: 12 }}>
                      {service.description || "No description provided."}
                    </div>

                    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", fontSize: 12, color: "var(--gray-text)", marginTop: 12 }}>
                      <span>Duration: {service.duration_minutes} mins</span>
                      <span>Address: {service.location_address || "Not provided"}</span>
                    </div>

                    {Array.isArray(service.tags) && service.tags.length > 0 && (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                        {service.tags.map((tag) => (
                          <span key={`${service.id}-${tag}`} className="chip" style={{ cursor: "default" }}>
                            {tag}
                          </span>
                        ))}
                      </div>
                    )}

                    <div style={{ marginTop: 14 }}>
                      <label className="form-label">Admin note</label>
                      <textarea
                        className="form-input"
                        rows={3}
                        value={notes[service.id] ?? service.admin_review_note ?? ""}
                        onChange={(e) => setNotes((current) => ({ ...current, [service.id]: e.target.value }))}
                        placeholder="Optional reason for approval guidance or rejection feedback"
                      />
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
                      <button
                        type="button"
                        className="btn btn-yellow"
                        onClick={() => handleReview(service.id, "APPROVED")}
                        disabled={actioningId === service.id}
                      >
                        {actioningId === service.id ? "Saving..." : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-glass"
                        style={{ borderColor: "rgba(239,68,68,0.35)", color: "var(--red)" }}
                        onClick={() => handleReview(service.id, "REJECTED")}
                        disabled={actioningId === service.id}
                      >
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ display: "grid", gap: 18 }}>
            <div className="glass-card" style={{ padding: 22 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>Recent activity</h3>
              <div style={{ display: "grid", gap: 12 }}>
                {(dashboard?.recentServices || []).map((service) => (
                  <div key={service.id} style={{ padding: 14, borderRadius: 18, background: "rgba(255,255,255,0.42)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                      <strong>{service.title}</strong>
                      <span className={`badge ${badgeClass(service.approval_status)}`}>
                        {service.approval_status}
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--gray-mid)", marginTop: 8 }}>
                      {service.provider_name} • {service.category_name || "Uncategorized"}
                    </div>
                    {service.admin_review_note && (
                      <div style={{ fontSize: 12, color: "var(--gray-text)", marginTop: 8 }}>
                        Note: {service.admin_review_note}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="glass-card" style={{ padding: 22 }}>
              <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 14 }}>How access works</h3>
              <div style={{ display: "grid", gap: 10, color: "var(--gray-mid)", fontSize: 14, lineHeight: 1.6 }}>
                <div>Admins sign in through the dedicated portal with email, password, and your private admin code.</div>
                <div>When the code is correct, that login session gets ADMIN access and can open the dashboard.</div>
                <div>Public service discovery now shows only approved listings.</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
