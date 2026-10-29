import { useState } from "react";
import { fetchWithAuth } from "../../utils/api";
import { normalizeLocalDateKey, todayLocalDateKey } from "../../utils/dateKeys";
import { buildForwardSlotStarts } from "../../utils/slotWindows";

export default function BookingReschedulePicker({ booking, onSubmit, onCancel, submitLabel = "Send request" }) {
  const [date, setDate] = useState(todayLocalDateKey("Asia/Kolkata"));
  const [timeZone, setTimeZone] = useState("Asia/Kolkata");
  const [slots, setSlots] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function showSlots() {
    setLoading(true);
    setError("");
    setSlots([]);
    setSelected(null);
    try {
      const { data } = await fetchWithAuth(`/availabilities/${booking.provider_id}?date=${encodeURIComponent(date)}`);
      const rows = Array.isArray(data) ? data : [];
      const zone = rows[0]?.time_zone || "Asia/Kolkata";
      setTimeZone(zone);
      const duration = Number(booking.duration_minutes || 15);
      const currentStart = new Date(booking.start_time).getTime();
      const currentEnd = currentStart + duration * 60_000;
      const choices = buildForwardSlotStarts(rows
        .filter((slot) => normalizeLocalDateKey(slot.start_time, zone) === date)
        .sort((a, b) => new Date(a.start_time) - new Date(b.start_time)), duration, Date.now(), zone)
        .filter((slot) => !slot.disabled)
        .filter((slot) => {
          const start = new Date(slot.start_time).getTime();
          const end = start + duration * 60_000;
          return start >= currentEnd || end <= currentStart;
        });
      setSlots(choices);
      if (!choices.length) setError("No available slots for this date. Choose another date.");
    } catch (cause) {
      setError(cause.message || "Could not load available slots");
    } finally { setLoading(false); }
  }

  function changeDate(value) {
    setDate(value);
    setSlots([]);
    setSelected(null);
    setError("");
  }

  return <div className="glass-card" style={{ padding: 14, marginTop: 12 }}>
    <label className="form-label" htmlFor={`reschedule-date-${booking.id}`}>Choose a new date</label>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
      <input id={`reschedule-date-${booking.id}`} type="date" className="form-input" min={todayLocalDateKey(timeZone)} value={date} onChange={(event) => changeDate(event.target.value)} style={{ maxWidth: 220 }} />
      <button type="button" className="btn btn-yellow" disabled={!date || loading} onClick={showSlots}>{loading ? "Loading slots…" : "Show Available Slots"}</button>
    </div>
    {error && <p role="status" style={{ margin: "10px 0 0" }}>{error}</p>}
    {!!slots.length && <>
      <p style={{ margin: "12px 0 8px" }}>Available times ({timeZone})</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {slots.map((slot) => {
          const label = new Date(slot.start_time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone });
          return <button key={slot.availability_id} type="button" aria-pressed={selected?.availability_id === slot.availability_id}
            className="btn btn-yellow"
            style={selected?.availability_id === slot.availability_id ? undefined : { opacity: 0.78 }}
            onClick={() => setSelected(slot)}>{label}</button>;
        })}
      </div>
    </>}
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button type="button" className="btn btn-yellow" disabled={!selected || loading} onClick={() => onSubmit(selected)}>{submitLabel}</button>
      <button type="button" className="btn btn-yellow" onClick={onCancel}>Close</button>
    </div>
  </div>;
}
