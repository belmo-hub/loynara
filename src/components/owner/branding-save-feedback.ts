import { ClientApiError } from "@/components/client-api";

/** A missing success response does not establish whether the branding write committed. */
export function brandingSaveFeedback(cause: unknown): { label: string; message: string } {
  if (cause instanceof ClientApiError && [400, 401, 403, 404, 409, 422, 429].includes(cause.status)) {
    return { label: "Speichern fehlgeschlagen", message: cause.message };
  }
  return { label: "Speicherstatus unklar", message: "Ob deine Kundenkarte gespeichert wurde, konnte nicht bestätigt werden. Prüfe den gespeicherten Stand, bevor du erneut speicherst." };
}
