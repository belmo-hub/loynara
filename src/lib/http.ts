import { auth } from "@/lib/auth";
import { DomainError } from "@/lib/loyalty";
import { ZodError } from "zod";

export async function sessionUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new DomainError("UNAUTHENTICATED", "Sign in required");
  return session.user;
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
  if (error instanceof ZodError) return Response.json({ error: "Invalid input", issues: error.issues.map(({ path, message }) => ({ path, message })) }, { status: 400 });
  if (error instanceof DomainError) {
    const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" || error.code === "INVALID_ORIGIN" ? 403 : error.code === "NOT_FOUND" ? 404 : error.code === "INSUFFICIENT_BALANCE" || error.code === "KEY_REUSED" || error.code === "ALREADY_ONBOARDED" ? 409 : 400;
    return Response.json({ error: error.message, code: error.code }, { status });
  }
  console.error("Request failed", error instanceof Error ? error.name : "unknown");
  return Response.json({ error: "Internal error" }, { status: 500 });
}
