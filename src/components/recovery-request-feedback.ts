import { ClientApiError } from "./client-api";

/** This public form must not reflect arbitrary API diagnostics or infer inbox delivery. */
export function recoveryRequestFeedback(cause: unknown): string {
  if (cause instanceof ClientApiError) {
    if (cause.status === 0) return "Ob deine Anfrage angekommen ist, konnte nicht bestätigt werden. Prüfe dein Postfach, bevor du erneut einen Link anforderst.";
    if (cause.code === "RECOVERY_DISABLED") return "E-Mail-Wiederherstellung ist derzeit nicht verfügbar. Bitte versuche es später erneut oder wende dich an das Geschäft.";
    if (cause.status === 429) return "Zu viele Anfragen. Bitte warte kurz und versuche es erneut.";
    if (cause.status === 400 && !cause.code) return "Bitte gib eine gültige E-Mail-Adresse ein.";
  }
  return "Deine Anfrage konnte nicht bestätigt werden. Bitte versuche es später erneut.";
}
