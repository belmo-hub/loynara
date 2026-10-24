import { ZodError } from "zod";
import { respondError } from "./http";
import { DomainError } from "./loyalty";

/**
 * Owner billing routes (ENG-072): the owner reads one German line per error code; what actually failed (Stripe's status and
 * error code, our internal message, a response that did not parse) goes to the server log only. The status code stays.
 */
const OWNER_TEXT: Record<string, string> = {
  UNAUTHENTICATED: "Du bist abgemeldet. Bitte melde dich neu an.",
  FORBIDDEN: "Nur Inhaber:innen können Abrechnungsdaten sehen.",
  NOT_FOUND: "Dieser Eintrag ist nicht mehr da. Bitte lade die Seite neu.",
  BILLING_STATE: "Der Stand hat sich gerade geändert. Bitte lade die Seite neu.",
  PLAN_UNAVAILABLE: "Dein Tarif wird noch festgelegt. Danach kannst du das Abo hier abschließen.",
  BILLING_DISABLED: "Die Online-Zahlung ist gerade nicht verfügbar. Bitte versuch es später noch einmal.",
  // A Stripe price or tax rate that does not match the plan: only we can fix it, so no "try again".
  PLAN_MISCONFIGURED: "Bei der Online-Zahlung stimmt auf unserer Seite etwas nicht. Bitte melde dich bei uns, wir kümmern uns darum.",
};
export const BILLING_FALLBACK_TEXT = "Das hat gerade nicht geklappt. Bitte versuch es in ein paar Minuten noch einmal.";
// Expected answers, not failures: nothing to log.
const QUIET = new Set(["UNAUTHENTICATED", "FORBIDDEN", "RATE_LIMIT"]);

export function respondBillingError(error: unknown) {
  const response = respondError(error);
  const code = error instanceof DomainError ? error.code : undefined;
  // The client already says "Zu viele Anfragen…" in German for a 429 and needs the Retry-After header kept.
  if (code === "RATE_LIMIT") return response;
  if (!code || !QUIET.has(code)) {
    // Our own messages and Stripe's status and code only, never request values; a failed parse names the fields, not their contents.
    const detail = error instanceof DomainError ? `${error.code}: ${error.message}`
      : error instanceof ZodError ? `unexpected provider response at ${error.issues.map(issue => issue.path.join(".")).join(", ")}`
        : error instanceof Error ? error.name : "unknown";
    console.error(`Billing request failed (${detail})`);
  }
  const provider = code === "PROVIDER_ERROR" || error instanceof ZodError;
  return Response.json({ error: (code && OWNER_TEXT[code]) ?? BILLING_FALLBACK_TEXT, ...(code ? { code } : {}) }, { status: provider ? 502 : response.status, headers: { "Cache-Control": "no-store" } });
}
