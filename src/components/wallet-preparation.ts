import { apiJson, ClientApiError } from "./client-api";
export type WalletStatus = {
  apple: "available" | "unavailable";
  google: "available" | "test_only" | "unavailable";
  applePass?: { status: "unavailable" | "not_requested" | "pending" | "ready" | "failed"; url?: string; retryAfterSeconds?: number };
  /** The card's Apple pass came from the previous provider, which is being retired; ask the customer to add it again. */
  appleReAdd?: boolean;
  /** ENG-130: a device registered the card's live Apple pass. */
  appleSaved?: boolean;
  /** ENG-172: the card's live Apple pass left the server at least once. */
  appleDownloaded?: boolean;
};
async function walletRequest<T>(path: string, token: string, signal: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try { return await apiJson<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }), signal: controller.signal }); }
  finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}
export const readWalletStatus = (token: string, signal: AbortSignal) => walletRequest<WalletStatus>("/api/wallet/status", token, signal);
function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
  });
}
const unavailable = () => new ClientApiError(503, "Wallet unavailable", "WALLET_UNAVAILABLE");
/** One issuance request, then bounded authenticated polling. A subsequent tap resumes the same outbox identity. */
export async function prepareAppleWallet(token: string, signal: AbortSignal): Promise<string> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    let result = await walletRequest<NonNullable<WalletStatus["applePass"]>>("/api/wallet/apple", token, controller.signal);
    while (result.status === "pending") {
      await wait(Math.min(60, Math.max(5, result.retryAfterSeconds ?? 5)) * 1000, controller.signal);
      result = (await readWalletStatus(token, controller.signal)).applePass ?? { status: "unavailable" };
    }
    if (result.status !== "ready" || !result.url || !/^\/api\/wallet\/apple\/download\/[A-Za-z0-9_.-]+$/.test(result.url)) throw unavailable();
    return result.url;
  } catch (error) { if (!signal.aborted && controller.signal.aborted) throw unavailable(); throw error; }
  finally { clearTimeout(timeout); signal.removeEventListener("abort", abort); }
}
/** ENG-172: only a pass the server handed out proves Apple's sheet opened; a failed read counts as not opened, so the button stays. */
export const sheetOpened = (token: string, signal: AbortSignal) => readWalletStatus(token, signal).then(status => status.appleDownloaded === true, () => false);
export function walletPlatform(): "ios" | "android" | "other" {
  const agent = navigator.userAgent;
  if (/iPhone|iPod/.test(agent) || (/iPad|Macintosh/.test(agent) && navigator.maxTouchPoints > 1)) return "ios";
  return /Android/.test(agent) ? "android" : "other";
}

export function walletMessage(cause: unknown, french: boolean): string {
  const code = cause instanceof ClientApiError ? cause.code : undefined;
  const status = cause instanceof ClientApiError ? cause.status : -1;
  if (status === 0) return french ? "Pas de connexion. Vérifiez votre connexion Internet et réessayez." : "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut.";
  if (code === "RATE_LIMIT") return french ? "Trop de tentatives. Patientez un instant puis réessayez." : "Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.";
  if (code === "NOT_FOUND") return french ? "Ce lien de carte n’est plus valable. Ouvrez votre lien de carte actuel." : "Dieser Kartenlink gilt nicht mehr. Öffne deinen aktuellen Kartenlink.";
  if (code === "WALLET_UNAVAILABLE") return french ? "Wallet n’est pas disponible pour le moment. Votre carte fonctionne toujours ici, dans le navigateur." : "Wallet ist gerade nicht verfügbar. Deine Karte funktioniert weiterhin hier im Browser.";
  return french ? "Wallet est momentanément injoignable. Réessayez dans quelques minutes ; votre carte fonctionne toujours ici." : "Wallet ist gerade nicht erreichbar. Bitte versuche es in ein paar Minuten erneut; deine Karte funktioniert weiterhin hier.";
}
