import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/loyalty";
import { ZodError } from "zod";
import { InvalidIngressError, RateLimitError } from "./rate-limit";
import { recordOperationalEvent } from "./operational-signals";

export async function sessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  return session.user;
}

/** The signed-in user together with the login session id (device subscriptions are bound to the session). */
export async function sessionWithUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  return { user: session.user, sessionId: session.session.id };
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(process.env.PUBLIC_BASE_URL ?? request.url).origin;
  if (!origin || origin !== expected) throw new DomainError("INVALID_ORIGIN", "Request origin not allowed");
}

export async function jsonBody(request: Request, maxBytes = 3_100_000) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new DomainError("INVALID_CONTENT_TYPE", "Expected JSON");
  const advertisedLength = Number(request.headers.get("content-length"));
  if (advertisedLength > maxBytes) throw new DomainError("TOO_LARGE", "Request too large");
  const reader = request.body?.getReader();
  if (!reader) throw new DomainError("INVALID_JSON", "Invalid JSON");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new DomainError("TOO_LARGE", "Request too large");
    }
    chunks.push(value);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks, size));
  try { return JSON.parse(text) as unknown; } catch { throw new DomainError("INVALID_JSON", "Invalid JSON"); }
}

export function respondError(error: unknown) {
  if (error instanceof InvalidIngressError) {
    recordOperationalEvent("request_error");
    return Response.json({ error: "Service unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  if (error instanceof ZodError) return Response.json({ error: "Invalid input", issues: error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
  if (error instanceof DomainError) {
    if (error.code === "CLOSURE_ARCHIVE_UNAVAILABLE") recordOperationalEvent("request_error");
    const status = error.code === "CLOSURE_ARCHIVE_UNAVAILABLE" ? 503 : error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN" ? 403 : error.code === "NOT_FOUND" || error.code === "PLATE_UNLINKED" ? 404 : ["INSUFFICIENT_BALANCE", "KEY_REUSED", "ALREADY_ONBOARDED", "PLAN_MEMBER_LIMIT", "BILLING_STATE", "TAP_ALREADY_CONFIRMED", "CARD_EXISTS", "ACCOUNT_SWITCH_REQUIRED", "AUTHENTICATION_REQUIRED", "PUSH_DEVICE_IN_USE", "PROGRAMME_BUSY"].includes(error.code) ? 409 : error.code === "RATE_LIMIT" ? 429 : 400;
    const headers: HeadersInit | undefined = error instanceof RateLimitError ? { "Retry-After": String(error.retryAfterSeconds), "Cache-Control": "no-store" } : undefined;
    return Response.json({ error: error.message, code: error.code }, { status, headers });
  }
  recordOperationalEvent("request_error");
  console.error("Request failed");
  return Response.json({ error: "Internal error" }, { status: 500, headers: { "Cache-Control": "no-store" } });
}
