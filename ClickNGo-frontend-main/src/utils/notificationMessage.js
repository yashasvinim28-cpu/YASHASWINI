export function notificationMessage(item) {
  const data = item?.data || {};

  if (data.request_kind === "CANCELLATION" && data.result === "PENDING") {
    return item?.message || "A customer requested to cancel a booking.";
  }
  if (data.request_kind === "CANCELLATION" && data.result === "REJECTED") {
    return item?.message || "Your cancellation request was rejected. Your booking remains active.";
  }
  if (data.request_kind === "CANCELLATION" && data.result === "APPROVED") {
    return item?.message || "Your cancellation request was approved.";
  }
  if (data.notification_kind === "EXTENSION_EXPIRED"
      || (data.request_kind === "EXTENSION" && data.result === "EXPIRED")) {
    return "Your session extension request expired without a provider response.";
  }
  if (data.request_kind === "EXTENSION" && data.result === "REJECTED") {
    return "Your session extension request was rejected.";
  }
  if (data.request_kind === "RESCHEDULE" && data.result === "EXPIRED") {
    return "Your reschedule request expired without a provider response.";
  }
  return item?.message || "You have a new notification.";
}
