import { ClientApiError } from "@/components/client-api";

// What the owner area says when loading the account or changing the team fails. Server diagnostics ("Owner access
// required", "Staff member not found", "Internal error") are never shown: each case says what happened and what to do
// next. Codes come from src/lib/staff.ts, src/lib/product.ts (getMerchantContext), src/lib/locations.ts and
// src/lib/http.ts (respondError).

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

/** No answer, or an unreadable 2xx: the change may have been saved. */
export const unconfirmed = (cause: unknown) => !(cause instanceof ClientApiError) || cause.status === 0 || (cause.status >= 200 && cause.status < 300);

/** A failed POST /api/staff/invite for `email`. */
export function inviteCreateMessage(cause: unknown, email: string): string {
  if (!(cause instanceof ClientApiError) || unconfirmed(cause))
    return `Die Erstellung für ${email} wurde nicht bestätigt. Die Einladung kann bereits erstellt sein. Prüfe den Team-Verlauf, bevor du einen weiteren Link erstellst. Es wurde nichts automatisch versendet.`;
  const shared = common(cause);
  if (shared) return shared;
  // The invite route checks the selected location through getMerchantContext (src/lib/product.ts).
  if (cause.code === "NOT_FOUND" || cause.code === "INVALID_LOCATION") return "Der Standort ist nicht mehr ausgewählt. Lade die Seite neu, prüfe den Standort und erstelle den Link dann erneut.";
  if (cause.code === "SETUP_INCOMPLETE") return SETUP_INCOMPLETE;
  if (cause.status >= 500) return "Die Einladung kann gerade nicht erstellt werden. Prüfe den Team-Verlauf und versuche es später erneut.";
  if (cause.status === 400 && !cause.code) return "Die Einladung wurde nicht erstellt. Prüfe die E-Mail-Adresse und versuche es erneut.";
  return `Die Einladung wurde nicht erstellt. ${RELOAD}`;
}

/** A failed POST /api/staff/revoke. Revoking is idempotent, so checking the list and trying again is safe. */
export function staffRevokeMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || unconfirmed(cause))
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
  if (!(cause instanceof ClientApiError) || unconfirmed(cause))
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
  // FORBIDDEN means a revoked team account or one without a location; the wording fits both.
  if (cause.code === "FORBIDDEN") return "Dein Zugang ist gesperrt oder keinem Standort zugeordnet. Bitte wende dich an die Inhaberin oder den Inhaber.";
  if (cause.code === "SETUP_INCOMPLETE") return SETUP_INCOMPLETE;
  if (cause.code === "NOT_FOUND" || cause.code === "INVALID_LOCATION") return "Der zuletzt gewählte Standort ist nicht mehr verfügbar. Bitte wende dich an den Support.";
  if (cause.status === 429) return RATE_LIMITED;
  if (cause.status >= 500) return "Dein Konto kann gerade nicht geladen werden. Versuche es in einem Moment erneut.";
  return "Dein Konto konnte nicht geladen werden. Versuche es erneut.";
}

/**
 * A failed POST /api/merchant/locations/select. The selection lives only in the cookie of a 2xx answer, so any other
 * answer leaves the previous location active; a lost or unreadable answer may already have switched it.
 */
export function locationSwitchMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || unconfirmed(cause))
    return "Ob der Standort gewechselt wurde, ist nicht bestätigt. Lade die Seite neu und prüfe, welcher Standort aktiv ist.";
  if (cause.code === "FORBIDDEN") return "Nur Inhaber:innen können den Standort wechseln. Melde dich mit dem Konto der Inhaberin oder des Inhabers an.";
  const shared = common(cause);
  if (shared) return shared;
  if (cause.code === "NOT_FOUND" || cause.code === "INVALID_LOCATION") return "Diesen Standort gibt es in deinem Betrieb nicht mehr. Wähle einen Standort aus der aktuellen Liste.";
  if (cause.status >= 500) return "Der Standort kann gerade nicht gewechselt werden. Dein bisheriger Standort bleibt aktiv. Versuche es in einem Moment erneut.";
  return `Der Standort wurde nicht gewechselt. ${RELOAD}`;
}

/** A failed POST /api/merchant/locations/address. Saving the same address twice is harmless, so a retry is always safe. */
export function locationAddressMessage(cause: unknown): string {
  const status = cause instanceof ClientApiError ? cause.status : 0;
  if (status === 401) return SIGNED_OUT;
  if (status === 429) return RATE_LIMITED;
  if (status === 400) return "Die Anschrift wurde nicht gespeichert. Prüfe die Pflichtfelder, die fünfstellige PLZ, die Telefonnummer und die USt-IdNr. (zum Beispiel DE123456789).";
  return "Die Anschrift wurde nicht gespeichert. Prüfe deine Verbindung und versuche es erneut.";
}

/**
 * A failed POST /api/merchant/locations (createAdditionalLocation). A lost, unreadable or 5xx answer may come after the
 * commit, so those ask to check the list first; a second try with the same name is refused (LOCATION_EXISTS).
 */
export function locationCreateMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || unconfirmed(cause))
    return "Ob der Standort angelegt wurde, ist nicht bestätigt. Lade die Seite neu und prüfe die Liste deiner Standorte, bevor du ihn erneut anlegst.";
  if (cause.code === "FORBIDDEN") return "Nur Inhaber:innen können Standorte anlegen. Melde dich mit dem Konto der Inhaberin oder des Inhabers an.";
  // Five new locations per hour and person: "wait briefly" would be wrong here.
  if (cause.status === 429) return "Zu viele neue Standorte in kurzer Zeit. Versuche es später erneut, das kann bis zu einer Stunde dauern.";
  const shared = common(cause);
  if (shared) return shared;
  if (cause.code === "LOCATION_EXISTS") return "Einen Standort mit diesem Namen gibt es schon. Wähle einen anderen Namen.";
  if (cause.code === "INVALID_TIMEZONE") return "Diese Zeitzone ist unbekannt. Gib sie zum Beispiel als Europe/Berlin an.";
  if (cause.code === "PLAN_UNAVAILABLE") return "Für deinen Betrieb ist kein Tarif hinterlegt, deshalb kann kein Standort angelegt werden. Bitte wende dich an den Support.";
  if (cause.code === "NOT_FOUND") return SETUP_INCOMPLETE;
  if (cause.status >= 500) return "Der Standort kann gerade nicht angelegt werden. Lade die Seite neu, prüfe die Liste deiner Standorte und versuche es später erneut.";
  if (cause.status === 400 && !cause.code) return "Der Standort wurde nicht angelegt. Prüfe die Angaben im Formular und versuche es erneut.";
  return `Der Standort wurde nicht angelegt. ${RELOAD}`;
}

/** A failed GET /api/me on the till (401 goes to the sign-in). Its access screen has no retry button, so it asks for a reload. */
export function cashierAccessMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || cause.status === 0) return "Die Kasse konnte nicht geladen werden, weil die Verbindung fehlt. Prüfe deine Verbindung und lade die Seite neu.";
  if (["FORBIDDEN", "SETUP_INCOMPLETE", "NOT_FOUND", "INVALID_LOCATION"].includes(cause.code ?? "")) return accountLoadMessage(cause);
  if (cause.status >= 500) return "Die Kasse kann gerade nicht geladen werden. Lade die Seite in einem Moment neu.";
  return "Die Kasse konnte nicht geladen werden. Lade die Seite neu.";
}
