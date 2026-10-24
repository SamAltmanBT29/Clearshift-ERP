import { describe, expect, it } from "vitest";
import { redactSensitiveData } from "../src/logging/redact.js";

describe("sensitive data redaction", () => {
  it("preserves UUID references while redacting payment card numbers", () => {
    const id = "11111111-9999-4000-8000-999999999999";
    expect(redactSensitiveData(`product ${id}`)).toBe(`product ${id}`);
    expect(redactSensitiveData("card 4111 1111 1111 1111")).toContain("[REDACTED_CARD]");
  });

  it("does not classify dotted field paths as JWTs", () => {
    expect(redactSensitiveData("lines.0.product_id")).toBe("lines.0.product_id");
  });
});
