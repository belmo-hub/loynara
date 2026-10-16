import { describe, expect, it } from "vitest";
import { ClientApiError } from "@/components/client-api";
import { accountLoadMessage, inviteCreateMessage, inviteRevokeMessage, staffRevokeMessage } from "./owner-errors";

// What each endpoint really answers (src/lib/staff.ts, src/lib/product.ts, src/lib/http.ts respondError).
type Answer = [status: number, code: string | undefined, text: string];
const shared: Answer[] = [
  [401, "UNAUTHENTICATED", "Sign in required"], [403, "FORBIDDEN", "Owner access required"], [403, "INVALID_ORIGIN", "Request origin not allowed"],
  [400, "INVALID_JSON", "Invalid JSON"], [400, undefined, "Invalid input"], [429, "RATE_LIMIT", "Too many requests"],
  [500, undefined, "Internal error"], [503, undefined, "Service unavailable"], [502, undefined, "Anfrage fehlgeschlagen (502)."],
];
const answers: Record<string, [(cause: unknown) => string, Answer[]]> = {
  "invite": [cause => inviteCreateMessage(cause, "team@example.test"), [...shared, [404, "NOT_FOUND", "Location not selected"], [404, "NOT_FOUND", "Location not found"]]],
  "staff revoke": [staffRevokeMessage, [...shared, [404, "NOT_FOUND", "Staff member not found"], [400, "CANNOT_REVOKE_OWNER", "Owner role cannot be revoked here"]]],
  "invitation revoke": [inviteRevokeMessage, [...shared, [404, "NOT_FOUND", "Einladung nicht gefunden."], [409, "INVITE_USED", "Die Einladung wurde bereits angenommen. Verwende die Verwaltung der Teamzugänge."], [400, "INVALID_INVITE", "Die Einladung ist bereits abgelaufen."]]],
  "account": [accountLoadMessage, [...shared, [400, "INVALID_LOCATION", "Invalid selected location"], [404, "NOT_FOUND", "Der gewählte Standort ist nicht verfügbar. Bitte wende dich an den Support."], [400, "SETUP_INCOMPLETE", "Setup incomplete"]]],
};
const english = /sign in|required|owner|origin|invalid|input|json|internal|error|service|unavailable|not found|location|staff|cannot|request|too many|anfrage fehlgeschlagen/i;

describe.each(Object.entries(answers))("%s messages", (_, [message, list]) => {
  it.each(list)("%i %s never repeats the server text", (status, code, text) => {
    const shown = message(new ClientApiError(status, text, code));
    expect(shown).not.toContain(text);
    expect(shown).not.toMatch(english);
  });

  it("tell a lost connection apart from a server failure", () => {
    const lost = message(new ClientApiError(0, "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut."));
    expect(lost).toMatch(/Verbindung|nicht bestätigt/);
    expect(message(new TypeError("Failed to fetch"))).toBe(lost);
    expect(message(new ClientApiError(500, "Internal error"))).not.toBe(lost);
    expect(message(new ClientApiError(500, "Internal error"))).toMatch(/gerade nicht/);
  });
});

describe("what each message asks for", () => {
  it.each([
    [inviteCreateMessage(new ClientApiError(404, "Location not selected", "NOT_FOUND"), "x"), "Standort"],
    [inviteCreateMessage(new ClientApiError(400, "Invalid input"), "x"), "E-Mail-Adresse"],
    [staffRevokeMessage(new ClientApiError(404, "Staff member not found", "NOT_FOUND")), "aktuelle Liste"],
    [inviteRevokeMessage(new ClientApiError(409, "Invitation already accepted", "INVITE_USED")), "Aktuelle Zugänge"],
    [inviteRevokeMessage(new ClientApiError(400, "expired", "INVALID_INVITE")), "abgelaufen"],
    [staffRevokeMessage(new ClientApiError(401, "Sign in required", "UNAUTHENTICATED")), "Melde dich erneut an"],
    [accountLoadMessage(new ClientApiError(400, "Setup incomplete", "SETUP_INCOMPLETE")), "Starte keine neue Einrichtung"],
  ])("%s", (shown, text) => expect(shown).toContain(text));

  it("keep the unconfirmed invitation warning for a lost or unreadable answer", () => {
    for (const status of [0, 201]) expect(inviteCreateMessage(new ClientApiError(status, "x"), "team@example.test")).toContain("Die Erstellung für team@example.test wurde nicht bestätigt");
  });

  it("say a revoked account was revoked (merchant-onboarding-compat spec)", () => {
    expect(accountLoadMessage(new ClientApiError(403, "Dein Zugang wurde entzogen.", "FORBIDDEN"))).toContain("Dein Zugang wurde entzogen.");
  });
});
