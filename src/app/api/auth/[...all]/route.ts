import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit, peerIdentity, RateLimitError, refundRateLimit } from "@/lib/rate-limit";
import { respondError } from "@/lib/http";
import { queueSignInLockNotice } from "@/lib/sign-in-lock-notice";

const handlers = toNextJsHandler(auth);
// Failed password attempts per account, from any address. The per-address limits cannot stop guessing that is spread
// over many addresses. Every attempt reserves a slot atomically before the password is checked, so parallel guesses
// cannot all slip through; the slot is given back unless the password was wrong.
const accountFailures = { scope: "auth_signin_account_failure", max: 10, windowSeconds: 15 * 60 };

function validateIngress(request: Request) {
  // All auth endpoints can reach Better Auth's own IP limits/session metadata.
  // Validate first, including endpoints without an additional outer peer limit.
  peerIdentity(request);
}

/** The account a sign-in targets. A body this cannot read is refused, so it can never slip past the account limit. */
async function signInAccount(request: Request) {
  const invalid = new DomainError("INVALID_INPUT", "Invalid sign-in request");
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw invalid;
  const text = await request.clone().text();
  if (text.length > 4096) throw invalid;
  let body: unknown;
  try { body = JSON.parse(text); } catch { throw invalid; }
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== "string" || !email.trim() || email.length > 320) throw invalid;
  return email.trim().toLowerCase();
}

export async function GET(request: Request) {
  try { validateIngress(request); return await handlers.GET(request); }
  catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    validateIngress(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/sign-up/email")) await enforcePeerLimit(request, "auth_signup_peer", 15, 15 * 60);
    if (!path.endsWith("/sign-in/email")) return await handlers.POST(request);
    await enforcePeerLimit(request, "auth_signin_peer", 30, 15 * 60);
    const account = { ...accountFailures, identity: await signInAccount(request) };
    try { await enforceRateLimit(account); }
    catch (error) {
      // The account is locked: tell its owner (at most once a day). A failure here never changes the refusal.
      if (error instanceof RateLimitError) {
        await queueSignInLockNotice(account.identity)
          .catch(notice => console.error(`Sign-in lock notice not queued (${notice instanceof Error ? notice.name : "error"})`));
      }
      throw error;
    }
    let wrongPassword = false;
    try {
      const response = await handlers.POST(request);
      wrongPassword = response.status === 401;
      return response;
    } finally {
      if (!wrongPassword) await refundRateLimit(account);
    }
  } catch (error) { return respondError(error); }
}
