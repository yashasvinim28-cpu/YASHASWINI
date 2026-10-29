import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import StarRating from "../components/common/StarRating";
import ReviewCard from "../components/common/ReviewCard";
import { CATEGORIES } from "../data/appData";
import { useAppContext } from "../context/AppContext";
import { fetchWithAuth } from "../utils/api";
import { normalizeLocalDateKey, todayLocalDateKey } from "../utils/dateKeys";
import { buildForwardSlotStarts } from "../utils/slotWindows";

const AVAILABILITY_TIMEOUT_MS = 15000;

function formatTime(iso, timeZone) {
  return new Date(iso).toLocaleTimeString("en-US", { timeZone, hour: "numeric", minute: "2-digit" });
}

export default function DetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast, user } = useAppContext();
  const showToastRef = useRef(showToast);
  const availRequestIdRef = useRef(0);
  const availRequestControllerRef = useRef(null);
  const [service, setService] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [rawAvail, setRawAvail] = useState([]);
  const [loading, setLoading] = useState(true);
  const [availLoading, setAvailLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [selectedDate, setSelectedDate] = useState("");
  const [slotsRequestedDate, setSlotsRequestedDate] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [bookingLoading, setBookingLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");
  const [paymentPlan, setPaymentPlan] = useState("ADVANCE_50");

  useEffect(() => { showToastRef.current = showToast; }, [showToast]);

  useEffect(() => {
    let active = true;
    Promise.all([
      fetchWithAuth(`/services/${id}`),
      fetchWithAuth(`/reviews/service/${id}`).catch(() => ({ data: [] })),
    ]).then(([{ data: svcData }, { data: reviewData }]) => {
      if (!active) return;
      setService(svcData);
      setReviews(Array.isArray(reviewData) ? reviewData : []);
      const timeZone = svcData.provider_time_zone || "Asia/Kolkata";
      setSelectedDate(todayLocalDateKey(timeZone));
    }).catch(() => {
      if (active) { showToastRef.current("Service not found"); navigate("/"); }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id, navigate]);

  const providerTimeZone = service?.provider_time_zone || "Asia/Kolkata";
  const minDateAttr = todayLocalDateKey(providerTimeZone);

  const fetchAvailability = useCallback(async (controller = new AbortController()) => {
    if (!service?.provider_id || !selectedDate) return;
    const reqId = ++availRequestIdRef.current;
    setAvailLoading(true);
    setAvailabilityError("");
    try {
      const { data } = await fetchWithAuth(`/availabilities/${service.provider_id}?date=${encodeURIComponent(selectedDate)}`, { signal: controller.signal });
      if (reqId !== availRequestIdRef.current) return;
      setRawAvail(Array.isArray(data) ? data.map((slot) => ({
        ...slot,
        is_booked: slot.is_booked === true || slot.is_booked === "true" || slot.is_booked === 1,
      })) : []);
      setSlotsRequestedDate(selectedDate);
    } catch (error) {
      if (reqId !== availRequestIdRef.current) return;
      const message = controller.signal.aborted ? "Availability request timed out. Please try again." : (error.message || "Could not load availability");
      setAvailabilityError(controller.signal.aborted ? "Availability request timed out. Please try again." : message);
      showToastRef.current("Could not load availability");
      setSlotsRequestedDate(null);
    } finally {
      if (reqId === availRequestIdRef.current) setAvailLoading(false);
    }
  }, [service?.provider_id, selectedDate]);

  useEffect(() => {
    if (availRequestControllerRef.current) return undefined;
    if (slotsRequestedDate !== selectedDate) return undefined;
    const controller = new AbortController();
    availRequestControllerRef.current = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);
    fetchAvailability(controller).finally(() => {
      window.clearTimeout(timeoutId);
      if (availRequestControllerRef.current === controller) availRequestControllerRef.current = null;
    });
    return () => { window.clearTimeout(timeoutId); controller.abort(); };
  }, [service?.provider_id, selectedDate, slotsRequestedDate, fetchAvailability]);

  useEffect(() => () => {
    availRequestIdRef.current += 1;
    availRequestControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const refreshVisibleAvailability = () => {
      if (document.visibilityState === "visible" && selectedDate && slotsRequestedDate === selectedDate) {
        fetchAvailability(new AbortController());
      }
    };
    window.addEventListener("focus", refreshVisibleAvailability);
    return () => window.removeEventListener("focus", refreshVisibleAvailability);
  }, [fetchAvailability, selectedDate, slotsRequestedDate]);

  function changeDate(value) {
    availRequestIdRef.current += 1;
    availRequestControllerRef.current?.abort();
    availRequestControllerRef.current = null;
    setSelectedDate(value);
    setSlotsRequestedDate(null);
    setRawAvail([]);
    setSelectedSlot(null);
    setAvailabilityError("");
  }

  const durationMinutes = Number(service?.duration_minutes || 30);
  const isProvider = user?.role === "PROVIDER";
  const slotsForDay = useMemo(() => {
    if (slotsRequestedDate !== selectedDate) return [];
    const dayRows = rawAvail.filter((a) => normalizeLocalDateKey(a.start_time, providerTimeZone) === selectedDate);
    const sorted = [...dayRows].sort((a, b) => new Date(a.start_time) - new Date(b.start_time));
    return buildForwardSlotStarts(sorted, durationMinutes, Date.now(), providerTimeZone).map((slot) => ({
      ...slot,
      timeLabel: formatTime(slot.start_time, providerTimeZone),
    }));
  }, [rawAvail, selectedDate, slotsRequestedDate, durationMinutes, providerTimeZone]);

  useEffect(() => {
    setSelectedSlot((current) => {
      if (!current) return null;
      const refreshedSlot = slotsForDay.find((slot) => slot.availability_id === current.availability_id && slot.start_time === current.start_time);
      return refreshedSlot && !refreshedSlot.disabled ? refreshedSlot : null;
    });
  }, [selectedDate, durationMinutes, slotsForDay]);

  async function confirmBooking() {
    if (!selectedSlot || !service) return;
    const payAfterService = Number(service.price || 0) > 0 && paymentPlan === "PAY_LATER";
    if (Number(service.price || 0) > 0 && !payAfterService) {
      navigate("/payment", { state: { service, selectedSlot, selectedDate, paymentPlan } });
      return;
    }
    setBookingLoading(true);
    setBookingError("");
    try {
      const endpoint = payAfterService ? "/payments/pay-later-booking" : "/bookings";
      const { data } = await fetchWithAuth(endpoint, {
        method: "POST",
        body: JSON.stringify({ provider_id: service.provider_id, service_id: service.id, availability_id: selectedSlot.availability_id, start_time: selectedSlot.start_time }),
      });
      await fetchAvailability();
      showToast(payAfterService ? "Booking request sent. Pay after service." : "Booking requested");
      navigate("/confirm", { state: { booking: { id: data.booking_id, status: data.status || "PENDING", service_title: service.title, start_time: selectedSlot.start_time }, selectedDate, providerId: service.provider_id } });
    } catch (error) {
      const message = error.message || "Booking failed. Please choose another slot.";
      setBookingError(message);
      showToast(message);
      await fetchAvailability();
    } finally { setBookingLoading(false); }
  }

  if (loading) return <div className="page" style={{ color: "var(--white)", textAlign: "center", padding: 100 }}>Loading service...</div>;
  if (!service) return null;
  const category = CATEGORIES.find((item) => item.id === service.category_id) || CATEGORIES[0];
  const averageRating = reviews.length ? Number((reviews.reduce((sum, r) => sum + Number(r.rating || 0), 0) / reviews.length).toFixed(1)) : 0;

  return <div className="page" style={{ background: "var(--black)" }}>
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "clamp(20px,4vw,32px) clamp(16px,4vw,48px)", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 24, alignItems: "start" }}>
      <div>
        <nav style={{ display: "flex", gap: 8, marginBottom: 20 }}><button className="btn btn-glass" onClick={() => navigate("/")}>Home</button><button className="btn btn-glass" onClick={() => navigate(`/category/${category.id}`)}>{category.label}</button></nav>
        <section className="glass-card" style={{ padding: 24, marginBottom: 18 }}>
          <h1>{service.title}</h1><StarRating rating={averageRating} count={reviews.length} />
          <p>{service.duration_minutes} min · Rs {service.price}</p><p>{service.description || "No description provided."}</p>
          {service.tags?.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{service.tags.map((tag) => <span key={tag} className="chip">{tag}</span>)}</div>}
        </section>
        <section className="glass-card" style={{ padding: 24 }}><h2>Recent Reviews</h2><button className="btn btn-glass" onClick={() => navigate(`/reviews?serviceId=${service.id}`)}>View All</button>{!reviews.length ? <p>No reviews yet.</p> : reviews.slice(0, 2).map((review, index) => <ReviewCard key={review.id} i={index} compact r={{ avatar: (review.reviewer_name || "U")[0], name: review.reviewer_name || "User", rating: review.rating, date: new Date(review.created_at).toLocaleDateString(), text: review.comment || "" }} />)}</section>
      </div>
      <section className="glass-card" style={{ padding: 20 }}>
        <h2>Pick a date and time</h2><p>{durationMinutes} minute service · 10:00 AM to 6:00 PM ({providerTimeZone})</p>
        <label className="form-label" htmlFor="booking-date">Date</label>
        <input id="booking-date" type="date" className="form-input" min={minDateAttr} value={selectedDate} onChange={(event) => { const v = event.target.value; if (v) { setSelectedDate(v); changeDate(v); } }} />
        <button type="button" className="btn btn-glass" style={{ marginTop: 12 }} disabled={!selectedDate || availLoading} onClick={() => { if (slotsRequestedDate === selectedDate) fetchAvailability(new AbortController()); else setSlotsRequestedDate(selectedDate); }}>{slotsRequestedDate === selectedDate ? "Refresh Available Slots" : "Show Available Slots"}</button>
        {slotsRequestedDate !== selectedDate && <p>Select Show Available Slots to check this provider's current availability.</p>}
        {availLoading && rawAvail.length === 0 && <p role="status">Loading slots...</p>}
        {availLoading && rawAvail.length > 0 && <p role="status">Refreshing availability…</p>}
        {availabilityError && <p role="alert">{availabilityError}</p>}
        {slotsRequestedDate === selectedDate && !availLoading && !availabilityError && slotsForDay.length === 0 && <p>No valid slots remain for this date and service duration.</p>}
        {slotsRequestedDate === selectedDate && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(110px,1fr))", gap: 10, marginTop: 14 }}>
          {slotsForDay.map((slot) => <button key={slot.availability_id} type="button" aria-label={`${slot.timeLabel} ${slot.disabled ? slot.reason : "Available"}`} aria-pressed={selectedSlot?.availability_id === slot.availability_id} className={`slot-btn${selectedSlot?.availability_id === slot.availability_id ? " slot-btn-selected" : ""}${slot.disabled ? " slot-btn-disabled" : ""}`} disabled={slot.disabled || availLoading} onClick={() => setSelectedSlot(slot)}>{slot.timeLabel}<small style={{ display: "block" }}>{slot.disabled ? slot.reason : "Available"}</small></button>)}
        </div>}
        {Number(service.price || 0) > 0 && selectedSlot && <div style={{ display: "grid", gap: 8, margin: "16px 0" }}>{[["ADVANCE_50", "Pay 50% in advance"], ["FULL", "Pay full amount"], ["PAY_LATER", "Pay after service"]].map(([value, label]) => <button key={value} className="btn btn-glass" aria-pressed={paymentPlan === value} onClick={() => setPaymentPlan(value)}>{label}</button>)}</div>}
        {bookingError && <p role="alert">{bookingError}</p>}
        <button type="button" className="btn btn-yellow" style={{ width: "100%", marginTop: 16 }} disabled={isProvider || !selectedSlot || selectedSlot.disabled || bookingLoading || (availLoading && rawAvail.length === 0)} onClick={confirmBooking}>{bookingLoading ? "Booking…" : isProvider ? "Providers cannot book" : selectedSlot ? "Continue" : "Select a time"}</button>
      </section>
    </main>
  </div>;
}
