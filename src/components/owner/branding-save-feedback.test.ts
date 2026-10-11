import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClientApiError } from "@/components/client-api";
import { brandingSaveFeedback } from "./branding-save-feedback";
import { SaveBar } from "./owner-ui";

describe("branding save acknowledgment feedback", () => {
  it.each([0, 200, 500, 503])("does not infer save failure from uncertain response %s", status => {
    const feedback = brandingSaveFeedback(new ClientApiError(status, "Private diagnostic"));
    expect(feedback.label).toBe("Speicherstatus unklar"); expect(feedback.message).toContain("nicht bestätigt"); expect(feedback.message).not.toContain("Private diagnostic");
  });
  it.each([400, 401, 403, 404, 409, 422, 429])("retains explicit rejection feedback for %s", status => {
    expect(brandingSaveFeedback(new ClientApiError(status, "Rejected input"))).toEqual({ label: "Speichern fehlgeschlagen", message: "Rejected input" });
  });
  it("treats an unexpected exception as unconfirmed, without private diagnostics", () => {
    expect(brandingSaveFeedback(new Error("Private diagnostic")).label).toBe("Speicherstatus unklar");
    expect(brandingSaveFeedback(null).message).not.toContain("Private diagnostic");
  });
  it("keeps the default save error label and controls for other editors", () => {
    const html = renderToStaticMarkup(createElement(SaveBar, { state: "error", onSave: () => {}, onDiscard: () => {} }));
    expect(html).toContain("Speichern fehlgeschlagen"); expect(html).not.toContain('disabled=""');
  });
  it("uses the uncertainty label only for a save error", () => {
    expect(renderToStaticMarkup(createElement(SaveBar, { state: "error", errorLabel: "Speicherstatus unklar", detail: "Check saved state" }))).toContain("Speicherstatus unklar");
    const html = renderToStaticMarkup(createElement(SaveBar, { state: "saved", errorLabel: "Speicherstatus unklar" }));
    expect(html).toContain("Gespeichert"); expect(html).not.toContain("Speicherstatus unklar"); expect(html).toContain('disabled=""');
  });
});
