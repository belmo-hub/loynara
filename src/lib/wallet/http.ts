import { randomBytes } from "node:crypto";
import { ZodError } from "zod";
import { respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { recordOperationalEvent } from "../operational-signals";
import { enforcePeerLimit, enforceRateLimit, InvalidIngressError, RateLimitError } from "@/lib/rate-limit";

export const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

/** Same body for every "cannot issue right now" case: no reason, configuration name or provider detail. */
export function walletUnavailable() {
  return Response.json({ error: "Wallet ist für diese Karte gerade nicht verfügbar.", code: "WALLET_UNAVAILABLE" }, { status: 503, headers: noStore });
}

/**
 * Customer-facing issuance errors. Domain errors (unknown card, rate limit, bad input) keep their usual mapping; a
 * provider, signing or network failure becomes one generic 502 and only a fixed diagnostic is logged.
 */
export function walletIssueError(error: unknown) {
  if (error instanceof DomainError || error instanceof ZodError) return respondError(error);
  recordOperationalEvent("wallet_failure");
  console.error("Wallet issuance failed");
  return Response.json({ error: "Wallet ist gerade nicht erreichbar. Bitte versuche es später erneut.", code: "WALLET_PROVIDER_ERROR" }, { status: 502, headers: noStore });
}

/** A download navigation needs a readable page; API callers retain the original JSON status/code. */
export function walletDownloadFailure(request: Request, response: Response): Response {
  if (!request.headers.get("accept")?.includes("text/html")) return response;
  const nonce = randomBytes(18).toString("base64");
  const message = response.status === 404
    ? "Dieser Download gilt nicht mehr. Öffne deine aktuelle Karte und versuche es dort erneut."
    : response.status === 429
      ? "Zu viele Versuche. Bitte warte eine Weile und versuche es auf deiner Karte erneut."
      : "Wallet ist gerade nicht erreichbar. Deine Karte funktioniert weiterhin im Browser. Bitte versuche es später erneut.";
  // Only fixed product text enters this document. No path, ticket, card token or provider error is reflected.
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Wallet gerade nicht verfügbar</title><style nonce="${nonce}">body{margin:0;background:#f3f6f0;color:#214739;font:16px/1.6 system-ui,sans-serif}main{max-width:34rem;margin:12vh auto;padding:24px}h1{font-size:1.8rem;line-height:1.2}button,a{font:inherit}button{border:0;border-radius:10px;padding:12px 18px;background:#214739;color:#fff;cursor:pointer}button:focus-visible,a:focus-visible{outline:3px solid #56a46a;outline-offset:3px}a{display:block;margin-top:16px;color:#214739}</style></head><body><main><h1>Wallet gerade nicht verfügbar</h1><p>${message}</p><button type="button" id="return-card">Zurück zur Karte</button><a href="/">Zur Startseite</a></main><script nonce="${nonce}">document.getElementById("return-card").addEventListener("click",function(){history.back()});</script></body></html>`;
  const headers = new Headers(noStore);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) headers.set("Retry-After", retryAfter);
  return new Response(html, { status: response.status, headers });
}

/** The card bearer token travels in the POST body, never in a Wallet URL. */
export function cardTokenFrom(body: unknown): string {
  const token = body && typeof body === "object" ? (body as { token?: unknown }).token : undefined;
  if (typeof token !== "string" || token.length > 100) throw new DomainError("NOT_FOUND", "Card not found");
  return token;
}

/**
 * Apple's web-service protocol expects bare status codes. Rate limits key on the peer AND on the device or serial,
 * because devices behind carrier NAT share addresses and one device must not exhaust a shared bucket alone.
 */
export async function appleServiceLimits(request: Request, limits: Array<{ scope: string; identity: string; max: number }>): Promise<Response | null> {
  try {
    await enforcePeerLimit(request, "wallet_apple_ws_peer", 600, 15 * 60);
    for (const limit of limits) await enforceRateLimit({ ...limit, windowSeconds: 15 * 60 });
    return null;
  } catch (error) { return appleServiceError(error); }
}

export function appleServiceError(error: unknown) {
  if (error instanceof RateLimitError) return new Response(null, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  if (error instanceof InvalidIngressError) return new Response(null, { status: 503 });
  if (error instanceof DomainError) {
    if (error.code === "FORBIDDEN") return new Response(null, { status: 401 });
    if (error.code === "NOT_FOUND") return new Response(null, { status: 404 });
    return new Response(null, { status: 400 });
  }
  recordOperationalEvent("wallet_failure");
  console.error("Apple Wallet web service failed");
  return new Response(null, { status: 500 });
}
