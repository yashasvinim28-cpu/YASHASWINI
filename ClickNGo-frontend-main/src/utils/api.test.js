import { describe, expect, it } from "vitest";
import { getApiErrorMessage } from "./api";

describe("API error messages", () => {
  it("surfaces the backend detail when its generic 500 label hides the RPC error", () => {
    expect(getApiErrorMessage({ error: "Internal Server Error", message: "No consecutive slots available" }))
      .toBe("No consecutive slots available");
  });

  it("prefers explicit API errors and provides a fallback", () => {
    expect(getApiErrorMessage({ error: "Access denied" })).toBe("Access denied");
    expect(getApiErrorMessage({ message: "Request failed" })).toBe("Request failed");
    expect(getApiErrorMessage({})).toBe("API Request Failed");
  });
});
