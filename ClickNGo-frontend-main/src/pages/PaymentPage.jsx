import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { fetchWithAuth } from "../utils/api";
import { useAppContext } from "../context/AppContext";

function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);

  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve(true);
    script.onerror = () => resolve(false);
    document.body.appendChild(script);
  });
}

function formatCurrency(value) {
  return `Rs ${Number(value || 0).toFixed(2)}`;
}

export default function PaymentPage() {
  const navigate = useNavigate();
  const routeLocation = useLocation();
  const { showToast, user } = useAppContext();
  const [paymentPlan, setPaymentPlan] = useState(routeLocation.state?.paymentPlan || "ADVANCE_50");
  const [loading, setLoading] = useState(false);
  const [bookingError, setBookingError] = useState("");

  const bookingData = routeLocation.state || null;
  const service = bookingData?.service || null;
  const selectedSlot = bookingData?.selectedSlot || null;
  const selectedDate = bookingData?.selectedDate || "";

  const pricing = useMemo(() => {
    const total = Number(service?.price || 0);
    return {
      total,
      advance: total * 0.5,
    };
  }, [service?.price]);

  if (!service || !selectedSlot) {
    return (
      <div className="page" style={{ background: "var(--black)", padding: 80, textAlign: "center" }}>
        <div className="glass-card" style={{ maxWidth: 520, margin: "0 auto", padding: 28 }}>
          <div style={{ fontWeight: 700, marginBottom: 10 }}>No booking selected</div>
          <div style={{ color: "var(--gray-text)", marginBottom: 18 }}>
            Please choose a service slot first before opening the payment page.
          </div>
          <button className="btn btn-yellow" onClick={() => navigate("/")}>Go back</button>
        </div>
      </div>
    );
  }

  async function handlePayLaterBooking() {
    setLoading(true);
    setBookingError("");
    try {
      const { data } = await fetchWithAuth("/payments/pay-later-booking", {
        method: "POST",
        body: JSON.stringify({
          provider_id: service.provider_id,
          service_id: service.id,
          availability_id: selectedSlot.availability_id,
          start_time: selectedSlot.start_time,
        }),
      });
      showToast("Booking request sent. Pay after service.");
      navigate("/confirm", {
        state: {
          booking: {
            id: data.booking_id,
            status: data.status || "PENDING",
            service_title: data.service_title || service.title,
            start_time: selectedSlot.start_time,
          },
          selectedDate,
          timeLabel: selectedSlot.timeLabel,
          providerId: service.provider_id,
        },
      });
    } catch (error) {
      const message = error.message || "Could not create booking";
      setBookingError(message);
      showToast(message);
    } finally {
      setLoading(false);
    }
  }

  async function handleOnlinePayment() {
    setLoading(true);
    try {
      const sdkLoaded = await loadRazorpayCheckout();
      if (!sdkLoaded) {
        throw new Error("Could not load Razorpay checkout");
      }

      const { data } = await fetchWithAuth("/payments/order", {
        method: "POST",
        body: JSON.stringify({
          provider_id: service.provider_id,
          service_id: service.id,
          availability_id: selectedSlot.availability_id,
          start_time: selectedSlot.start_time,
          payment_plan: paymentPlan,
        }),
      });

      await new Promise((resolve, reject) => {
        const razorpay = new window.Razorpay({
          key: data.key,
          amount: data.order.amount,
          currency: data.order.currency || "INR",
          name: "ClickNGo",
          description: paymentPlan === "FULL" ? `Full payment for ${service.title}` : `50% advance payment for ${service.title}`,
          order_id: data.order.id,
          handler: async (response) => {
            try {
              const { data: bookingData } = await fetchWithAuth("/payments/verify-booking", {
                method: "POST",
                body: JSON.stringify({
                  provider_id: service.provider_id,
                  service_id: service.id,
                  availability_id: selectedSlot.availability_id,
                  start_time: selectedSlot.start_time,
                  payment_plan: paymentPlan,
                  razorpay_order_id: response.razorpay_order_id,
                  razorpay_payment_id: response.razorpay_payment_id,
                  razorpay_signature: response.razorpay_signature,
                }),
              });
              showToast("Payment successful and booking confirmed");
              navigate("/confirm", {
                state: {
                  booking: {
                    id: bookingData.booking_id,
                    status: "CONFIRMED",
                    service_title: bookingData.service_title || service.title,
                    start_time: selectedSlot.start_time,
                  },
                  selectedDate,
                  timeLabel: selectedSlot.timeLabel,
                  providerId: service.provider_id,
                },
              });
              resolve();
            } catch (error) {
              reject(error);
            }
          },
          modal: {
            ondismiss: () => reject(new Error("Payment was cancelled")),
          },
          prefill: {
            name: user?.name || "",
            email: user?.email || "",
            contact: user?.phone || "",
          },
          notes: {
            service_id: service.id,
            availability_id: selectedSlot.availability_id,
            payment_plan: paymentPlan,
          },
          theme: {
            color: "#FFE033",
          },
        });

        razorpay.open();
      });
    } catch (error) {
      showToast(error.message || "Payment failed");
    } finally {
      setLoading(false);
    }
  }

  async function handleContinue() {
    if (paymentPlan === "PAY_LATER") {
      await handlePayLaterBooking();
      return;
    }

    await handleOnlinePayment();
  }

  return (
    <div className="page" style={{ background: "var(--black)" }}>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 16px 56px" }}>
        <div style={{ marginBottom: 20 }}>
          <button className="btn btn-glass" onClick={() => navigate(-1)}>Back</button>
        </div>

        <div className="glass-card" style={{ padding: 28 }}>
          <div style={{ fontFamily: "'Playfair Display',serif", fontSize: 34, fontWeight: 800, marginBottom: 8 }}>
            Booking payment
          </div>
          <div style={{ color: "var(--gray-mid)", marginBottom: 24 }}>
            Review the booking, choose how you want to pay, then confirm the slot.
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--gray-mid)" }}>
              <span>Service</span>
              <strong style={{ color: "var(--white)" }}>{service.title}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--gray-mid)" }}>
              <span>Date</span>
              <strong style={{ color: "var(--white)" }}>{selectedDate}</strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--gray-mid)" }}>
              <span>Time</span>
              <strong style={{ color: "var(--white)" }}>
                {new Date(selectedSlot.start_time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", color: "var(--gray-mid)" }}>
              <span>Total amount</span>
              <strong style={{ color: "var(--yellow)" }}>{formatCurrency(pricing.total)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
            <button
              type="button"
              className="btn btn-glass"
              style={{
                justifyContent: "space-between",
                borderColor: paymentPlan === "ADVANCE_50" ? "rgba(255,224,51,0.55)" : undefined,
                color: paymentPlan === "ADVANCE_50" ? "var(--yellow)" : undefined,
              }}
              onClick={() => setPaymentPlan("ADVANCE_50")}
            >
              <span>Pay 50% in advance</span>
              <span>{formatCurrency(pricing.advance)}</span>
            </button>

            <button
              type="button"
              className="btn btn-glass"
              style={{
                justifyContent: "space-between",
                borderColor: paymentPlan === "FULL" ? "rgba(255,224,51,0.55)" : undefined,
                color: paymentPlan === "FULL" ? "var(--yellow)" : undefined,
              }}
              onClick={() => setPaymentPlan("FULL")}
            >
              <span>Pay full amount</span>
              <span>{formatCurrency(pricing.total)}</span>
            </button>

            <button
              type="button"
              className="btn btn-glass"
              style={{
                justifyContent: "space-between",
                borderColor: paymentPlan === "PAY_LATER" ? "rgba(255,224,51,0.55)" : undefined,
                color: paymentPlan === "PAY_LATER" ? "var(--yellow)" : undefined,
              }}
              onClick={() => setPaymentPlan("PAY_LATER")}
            >
              <span>Pay after service</span>
              <span>Book now</span>
            </button>
          </div>

          <div style={{ fontSize: 13, color: "var(--gray-text)", lineHeight: 1.6, marginBottom: 20 }}>
            {paymentPlan === "PAY_LATER"
              ? "The slot will be booked now and the payment will remain pending until the service is completed."
              : paymentPlan === "FULL"
                ? "You will be taken to Razorpay on the next step to complete the full payment."
                : "You will be taken to Razorpay on the next step to pay 50% in advance and reserve the slot."}
          </div>

          {paymentPlan === "PAY_LATER" && bookingError && <div role="alert" style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>{bookingError}</div>}
          <button
            className="btn btn-yellow"
            style={{ width: "100%", padding: 14, borderRadius: 12 }}
            onClick={handleContinue}
            disabled={loading}
          >
            {loading
              ? "Processing..."
              : paymentPlan === "PAY_LATER"
                ? "Book now and pay later"
                : "Proceed to payment"}
          </button>
        </div>
      </div>
    </div>
  );
}
