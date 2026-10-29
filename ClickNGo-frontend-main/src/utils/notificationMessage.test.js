import { describe, expect, it } from "vitest";
import { notificationMessage } from "./notificationMessage";

describe("notificationMessage", () => {
  it("identifies an expired extension separately from a rejected reschedule", () => {
    expect(notificationMessage({
      type: "RESCHEDULE_REJECTED",
      data: { request_kind: "EXTENSION", result: "EXPIRED" },
    })).toMatch(/extension request expired/i);
    expect(notificationMessage({
      type: "RESCHEDULE_REJECTED",
      data: { request_kind: "RESCHEDULE", result: "REJECTED" },
      message: "Your reschedule request was rejected.",
    })).toBe("Your reschedule request was rejected.");
  });

  it("uses existing message text when the payload has no lifecycle metadata", () => {
    expect(notificationMessage({ message: "A customer booked your service." }))
      .toBe("A customer booked your service.");
  });
});
