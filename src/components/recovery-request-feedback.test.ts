import { describe, expect, it } from "vitest";
import { ClientApiError } from "./client-api";
import { recoveryRequestFeedback } from "./recovery-request-feedback";

describe("recovery request feedback", () => {
  it("makes rejected address validation actionable without reflecting server diagnostics", () => {
    const result = recoveryRequestFeedback(new ClientApiError(400, "Invalid input synthetic_private_token"));
    expect(result).toContain("gültige E-Mail-Adresse"); expect(result).not.toContain("synthetic_private_token");
  });
  it("distinguishes globally disabled recovery from a bad email address", () => {
    const result = recoveryRequestFeedback(new ClientApiError(400, "private diagnostic", "RECOVERY_DISABLED"));
    expect(result).toContain("nicht verfügbar"); expect(result).toContain("Geschäft"); expect(result).not.toContain("gültige E-Mail-Adresse");
  });
  it("keeps existing rate-limit rejections distinct from input errors", () => {
    const result = recoveryRequestFeedback(new ClientApiError(429, "private diagnostic", "RATE_LIMIT", 60_000));
    expect(result).toContain("Zu viele Anfragen"); expect(result).not.toContain("gültige E-Mail-Adresse");
  });
  it.each([500, 503, 403, 200])("does not disclose raw responses or claim delivery for status %s", status => {
    const result = recoveryRequestFeedback(new ClientApiError(status, "private diagnostic synthetic_private_token"));
    expect(result).toContain("nicht bestätigt"); expect(result).not.toMatch(/private diagnostic|synthetic_private_token|geschickt|gesendet/);
  });
  it("keeps uncertain transport outcomes distinct from a definitive input rejection", () => {
    const result = recoveryRequestFeedback(new ClientApiError(0, "Failed to fetch"));
    expect(result).toContain("nicht bestätigt"); expect(result).toContain("Postfach"); expect(result).not.toContain("gültige E-Mail-Adresse");
  });
  it("uses safe feedback for unexpected exceptions", () => {
    expect(recoveryRequestFeedback(new Error("synthetic_private_token"))).not.toContain("synthetic_private_token");
  });
});
