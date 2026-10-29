import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWithAuth } from "../utils/api";

export default function ConfirmPage() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const [booking, setBooking] = useState(state?.booking || null);
  const [refreshError, setRefreshError] = useState("");
  const bookingId = state?.booking?.id;

  useEffect(() => {
    if (!bookingId) return;
    let active = true;
    async function refreshConfirmationData() {
      try {
        const { data: bookings } = await fetchWithAuth("/bookings/my");
        if (!active) return;
        const confirmedBooking = (Array.isArray(bookings) ? bookings : []).find((item) => item.id === bookingId);
        if (confirmedBooking) setBooking(confirmedBooking);
      } catch {
        if (active) setRefreshError("Booking was created, but its latest details could not be refreshed.");
      }
    }
    refreshConfirmationData();
    const refreshTimer = window.setInterval(refreshConfirmationData, 15000);
    return () => { active = false; window.clearInterval(refreshTimer); };
  }, [bookingId, state?.providerId, state?.selectedDate]);

  const status = booking?.status || "";
  const isPending = status === "PENDING";
  const startTime = booking?.start_time;
  const formattedDate = startTime
    ? new Date(startTime).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
    : "—";
  const formattedTime = state?.timeLabel || (startTime
    ? new Date(startTime).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : "—");

  return (
    <div className="page" style={{ background: "var(--black)", display: "flex", alignItems: "center", justifyContent: "center", padding: "80px 24px" }}>
      <style>{`@keyframes booking-check-pop{0%{transform:scale(.65);opacity:.35}70%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}} @media(prefers-reduced-motion:reduce){.booking-check{animation:none!important}}`}</style>
      <section className="glass-card" aria-labelledby="booking-confirmed-title" style={{ maxWidth: 520, width: "100%", padding: 36, textAlign: "center" }}>
        <div className="booking-check" aria-hidden="true" style={{ width: 72, height: 72, borderRadius: "50%", background: "var(--green-dim)", border: "2px solid var(--green)", display: "grid", placeItems: "center", fontSize: 34, color: "var(--green)", margin: "0 auto 22px", animation: "booking-check-pop .45s ease-out both" }}>✓</div>
        <h1 id="booking-confirmed-title" style={{ fontFamily: "'Playfair Display',serif", fontSize: 28, fontWeight: 800, margin: "0 0 8px" }}>
          {!booking ? "Confirmation Details Unavailable" : isPending ? "Booking Requested!" : "Booking Confirmed!"}
        </h1>
        <p style={{ color: "var(--gray-mid)", fontSize: 14, margin: "0 0 24px", lineHeight: 1.6 }}>
          {!booking ? "Check My Bookings for the latest booking status." : isPending ? "Your request was sent successfully and is awaiting provider confirmation." : "Your booking was confirmed successfully."}
        </p>
        {booking ? (
          <div style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 14, padding: 18, marginBottom: 22, textAlign: "left" }}>
            {[
              ["Service", booking.service_title || state?.serviceTitle || "Service"],
              ["Provider", booking.provider_name || "Provider"],
              ["Date", state?.selectedDate || formattedDate],
              ["Time", formattedTime],
              ["Booking reference", booking.id || "—"],
              ["Status", status.replace(/_/g, " ")],
            ].map(([label, value]) => (
              <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <span style={{ fontSize: 13, color: "var(--gray-text)" }}>{label}</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: label === "Status" ? "var(--green)" : "var(--white)", textAlign: "right", overflowWrap: "anywhere" }}>{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <p role="alert" style={{ color: "var(--gray-mid)", marginBottom: 22 }}>No booking confirmation was provided. Check My Bookings before trying again.</p>
        )}
        {refreshError && <p role="status" style={{ color: "var(--gray-text)", fontSize: 12, marginBottom: 16 }}>{refreshError}</p>}
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <button className="btn btn-yellow" onClick={() => navigate("/profile", { state: { refreshBookings: true } })}>View My Bookings</button>
          <button className="btn btn-glass" onClick={() => navigate("/")}>Back to Home</button>
        </div>
      </section>
    </div>
  );
}
