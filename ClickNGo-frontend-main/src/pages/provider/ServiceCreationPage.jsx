import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";
import { fetchWithAuth } from "../../utils/api";

/**
 * POST /api/services body (aligned with backend):
 * { category_id, title, description, price, duration_minutes, tags }
 */
export default function ServiceCreationPage() {
  const navigate = useNavigate();
  const { showToast } = useAppContext();

  const [categories, setCategories] = useState([]);
  const [loadingCats, setLoadingCats] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [category_id, setCategoryId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [duration_minutes, setDurationMinutes] = useState(30);
  const [tagsInput, setTagsInput] = useState("");
  const [locationAddress, setLocationAddress] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await fetchWithAuth("/services/categories");
        setCategories(Array.isArray(data) ? data : []);
      } catch (e) {
        showToast(e.message || "Could not load categories");
      } finally {
        setLoadingCats(false);
      }
    })();
  }, [showToast]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!category_id) {
      showToast("Please select a category");
      return;
    }
    if (!title.trim()) {
      showToast("Please enter a service title");
      return;
    }
    if (!description.trim()) {
      showToast("Please enter a description");
      return;
    }
    const priceNum = Number(price);
    if (Number.isNaN(priceNum) || priceNum < 0) {
      showToast("Please enter a valid price");
      return;
    }
    const dur = Number(duration_minutes);
    if (Number.isNaN(dur) || dur <= 0 || dur % 15 !== 0) {
      showToast("Duration must be a positive multiple of 15 minutes");
      return;
    }
    const tags = tagsInput.trim()
      ? tagsInput.split(",").map((t) => t.trim()).filter(Boolean)
      : [];

    const payload = {
      category_id,
      title: title.trim(),
      description: description.trim(),
      price: priceNum,
      duration_minutes: dur,
      tags,
      location_address: locationAddress.trim(),
    };

    if (!payload.location_address) {
      showToast("Please enter service location");
      return;
    }

    setSubmitting(true);
    try {
      await fetchWithAuth("/services", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      showToast("Service submitted for admin approval");
      navigate("/provider/dashboard");
    } catch (err) {
      showToast(err.message || "Could not create service");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(24px,4vw,48px) clamp(16px,4vw,48px)" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: "clamp(28px,4vw,36px)", fontWeight: 800, marginBottom: 8 }}>
          Create a service
        </div>
        <p style={{ color: "var(--gray-mid)", fontSize: 14, marginBottom: 28 }}>
          List a bookable service: category, pricing, duration, and optional tags. New services are sent to admin for approval before they appear publicly.
        </p>

        <form className="glass-card animate-scale" style={{ padding: 32 }} onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label className="form-label">Category</label>
              <select
                className="form-input"
                required
                value={category_id}
                onChange={(e) => setCategoryId(e.target.value)}
                disabled={loadingCats}
                style={{ background: "#fff", color: "var(--white)" }}
              >
                <option value="">{loadingCats ? "Loading categories…" : "Select category"}</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="form-label">Service title</label>
              <input
                className="form-input"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Premium haircut"
                required
              />
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea
                className="form-input"
                rows={4}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What customers get, what to expect"
                required
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
              <div>
                <label className="form-label">Price (₹)</label>
                <input
                  className="form-input"
                  type="number"
                  min={0}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Duration (minutes)</label>
                <input
                  className="form-input"
                  type="number"
                  min={15}
                  step={15}
                  value={duration_minutes}
                  onChange={(e) => setDurationMinutes(e.target.value)}
                  required
                />
              </div>
            </div>
            <div>
              <label className="form-label">Tags (optional)</label>
              <input
                className="form-input"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="Haircut, Styling, Beard — comma separated"
              />
            </div>
            <div>
              <label className="form-label">Service location</label>
              <input
                className="form-input"
                value={locationAddress}
                onChange={(e) => {
                  setLocationAddress(e.target.value);
                }}
                placeholder="Enter full address"
                required
              />
              <div style={{ fontSize: 12, color: "var(--gray-text)", marginTop: 8 }}>
                Coordinates are auto-fetched from this address during save.
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 28, flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-yellow" style={{ flex: 1, minWidth: 140 }} disabled={submitting || loadingCats}>
              {submitting ? "Creating (resolving location)…" : "Create service"}
            </button>
            <button type="button" className="btn btn-glass" onClick={() => navigate("/provider/dashboard")}>
              Back to dashboard
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
