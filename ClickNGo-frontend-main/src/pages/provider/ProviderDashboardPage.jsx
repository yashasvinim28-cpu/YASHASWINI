import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../../context/AppContext";
import { fetchWithAuth } from "../../utils/api";
import BookingReschedulePicker from "../../components/bookings/BookingReschedulePicker";

export default function ProviderDashboardPage() {
  const navigate = useNavigate();
  const { showToast, user } = useAppContext();
  const showToastRef = useRef(showToast);
  showToastRef.current = showToast;
  const [services, setServices] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [requestLoading, setRequestLoading] = useState(null);
  const [reschedulePickerId, setReschedulePickerId] = useState(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    const results = await Promise.allSettled([fetchWithAuth("/services/my"), fetchWithAuth("/bookings/my")]);
    if (results[0].status === "fulfilled") setServices(Array.isArray(results[0].value.data) ? results[0].value.data : []);
    else showToastRef.current(results[0].reason?.message || "Could not load services");
    if (results[1].status === "fulfilled") setBookings(Array.isArray(results[1].value.data) ? results[1].value.data : []);
    else showToastRef.current(results[1].reason?.message || "Could not load booking requests");
    setLoading(false);
  }, []);
  useEffect(() => {
    loadDashboard();
    const refreshTimer = window.setInterval(loadDashboard, 15000);
    return () => window.clearInterval(refreshTimer);
  }, [loadDashboard]);

  const cancellationRequests = useMemo(() => bookings.flatMap((booking) => (booking.cancellation_requests || []).filter((request) => request.status === "PENDING").map((request) => ({ booking, request }))), [bookings]);
  const rescheduleRequests = useMemo(() => bookings.flatMap((booking) => (booking.reschedule_requests || []).filter((request) => request.status === "PENDING" && request.requested_by_role !== "PROVIDER").map((request) => ({ booking, request }))), [bookings]);
  const extensionRequests = useMemo(() => bookings.flatMap((booking) => (booking.extensions || []).filter((request) => request.status === "PENDING").map((request) => ({ booking, request }))), [bookings]);
  const bookingRequests = useMemo(() => bookings.filter((booking) => booking.status === "PENDING"), [bookings]);

  async function decide(kind, booking, request, action) {
    if (kind === "CANCELLATION" && !window.confirm(`${action === "approve" ? "Approve" : "Reject"} this cancellation request?`)) return;
    const requestId = request?.id || booking.id;
    setRequestLoading(requestId);
    try {
      if (kind === "BOOKING") await fetchWithAuth(`/bookings/${booking.id}/booking-request/${action}`, { method: "POST" });
      else if (kind === "CANCELLATION") await fetchWithAuth(`/bookings/cancellations/${requestId}/${action}`, { method: "POST" });
      else if (kind === "RESCHEDULE") await fetchWithAuth(`/bookings/${booking.id}/reschedule/${action}`, { method: "POST" });
      else await fetchWithAuth(`/bookings/extensions/${requestId}/${action}`, { method: "POST" });
      showToast(`${kind === "BOOKING" ? "Booking" : `${kind[0]}${kind.slice(1).toLowerCase()} request`} ${action === "approve" ? "approved" : "rejected"}`);
      await loadDashboard();
    } catch (error) { showToast(error.message || `Could not ${action} request`); }
    finally { setRequestLoading(null); }
  }

  async function proposeReschedule(booking, slot) {
    try {
      await fetchWithAuth(`/bookings/${booking.id}/reschedule`, {
        method: "POST", body: JSON.stringify({ target_availability_id: slot.availability_id }),
      });
      showToast("Reschedule proposal sent to the customer");
      setReschedulePickerId(null);
      await loadDashboard();
    } catch (error) { showToast(error.message || "Could not send reschedule proposal"); }
  }

  async function cancelProviderBooking(booking) {
    if (!window.confirm("Cancel this booking and notify the customer?")) return;
    setRequestLoading(booking.id);
    try {
      await fetchWithAuth(`/bookings/${booking.id}/provider-cancel`, { method: "POST" });
      showToast("Booking cancelled; the customer has been notified");
      await loadDashboard();
    } catch (error) { showToast(error.message || "Could not cancel booking"); }
    finally { setRequestLoading(null); }
  }

  function requestCard(kind, item) {
    const { booking, request } = item;
    const requestAt = request.created_at;
    const requestedStart = request.target_availability_id ? booking.target_start_time : null;
    return <article key={request.id} style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.05)" }}>
      <strong>{booking.customer_name || "Customer"} · {booking.service_title || "Service"}</strong>
      <div style={{ fontSize: 13, color: "var(--gray-mid)", marginTop: 5 }}>Booking: {new Date(booking.start_time).toLocaleString()}{requestedStart ? ` · Requested: ${new Date(requestedStart).toLocaleString()}` : ""}</div>
      <div style={{ fontSize: 12, color: "var(--gray-text)" }}>{kind.toLowerCase()} request · {requestAt ? new Date(requestAt).toLocaleString() : ""}{request.additional_minutes ? ` · +${request.additional_minutes} min` : ""}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button className="btn btn-yellow" disabled={requestLoading === request.id} onClick={() => decide(kind, booking, request, "approve")}>Approve</button><button className="btn btn-yellow" disabled={requestLoading === request.id} onClick={() => decide(kind, booking, request, "reject")}>Reject</button></div>
    </article>;
  }

  return <div className="page" style={{ background: "var(--black)" }}><main style={{ maxWidth: 980, margin: "0 auto", padding: "clamp(24px,4vw,40px) clamp(16px,4vw,48px)" }}>
    <header style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 24, alignItems: "center" }}><h1 style={{ fontFamily: "'Playfair Display',serif", fontSize: 32, flex: 1 }}>Provider Dashboard</h1><button type="button" className="btn btn-yellow" onClick={() => navigate("/provider/availability")}>Manage availability</button><button type="button" className="btn btn-yellow" onClick={() => navigate("/provider/service/create")}>+ Add service</button></header>
    {loading ? <p role="status">Loading dashboard…</p> : <>
      <section className="glass-card" style={{ padding: 24, marginBottom: 18 }}><h2>Booking Requests</h2>
        <h3>New Booking Requests</h3>{bookingRequests.length ? <div style={{ display: "grid", gap: 10 }}>{bookingRequests.map((booking) => <article key={booking.id} style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.05)" }}>
          <strong>{booking.customer_name || "Customer"} · {booking.service_title || "Service"}</strong>
          <div style={{ fontSize: 13, color: "var(--gray-mid)", marginTop: 5 }}>Requested for: {booking.start_time ? new Date(booking.start_time).toLocaleString() : "Time unavailable"}</div>
          <div style={{ fontSize: 12, color: "var(--gray-text)" }}>Awaiting your confirmation{booking.payment_method === "PAY_AFTER_SERVICE" ? " · Payment after service" : ""}</div>
          <div style={{ display: "flex", gap: 8, marginTop: 10 }}><button className="btn btn-yellow" disabled={requestLoading === booking.id} onClick={() => decide("BOOKING", booking, null, "approve")}>Approve</button><button className="btn btn-yellow" disabled={requestLoading === booking.id} onClick={() => decide("BOOKING", booking, null, "reject")}>Reject</button></div>
        </article>)}</div> : <p>No pending booking requests.</p>}
        <h3>Cancellation Requests</h3>{cancellationRequests.length ? <div style={{ display: "grid", gap: 10 }}>{cancellationRequests.map((item) => requestCard("CANCELLATION", item))}</div> : <p>No pending cancellation requests.</p>}
        <h3>Reschedule Requests</h3>{rescheduleRequests.length ? <div style={{ display: "grid", gap: 10 }}>{rescheduleRequests.map((item) => requestCard("RESCHEDULE", item))}</div> : <p>No pending reschedule requests.</p>}
        <h3>Extension Requests</h3>{extensionRequests.length ? <div style={{ display: "grid", gap: 10 }}>{extensionRequests.map((item) => requestCard("EXTENSION", item))}</div> : <p>No pending extension requests.</p>}
      </section>
      <section className="glass-card" style={{ padding: 24, marginBottom: 18 }}><h2>My Bookings</h2>
        {bookings.filter((booking) => ["PENDING", "CONFIRMED", "RESCHEDULED", "RESCHEDULE_REQUESTED"].includes(booking.status)).length ? <div style={{ display: "grid", gap: 12 }}>
          {bookings.filter((booking) => ["PENDING", "CONFIRMED", "RESCHEDULED", "RESCHEDULE_REQUESTED"].includes(booking.status)).map((booking) => {
            const pendingRequest = booking.status === "RESCHEDULE_REQUESTED" || (booking.reschedule_requests || []).some((request) => request.status === "PENDING");
            return <article key={booking.id} style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.05)" }}>
              <strong>{booking.customer_name || "Customer"} · {booking.service_title || "Service"}</strong>
              <div style={{ fontSize: 13, color: "var(--gray-mid)", marginTop: 5 }}>{new Date(booking.start_time).toLocaleString()} · Status: {booking.status}</div>
              {booking.status === "RESCHEDULE_REQUESTED" && booking.target_start_time && <div style={{ fontSize: 13 }}>Requested time: {new Date(booking.target_start_time).toLocaleString()}</div>}
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                {!pendingRequest && <button className="btn btn-yellow" disabled={requestLoading === booking.id} onClick={() => setReschedulePickerId(reschedulePickerId === booking.id ? null : booking.id)}>Request reschedule</button>}
                <button className="btn btn-yellow" disabled={requestLoading === booking.id} onClick={() => cancelProviderBooking(booking)}>Cancel booking</button>
              </div>
              {reschedulePickerId === booking.id && <BookingReschedulePicker booking={booking} onSubmit={(slot) => proposeReschedule(booking, slot)} onCancel={() => setReschedulePickerId(null)} submitLabel="Send proposal" />}
            </article>;
          })}
        </div> : <p>No active bookings.</p>}
      </section>
      <section className="glass-card" style={{ padding: 24 }}><h2>My Services</h2>{services.length ? <div style={{ display: "grid", gap: 12 }}>{services.map((service) => <article key={service.id} style={{ padding: 14, borderRadius: 12, background: "rgba(255,255,255,0.06)" }}><strong>{service.title}</strong> · Rs {Number(service.price || 0).toFixed(2)}<div>Status: {service.approval_status || "UNKNOWN"}</div><button className="btn btn-glass" onClick={() => navigate(`/provider/services/${service.id}`)}>Manage service</button></article>)}</div> : <p>No services listed yet.</p>}</section>
    </>}
  </main></div>;
}
