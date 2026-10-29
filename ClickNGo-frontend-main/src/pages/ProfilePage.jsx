import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppContext } from "../context/AppContext";
import { fetchWithAuth } from "../utils/api";
import BookingReschedulePicker from "../components/bookings/BookingReschedulePicker";

const ACTIVE = new Set(["PENDING", "CONFIRMED", "RESCHEDULED", "RESCHEDULE_REQUESTED"]);

export default function ProfilePage() {
  const { user, setUser, logoutFn, showToast, loadCurrentUser } = useAppContext();
  const navigate = useNavigate();
  const [bookings, setBookings] = useState([]);
  const [bookingTab, setBookingTab] = useState("UPCOMING");
  const [bookingLoadError, setBookingLoadError] = useState("");
  const [actionLoading, setActionLoading] = useState(null);
  const [reschedulePickerId, setReschedulePickerId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone: "" });

  const loadAll = useCallback(async () => {
    if (!user?.id) return;
    setBookingLoadError("");
    const [bookingsResult] = await Promise.allSettled([fetchWithAuth("/bookings/my")]);
    if (bookingsResult.status === "fulfilled") setBookings(Array.isArray(bookingsResult.value.data) ? bookingsResult.value.data : []);
    else setBookingLoadError(bookingsResult.reason?.message || "Could not load bookings");
  }, [user?.id]);

  useEffect(() => { setEditForm({ name: user?.name || "", phone: user?.phone || "" }); }, [user]);
  useEffect(() => {
    loadAll();
    const refreshTimer = window.setInterval(loadAll, 15000);
    return () => window.clearInterval(refreshTimer);
  }, [loadAll]);

  async function saveProfile() {
    setSaving(true);
    try {
      const { data } = await fetchWithAuth("/auth/me", { method: "PATCH", body: JSON.stringify({ name: editForm.name.trim(), phone: editForm.phone.trim() }) });
      setUser(data.user); await loadCurrentUser(); setEditing(false); showToast("Profile updated");
    } catch (error) { showToast(error.message || "Could not update profile"); }
    finally { setSaving(false); }
  }

  async function submitReschedule(booking, slot) {
    try {
      await fetchWithAuth(`/bookings/${booking.id}/reschedule`, { method: "POST", body: JSON.stringify({ target_availability_id: slot.availability_id }) });
      showToast(user?.role === "PROVIDER" ? "Reschedule proposal sent to the customer" : "Reschedule request sent to the provider");
      setReschedulePickerId(null);
      await loadAll();
    } catch (error) { showToast(error.message || "Could not request reschedule"); await loadAll(); }
  }

  async function respondToProviderReschedule(booking, action) {
    if (action === "reject" && !window.confirm("Decline the provider's new time proposal?")) return;
    try {
      await fetchWithAuth(`/bookings/${booking.id}/provider-reschedule/${action}`, { method: "POST" });
      showToast(action === "approve" ? "New time accepted" : "New time declined");
      await loadAll();
    } catch (error) { showToast(error.message || "Could not respond to the provider proposal"); await loadAll(); }
  }

  async function withdrawReschedule(booking) {
    if (!window.confirm("Withdraw your reschedule request? You can then reschedule or extend this booking again.")) return;
    try {
      await fetchWithAuth(`/bookings/${booking.id}/reschedule/withdraw`, { method: "POST" });
      showToast("Reschedule request withdrawn");
      await loadAll();
    } catch (error) { showToast(error.message || "Could not withdraw reschedule request"); await loadAll(); }
  }

  async function providerDecision(kind, booking, request, action) {
    const key = request?.id || booking.id;
    setActionLoading(key);
    try {
      if (kind === "BOOKING") await fetchWithAuth(`/bookings/${booking.id}/booking-request/${action}`, { method: "POST" });
      else if (kind === "RESCHEDULE") await fetchWithAuth(`/bookings/${booking.id}/reschedule/${action}`, { method: "POST" });
      else if (kind === "CANCELLATION") await fetchWithAuth(`/bookings/cancellations/${request.id}/${action}`, { method: "POST" });
      else await fetchWithAuth(`/bookings/extensions/${request.id}/${action}`, { method: "POST" });
      showToast(`${kind === "BOOKING" ? "Booking" : kind[0] + kind.slice(1).toLowerCase()} ${action === "approve" ? "approved" : "rejected"}`);
      await loadAll();
    } catch (error) { showToast(error.message || `Could not ${action} request`); await loadAll(); }
    finally { setActionLoading(null); }
  }

  async function providerCancelBooking(booking) {
    if (!window.confirm("Cancel this booking and notify the customer?")) return;
    setActionLoading(booking.id);
    try {
      await fetchWithAuth(`/bookings/${booking.id}/provider-cancel`, { method: "POST" });
      showToast("Booking cancelled; the customer has been notified");
      await loadAll();
    } catch (error) { showToast(error.message || "Could not cancel booking"); await loadAll(); }
    finally { setActionLoading(null); }
  }

  async function cancelBooking(b) {
    const bookingId = b.id;
    if (!window.confirm("Send a cancellation request to the provider? Any pending reschedule or extension request will be withdrawn.")) return;
    try {
      await fetchWithAuth(`/bookings/${bookingId}/cancel`, { method: "POST" });
      showToast("Cancellation request sent to the provider"); await loadAll();
    } catch (error) { showToast(error.message || "Could not request cancellation"); await loadAll(); }
  }

  async function extendBooking(b) {
    const additional_minutes = Number(window.prompt("Extension length in minutes (15, 30, or 60)", "15"));
    if (!additional_minutes) return;
    try {
      await fetchWithAuth(`/bookings/${b.id}/extensions`, { method: "POST", body: JSON.stringify({ additional_minutes }) });
      showToast("Extension request sent to the provider"); await loadAll();
    } catch (error) { showToast(error.message || "Could not request extension"); }
  }

  const visibleBookings = bookings.filter((b) => bookingTab === "UPCOMING" ? ACTIVE.has(b.status) : bookingTab === "COMPLETED" ? b.status === "COMPLETED" : bookingTab === "CANCELLED" ? b.status === "CANCELLED" : false);
  const setField = (field) => (event) => setEditForm((form) => ({ ...form, [field]: event.target.value }));

  return <div className="page" style={{ background: "var(--black)" }}><main style={{ maxWidth: 900, margin: "0 auto", padding: "32px 16px" }}>
    <section className="glass-card" style={{ padding: 24, display: "flex", gap: 16, alignItems: "center" }}><div style={{ flex: 1 }}><h1>{user?.name || "Guest"}</h1><div>{user?.email} · {user?.phone || "No phone"}</div></div><button className="btn btn-glass" onClick={() => setEditing(!editing)}>Edit Profile</button><button className="btn btn-glass" onClick={() => { logoutFn(); navigate("/login"); }}>Logout</button></section>
    {editing && <section className="glass-card" style={{ padding: 20, marginTop: 16 }}><input className="form-input" value={editForm.name} onChange={setField("name")} aria-label="Full name"/><input className="form-input" value={editForm.phone} onChange={setField("phone")} aria-label="Phone number"/><button className="btn btn-yellow" disabled={saving} onClick={saveProfile}>{saving ? "Saving…" : "Save profile"}</button></section>}
    <section className="glass-card" style={{ padding: 20, marginTop: 18 }}><h2>My Bookings</h2><div role="tablist" style={{ display: "flex", gap: 8 }}>{["UPCOMING", "COMPLETED", "CANCELLED"].map((tab) => <button role="tab" aria-selected={bookingTab === tab} key={tab} className="btn btn-yellow" style={bookingTab === tab ? undefined : { opacity: 0.78 }} onClick={() => setBookingTab(tab)}>{tab}</button>)}</div>
      {bookingLoadError && <p role="alert" className="error-text">{bookingLoadError}</p>}
      {!visibleBookings.length ? <p>No bookings in this section.</p> : visibleBookings.map((b) => <article key={b.id} style={{ borderTop: "1px solid #444", padding: 14, marginTop: 12 }}><strong>{b.service_title}</strong><div>{b.provider_name} · {new Date(b.start_time).toLocaleString()}</div><div>Status: {b.status} · Booking reference: {b.id}</div>
        {b.payment_status && <div>Payment: {b.payment_status}</div>}
        {b.status === "CANCELLED" && b.cancellation_reason === "CANCELLED_BY_PROVIDER" && <div>The provider cancelled this booking.</div>}
        {(b.cancellation_requests || []).map((request) => <div key={request.id}>Cancellation request {request.status.toLowerCase()}{request.status === "PENDING" && (user?.role === "PROVIDER" ? <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-yellow" disabled={actionLoading === request.id} onClick={() => providerDecision("CANCELLATION", b, request, "approve")}>Approve cancellation</button>
          <button className="btn btn-yellow" disabled={actionLoading === request.id} onClick={() => providerDecision("CANCELLATION", b, request, "reject")}>Reject cancellation</button>
        </div> : <div>Cancellation request sent to the provider</div>)}</div>)}
        {(b.reschedule_requests || []).map((request) => <div key={request.id}>
          {request.requested_by_role === "PROVIDER" ? "Provider proposed a new time" : "Reschedule request"} {request.status.toLowerCase()}
          {request.status === "PENDING" && b.target_start_time && <div>Proposed time: {new Date(b.target_start_time).toLocaleString()}</div>}
          {request.status === "PENDING" && request.requested_by_role === "PROVIDER" && user?.role === "CUSTOMER" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-yellow" onClick={() => respondToProviderReschedule(b, "approve")}>Accept new time</button>
            <button className="btn btn-yellow" onClick={() => respondToProviderReschedule(b, "reject")}>Decline</button>
          </div>}
          {request.status === "PENDING" && request.requested_by_role !== "PROVIDER" && <div style={{ marginTop: 8 }}>
            {user?.role === "PROVIDER" ? <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-yellow" disabled={actionLoading === b.id} onClick={() => providerDecision("RESCHEDULE", b, request, "approve")}>Approve reschedule</button>
              <button className="btn btn-yellow" disabled={actionLoading === b.id} onClick={() => providerDecision("RESCHEDULE", b, request, "reject")}>Reject reschedule</button>
            </div> : <button className="btn btn-yellow" onClick={() => withdrawReschedule(b)}>Withdraw request</button>}
          </div>}
        </div>)}
        {(b.extensions || []).map((request) => <div key={request.id}>Extension request {request.status.toLowerCase()}{request.status === "PENDING" && user?.role === "PROVIDER" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-yellow" disabled={actionLoading === request.id} onClick={() => providerDecision("EXTENSION", b, request, "approve")}>Approve extension</button>
          <button className="btn btn-yellow" disabled={actionLoading === request.id} onClick={() => providerDecision("EXTENSION", b, request, "reject")}>Reject extension</button>
        </div>}</div>)}
        {Number(b.extension_amount_due || 0) > 0 && <div>Extension payment: {b.extension_payment_status || "PENDING"} · Rs {Number(b.extension_amount_due).toFixed(2)} due</div>}
        {user?.role === "PROVIDER" && b.status === "PENDING" && <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-yellow" disabled={actionLoading === b.id} onClick={() => providerDecision("BOOKING", b, null, "approve")}>Approve booking</button>
          <button className="btn btn-yellow" disabled={actionLoading === b.id} onClick={() => providerDecision("BOOKING", b, null, "reject")}>Reject booking</button>
        </div>}
        {user?.role === "PROVIDER" && ["CONFIRMED", "RESCHEDULED", "RESCHEDULE_REQUESTED"].includes(b.status) && <div style={{ marginTop: 8 }}>
          {!((b.reschedule_requests || []).some((request) => request.status === "PENDING")) && <button className="btn btn-yellow" onClick={() => setReschedulePickerId(reschedulePickerId === b.id ? null : b.id)}>Request reschedule</button>}
          <button className="btn btn-yellow" disabled={actionLoading === b.id} onClick={() => providerCancelBooking(b)}>Cancel booking</button>
        </div>}
        {reschedulePickerId === b.id && <BookingReschedulePicker booking={b} onSubmit={(slot) => submitReschedule(b, slot)} onCancel={() => setReschedulePickerId(null)} submitLabel={user?.role === "PROVIDER" ? "Send proposal" : "Send request"} />}
        {user?.role === "CUSTOMER" && ACTIVE.has(b.status) && (() => {
          const pendingCancellation = (b.cancellation_requests || []).some((request) => request.status === "PENDING");
          const pendingReschedule = b.status === "RESCHEDULE_REQUESTED" || (b.reschedule_requests || []).some((request) => request.status === "PENDING");
          const pendingExtension = (b.extensions || []).some((request) => request.status === "PENDING");
          const started = new Date(b.start_time).getTime() <= Date.now();
          return <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn btn-yellow" disabled={started || pendingReschedule || pendingCancellation || pendingExtension} title={pendingReschedule ? "Waiting for the provider to respond to the pending reschedule" : pendingCancellation ? "Waiting for the provider to respond to the cancellation" : pendingExtension ? "An extension request is already pending" : ""} onClick={() => setReschedulePickerId(reschedulePickerId === b.id ? null : b.id)}>Reschedule</button>
            <button className="btn btn-yellow" disabled={started || pendingCancellation} title={started ? "A started booking cannot be cancelled" : pendingCancellation ? "Waiting for the provider to respond to the cancellation" : ""} onClick={() => cancelBooking(b)}>Cancel Booking</button>
            <button className="btn btn-yellow" disabled={started || pendingCancellation || pendingReschedule || pendingExtension} title={pendingReschedule ? "Resolve the pending reschedule first" : pendingCancellation ? "Waiting for the provider to respond to the cancellation" : pendingExtension ? "An extension request is already pending" : ""} onClick={() => extendBooking(b)}>Extend Session</button>
          </div>;
        })()}</article>)}
    </section>
  </main></div>;
}
