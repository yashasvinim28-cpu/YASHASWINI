import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fetchWithAuth } from "../../utils/api";
import { useAppContext } from "../../context/AppContext";

export default function ManageServicePage() {
  const { serviceId } = useParams();
  const navigate = useNavigate();
  const { user, showToast } = useAppContext();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [categories, setCategories] = useState([]);
  const [form, setForm] = useState({
    category_id: "",
    title: "",
    description: "",
    price: "",
    duration_minutes: 30,
    tags: "",
    location_address: "",
  });

  useEffect(() => {
    async function run() {
      setLoading(true);
      try {
        const [{ data: svc }, { data: catData }] = await Promise.all([
          fetchWithAuth(`/services/my/${serviceId}`),
          fetchWithAuth("/services/categories"),
        ]);
        if (!svc?.id) throw new Error("Service not found");
        if (svc.provider_id !== user?.id) {
          showToast("You are not allowed to manage this service");
          navigate("/provider/dashboard");
          return;
        }
        setCategories(Array.isArray(catData) ? catData : []);
        setForm({
          category_id: svc.category_id || "",
          title: svc.title || "",
          description: svc.description || "",
          price: String(svc.price ?? ""),
          duration_minutes: Number(svc.duration_minutes || 30),
          tags: Array.isArray(svc.tags) ? svc.tags.join(", ") : "",
          location_address: svc.location_address || "",
        });
      } catch (e) {
        showToast(e.message || "Could not load service");
        navigate("/provider/dashboard");
      } finally {
        setLoading(false);
      }
    }
    run();
  }, [serviceId, user?.id, navigate, showToast]);

  function setField(k) {
    return (e) => setForm((prev) => ({ ...prev, [k]: e.target.value }));
  }

  async function handleUpdate(e) {
    e.preventDefault();
    if (!form.title.trim() || !form.category_id || !form.location_address.trim()) {
      showToast("Title, category and location are required");
      return;
    }
    setSaving(true);
    try {
      await fetchWithAuth(`/services/${serviceId}`, {
        method: "PATCH",
        body: JSON.stringify({
          category_id: form.category_id,
          title: form.title.trim(),
          description: form.description.trim(),
          price: Number(form.price),
          duration_minutes: Number(form.duration_minutes),
          tags: form.tags.trim() ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
          location_address: form.location_address.trim(),
        }),
      });
      showToast("Service updated");
      navigate("/provider/dashboard");
    } catch (e2) {
      showToast(e2.message || "Update failed");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const ok = window.confirm("Archive this service? Historical bookings remain intact.");
    if (!ok) return;
    setDeleting(true);
    try {
      await fetchWithAuth(`/services/${serviceId}`, { method: "DELETE" });
      showToast("Service archived");
      navigate("/provider/dashboard");
    } catch (e) {
      showToast(e.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  }

  if (loading) return <div className="page" style={{ padding: 80, textAlign: "center" }}>Loading service…</div>;

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 700, margin: "0 auto", padding: "28px 16px 48px" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 30, fontWeight: 800, marginBottom: 8 }}>Manage Service</div>
        <p style={{ color: "var(--gray-mid)", fontSize: 14, marginBottom: 20 }}>
          Update details or archive this service. Past bookings remain available in history.
        </p>
        <form className="glass-card" style={{ padding: 22 }} onSubmit={handleUpdate}>
          <div style={{ display: "grid", gap: 12 }}>
            <select className="form-input" value={form.category_id} onChange={setField("category_id")} required>
              <option value="">Select category</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <input className="form-input" value={form.title} onChange={setField("title")} placeholder="Service title" required />
            <textarea className="form-input" rows={4} value={form.description} onChange={setField("description")} placeholder="Description" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <input className="form-input" type="number" min={0} value={form.price} onChange={setField("price")} placeholder="Price" />
              <input className="form-input" type="number" min={15} step={15} value={form.duration_minutes} onChange={setField("duration_minutes")} placeholder="Duration" />
            </div>
            <input className="form-input" value={form.tags} onChange={setField("tags")} placeholder="Tags (comma separated)" />
            <input className="form-input" value={form.location_address} onChange={setField("location_address")} placeholder="Service location" required />
            <div style={{ fontSize: 12, color: "var(--gray-text)" }}>Coordinates are re-fetched automatically when location changes.</div>
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn btn-yellow" type="submit" disabled={saving}>{saving ? "Saving…" : "Update service"}</button>
            <button className="btn btn-glass" type="button" onClick={() => navigate("/provider/dashboard")}>Cancel</button>
            <button className="btn btn-glass" type="button" onClick={handleDelete} disabled={deleting} style={{ marginLeft: "auto", borderColor: "rgba(255,80,80,.5)", color: "#ff8a8a" }}>
              {deleting ? "Archiving…" : "Archive service"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
