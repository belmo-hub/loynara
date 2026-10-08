import { apiJson, ClientApiError } from "./client-api";
export type WalletStatus = {
  apple: "available" | "unavailable";
  google: "available" | "test_only" | "unavailable";
  applePass?: { status: "unavailable" | "not_requested" | "pending" | "ready" | "failed"; url?: string; retryAfterSeconds?: number };
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
