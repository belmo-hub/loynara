import { ClientApiError } from "./client-api";

/** Only the API's explicit proof rejection establishes an invalid recovery link. */
export function recoveryConfirmationFeedback(cause: unknown, action: "list" | "rotate"): string {
  if (cause instanceof ClientApiError) {
    if (cause.status === 400 && cause.code === "INVALID_RECOVERY") return "Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.";
    if (cause.status === 429) return "Zu viele Anfragen. Bitte warte kurz und versuche es erneut.";
  }
  if (action === "list") return "Die Gültigkeit deines Links konnte nicht bestätigt werden. Bitte versuche es später erneut.";
  return "Ob deine Karte wiederhergestellt wurde, konnte nicht bestätigt werden. Fordere bei Bedarf einen neuen Link an.";
}
