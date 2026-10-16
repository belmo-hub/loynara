import { ClientApiError } from "@/components/client-api";

// What the owner area says when loading the account or changing the team fails. Server diagnostics ("Owner access
// required", "Staff member not found", "Internal error") are never shown: each case says what happened and what to do
// next. Codes come from src/lib/staff.ts, src/lib/product.ts (getMerchantContext) and src/lib/http.ts (respondError).

const SIGNED_OUT = "Deine Anmeldung ist abgelaufen. Melde dich erneut an und versuche es dann noch einmal.";
const NOT_OWNER = "Nur Inhaber:innen können Teamzugänge verwalten. Melde dich mit dem Konto der Inhaberin oder des Inhabers an.";
const RELOAD = "Lade die Seite neu und versuche es erneut.";
const RATE_LIMITED = "Zu viele Anfragen. Warte bitte kurz und versuche es erneut.";
export const SETUP_INCOMPLETE = "Die Einrichtung deines Geschäfts ist unvollständig. Bitte wende dich an den Support. Starte keine neue Einrichtung.";

/** Answers every team request shares; `undefined` when the endpoint decides. */
function common(cause: ClientApiError) {
  if (cause.status === 401 || cause.code === "UNAUTHENTICATED") return SIGNED_OUT;
  if (cause.code === "FORBIDDEN") return NOT_OWNER;
  if (cause.code === "INVALID_ORIGIN") return `Die Anfrage kam nicht von dieser Seite. ${RELOAD}`;
  if (cause.status === 429) return RATE_LIMITED;
}

/** No answer, or an unreadable 2xx: the invitation may have been created. */
export const inviteUnconfirmed = (cause: unknown) => !(cause instanceof ClientApiError) || cause.status === 0 || (cause.status >= 200 && cause.status < 300);

/** A failed POST /api/staff/invite for `email`. */
export function inviteCreateMessage(cause: unknown, email: string): string {
  if (!(cause instanceof ClientApiError) || inviteUnconfirmed(cause))
    return `Die Erstellung für ${email} wurde nicht bestätigt. Die Einladung kann bereits erstellt sein. Prüfe den Team-Verlauf, bevor du einen weiteren Link erstellst. Es wurde nichts automatisch versendet.`;
  const shared = common(cause);
  if (shared) return shared;
  if (cause.code === "NOT_FOUND") return "Der Standort ist nicht mehr ausgewählt. Lade die Seite neu, prüfe den Standort und erstelle den Link dann erneut.";
  if (cause.status >= 500) return "Die Einladung kann gerade nicht erstellt werden. Prüfe den Team-Verlauf und versuche es später erneut.";
  if (cause.status === 400 && !cause.code) return "Die Einladung wurde nicht erstellt. Prüfe die E-Mail-Adresse und versuche es erneut.";
  return `Die Einladung wurde nicht erstellt. ${RELOAD}`;
}

/** A failed POST /api/staff/revoke. Revoking is idempotent, so checking the list and trying again is safe. */
export function staffRevokeMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || cause.status === 0)
    return "Ob der Zugang gesperrt wurde, ist nicht bestätigt. Prüfe deine Verbindung und die Liste der Zugänge, dann versuche es erneut.";
  const shared = common(cause);
  if (shared) return shared;
  if (cause.code === "NOT_FOUND") return "Diesen Zugang gibt es in deinem Team nicht mehr. Lade die Seite neu, um die aktuelle Liste zu sehen.";
  if (cause.code === "CANNOT_REVOKE_OWNER") return "Den Zugang der Inhaberin oder des Inhabers kannst du hier nicht sperren.";
  if (cause.status >= 500) return "Der Zugang kann gerade nicht gesperrt werden. Lade die Seite neu, prüfe die Liste und versuche es später erneut.";
  return `Der Zugang wurde nicht gesperrt. ${RELOAD}`;
}

/** A failed POST /api/staff/invite/revoke; the page reloads the invitation list afterwards either way. */
export function inviteRevokeMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || cause.status === 0)
    return "Ob die Einladung widerrufen wurde, ist nicht bestätigt. Prüfe deine Verbindung und den Einladungsstatus, bevor du es erneut versuchst.";
  const shared = common(cause);
  if (shared) return shared;
  if (cause.code === "NOT_FOUND") return "Diese Einladung gibt es nicht mehr. Die Liste der Einladungen ist jetzt aktuell.";
  if (cause.code === "INVITE_USED") return "Diese Einladung wurde schon angenommen. Sperre den Zugang bei Bedarf unter „Aktuelle Zugänge“.";
  if (cause.code === "INVALID_INVITE") return "Diese Einladung ist schon abgelaufen. Der Link funktioniert nicht mehr, du musst nichts weiter tun.";
  if (cause.status >= 500) return "Die Einladung kann gerade nicht widerrufen werden. Prüfe den Einladungsstatus und versuche es später erneut.";
  return `Die Einladung wurde nicht widerrufen. ${RELOAD}`;
}

/** A failed GET /api/me other than 401 (which sends the person to the sign-in). The error screen offers a retry. */
export function accountLoadMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || cause.status === 0) return "Dein Konto konnte nicht geladen werden, weil die Verbindung fehlt. Prüfe deine Verbindung und versuche es erneut.";
  if (cause.code === "FORBIDDEN") return "Dein Zugang wurde entzogen. Bitte wende dich an die Inhaberin oder den Inhaber.";
  if (cause.code === "SETUP_INCOMPLETE") return SETUP_INCOMPLETE;
  if (cause.code === "NOT_FOUND" || cause.code === "INVALID_LOCATION") return "Der zuletzt gewählte Standort ist nicht mehr verfügbar. Bitte wende dich an den Support.";
  if (cause.status === 429) return RATE_LIMITED;
  if (cause.status >= 500) return "Dein Konto kann gerade nicht geladen werden. Versuche es in einem Moment erneut.";
  return "Dein Konto konnte nicht geladen werden. Versuche es erneut.";
}
