import { ClientApiError } from "@/components/client-api";

// What the sign-up and invitation forms say when something fails. Library and server diagnostics ("Registration is not
// enabled", "Invitation is invalid or expired") are never shown: each case says what happened and what to do next.

type AuthLibraryError = { status?: number; code?: string; message?: string };

const TRY_LATER = "Das Konto kann gerade nicht erstellt werden. Deine Angaben bleiben erhalten. Versuche es später erneut.";
export const CONNECTION_LOST = "Die Antwort ist nicht angekommen. Prüfe deine Verbindung und versuche es erneut. Deine Angaben bleiben erhalten.";

/** A failed `authClient.signUp.email` result, for the open registration or for an invitation. */
export function signUpMessage(error: AuthLibraryError, via: "register" | "invite"): string {
  const message = error.message ?? "";
  if (error.code === "USER_ALREADY_EXISTS" || /already exists/i.test(message)) return via === "invite"
    ? "Für diese Adresse gibt es schon ein Konto. Melde dich an und öffne diesen Link danach noch einmal."
    : "Für diese Adresse gibt es schon ein Konto. Melde dich an.";
  // The sign-up hook refuses with 403 when public registration is closed or the invitation no longer allows it.
  if (error.status === 403 || /registration is not enabled/i.test(message)) return via === "invite"
    ? "Diese Einladung gilt nicht mehr. Bitte die Person, die dich eingeladen hat, um eine neue Einladung."
    : "Die öffentliche Registrierung ist noch nicht freigeschaltet. Du kannst eine Demo anfragen.";
  if (error.status === 429) return "Zu viele Versuche. Warte bitte etwas und versuche es erneut.";
  if (/password/i.test(error.code ?? "")) return "Das Passwort passt nicht zu den Regeln. Es braucht mindestens 12 Zeichen.";
  if (error.status !== undefined && error.status >= 500) return TRY_LATER;
  return "Das Konto wurde nicht erstellt. Prüfe deine Angaben und versuche es erneut.";
}

/** A failed POST /api/staff/accept (DomainError codes from src/lib/staff.ts). */
export function inviteAcceptMessage(cause: unknown): string {
  if (!(cause instanceof ClientApiError) || cause.status === 0) return CONNECTION_LOST;
  switch (cause.code) {
    case "INVALID_INVITE": return "Diese Einladung gilt nicht mehr. Bitte die Person, die dich eingeladen hat, um eine neue Einladung.";
    case "INVITE_USED": return "Diese Einladung wurde schon angenommen. Melde dich an, dann kommst du direkt zur Kasse.";
    case "UNAUTHENTICATED": return "Melde dich zuerst an. Öffne diesen Link danach noch einmal und nimm die Einladung an.";
    case "INVITE_EMAIL_MISMATCH": return "Du bist mit einer anderen Adresse angemeldet. Melde dich mit der Adresse an, an die die Einladung ging.";
    case "ALREADY_ASSIGNED": return "Dieses Konto gehört schon zu einem Geschäft. Sprich mit der Person, die dich eingeladen hat.";
  }
  if (cause.status === 429) return "Zu viele Versuche. Warte bitte etwas und versuche es erneut.";
  return cause.status >= 500 ? "Die Einladung kann gerade nicht angenommen werden. Versuche es später erneut." : "Die Einladung wurde nicht angenommen. Lade die Seite neu und versuche es erneut.";
}
