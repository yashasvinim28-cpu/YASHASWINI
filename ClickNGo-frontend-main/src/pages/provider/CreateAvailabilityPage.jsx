import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";
import { fetchWithAuth } from "../../utils/api";

export default function CreateAvailabilityPage() {
  const navigate = useNavigate();
  const { showToast } = useAppContext();
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!startTime || !endTime) {
      showToast("Please select start and end time");
      return;
    }
    const sd = new Date(startTime).toISOString();
    const ed = new Date(endTime).toISOString();
    if (new Date(sd) >= new Date(ed)) {
      showToast("End time must be after start time");
      return;
    }
    setSubmitting(true);
    try {
      await fetchWithAuth(`/availabilities`, {
        method: "POST",
        body: JSON.stringify({ start_time: sd, end_time: ed }),
      });
      showToast("Availability created successfully!");
      setStartTime("");
      setEndTime("");
    } catch (err) {
      showToast(err.message || "Failed to create availability");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 560, margin: "0 auto", padding: "clamp(24px,4vw,40px) clamp(16px,4vw,48px)" }}>
        <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
          Add availability
        </div>
        <p style={{ color: "var(--gray-mid)", fontSize: 14, marginBottom: 28 }}>
          Create recurring 15-minute slots for the next two months from your time range.
        </p>

        <form className="glass-card" style={{ padding: 28 }} onSubmit={handleSubmit}>
          <div style={{ display: "grid", gap: 18 }}>
            <div>
              <label className="form-label">Start time</label>
              <input
                required
                type="datetime-local"
                className="form-input"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
            </div>
            <div>
              <label className="form-label">End time</label>
              <input
                required
                type="datetime-local"
                className="form-input"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
            </div>
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 24, flexWrap: "wrap" }}>
            <button type="submit" className="btn btn-yellow" style={{ flex: 1, minWidth: 140 }} disabled={submitting}>
              {submitting ? "Saving…" : "Create slots"}
            </button>
            <button type="button" className="btn btn-glass" onClick={() => navigate("/provider/dashboard")}>
              Back to dashboard
            </button>
          </div>
          <p style={{ fontSize: 12, color: "var(--gray-text)", marginTop: 16 }}>
            You can submit again to add another range.
          </p>
        </form>
      </div>
    </div>
  );
}
