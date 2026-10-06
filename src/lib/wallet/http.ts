import { ZodError } from "zod";
import { respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit, InvalidIngressError, RateLimitError } from "@/lib/rate-limit";

export const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

/** Same body for every "cannot issue right now" case: no reason, configuration name or provider detail. */
export function walletUnavailable() {
  return Response.json({ error: "Wallet ist für diese Karte gerade nicht verfügbar.", code: "WALLET_UNAVAILABLE" }, { status: 503, headers: noStore });
}

/**
 * Customer-facing issuance errors. Domain errors (unknown card, rate limit, bad input) keep their usual mapping; a
 * provider, signing or network failure becomes one generic 502 and only the error class name is logged.
 */
export function walletIssueError(error: unknown) {
  if (error instanceof DomainError || error instanceof ZodError) return respondError(error);
  console.error("Wallet issuance failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "Wallet ist gerade nicht erreichbar. Bitte versuche es später erneut.", code: "WALLET_PROVIDER_ERROR" }, { status: 502, headers: noStore });
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
  console.error("Apple Wallet web service failed", error instanceof Error ? error.name : "unknown");
  return new Response(null, { status: 500 });
}
