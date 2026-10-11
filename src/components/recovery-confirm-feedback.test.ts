import { describe, expect, it } from "vitest";
import { ClientApiError } from "./client-api";
import { recoveryConfirmationFeedback } from "./recovery-confirm-feedback";

for (const action of ["list", "rotate"] as const) describe(`recovery ${action} feedback`, () => {
  it("retains the established invalid/expired/used response only for explicit proof rejection", () => {
    expect(recoveryConfirmationFeedback(new ClientApiError(400, "synthetic_private_proof", "INVALID_RECOVERY"), action)).toBe("Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.");
  });
  it("distinguishes the existing rate limit from proof rejection", () => {
    const feedback = recoveryConfirmationFeedback(new ClientApiError(429, "synthetic_private_proof", "RATE_LIMIT", 60_000), action);
    expect(feedback).toContain("Zu viele Anfragen"); expect(feedback).not.toContain("ungültig");
  });
  it.each([0, 500, 503, 403, 200, 400])("does not infer invalidity or completion from status %s without explicit proof rejection", status => {
    const feedback = recoveryConfirmationFeedback(new ClientApiError(status, "synthetic_private_proof"), action);
    expect(feedback).toContain("nicht bestätigt"); expect(feedback).not.toMatch(/synthetic_private_proof|ungültig|abgelaufen|bereits verwendet/);
    if (action === "rotate") expect(feedback).toContain("Ob deine Karte wiederhergestellt wurde");
  });
  it("does not reflect unexpected exceptions", () => {
    expect(recoveryConfirmationFeedback(new Error("synthetic_private_proof"), action)).not.toContain("synthetic_private_proof");
  });
});
