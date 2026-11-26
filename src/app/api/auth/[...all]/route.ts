import { eq } from "drizzle-orm";
import { db } from "@/db";
import { staffRoles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit, enforceRateLimit, peerIdentity, RateLimitError, refundRateLimit } from "@/lib/rate-limit";
import { jsonBody, respondError } from "@/lib/http";
import { queueSignInLockNotice } from "@/lib/sign-in-lock-notice";

const handlers = toNextJsHandler(auth);
// Failed password attempts per account, from any address. The per-address limits cannot stop guessing that is spread
// over many addresses. Every attempt reserves a slot atomically before the password is checked, so parallel guesses
// cannot all slip through; the slot is given back unless the password was wrong.
const accountFailures = { scope: "auth_signin_account_failure", max: 10, windowSeconds: 15 * 60 };
// ENG-279, ENG-283: a reset writes a token only for an existing account, and a sign-up writes an account only for a new
// address, so both answer no sooner than this, whatever the address; the time then tells nothing about it.
const ANSWER_MS = 400;

async function answerNoSooner(request: Request) {
  const started = Date.now();
  try { return await handlers.POST(request); }
  finally { await new Promise(resolve => setTimeout(resolve, Math.max(0, ANSWER_MS - (Date.now() - started)))); }
}

// Passkeys are for owners and managers on their own phones, not the Kasse: a passkey on a shared counter device would let
// anyone who can unlock it sign in as that person (Design R1, CTO, 23 Nov). Adding one is refused for anyone else.
const PASSKEY_REGISTRATION = ["/passkey/generate-register-options", "/passkey/verify-registration"];
async function passkeyRegistrationRefused(request: Request) {
  const path = new URL(request.url).pathname;
  if (!PASSKEY_REGISTRATION.some(route => path.endsWith(route))) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return null; // the plugin answers a missing session itself (401)
  const [staff] = await db.select({ role: staffRoles.role, active: staffRoles.active }).from(staffRoles).where(eq(staffRoles.userId, session.user.id)).limit(1);
  // Only an active owner or manager: a cashier, a revoked person or an account without a shop role adds none.
  if (!staff || !staff.active || (staff.role !== "owner" && staff.role !== "manager")) return Response.json({ code: "PASSKEY_NOT_FOR_ROLE", message: "Passkeys are for owners and managers" }, { status: 403, headers: { "Cache-Control": "no-store" } });
  return null;
}

/** Reserves one password attempt for the account; a locked account's owner is told (at most once a day), then refused. */
async function reserveAttempt(identity: string) {
  const account = { ...accountFailures, identity };
  try { await enforceRateLimit(account); }
  catch (error) {
    // A failure of the notice never changes the refusal.
    if (error instanceof RateLimitError) {
      await queueSignInLockNotice(identity)
        .catch(notice => console.error(`Sign-in lock notice not queued (${notice instanceof Error ? notice.name : "error"})`));
    }
    throw error;
  }
  return account;
}

function validateIngress(request: Request) {
  // All auth endpoints can reach Better Auth's own IP limits/session metadata.
  // Validate first, including endpoints without an additional outer peer limit.
  peerIdentity(request);
}

/** The account a sign-in targets. A body this cannot read is refused, so it can never slip past the account limit. */
async function signInAccount(request: Request) {
  const invalid = new DomainError("INVALID_INPUT", "Die Anmeldung hat nicht geklappt. Bitte lade die Seite neu und versuche es noch einmal.");
  let body: unknown;
  // Read from a copy, with the cap applied while streaming: Better Auth still reads the original.
  try { body = await jsonBody(request.clone(), 4096); } catch { throw invalid; }
  const email = (body as { email?: unknown } | null)?.email;
  if (typeof email !== "string" || !email.trim() || email.length > 320) throw invalid;
  return email.trim().toLowerCase();
}

export async function GET(request: Request) {
  // ENG-286: Better Auth's own reset link redirects with the token in the query, into server and proxy logs. Our mail links
  // to /reset-password#token=… instead, so this route is closed.
  if (new URL(request.url).pathname.includes("/reset-password/")) return new Response(null, { status: 404 });
  try {
    validateIngress(request);
    // Each passkey challenge is a stored row: a page load asks for one, a script must not ask for thousands.
    if (new URL(request.url).pathname.endsWith("/passkey/generate-authenticate-options")) await enforcePeerLimit(request, "auth_passkey_peer", 60, 15 * 60);
    return await passkeyRegistrationRefused(request) ?? await handlers.GET(request);
  }
  catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    validateIngress(request);
    const path = new URL(request.url).pathname;
    if (path.endsWith("/sign-up/email")) {
      await enforcePeerLimit(request, "auth_signup_peer", 15, 15 * 60);
      // Better Auth answers an existing address with a made-up account; a fixed body leaves nothing to compare.
      const response = await answerNoSooner(request);
      return response.ok ? Response.json({ status: true }) : response;
    }
    if (path.endsWith("/send-verification-email")) await enforcePeerLimit(request, "auth_verify_peer", 5, 15 * 60);
    if (path.endsWith("/request-password-reset")) {
      await enforcePeerLimit(request, "auth_reset_peer", 5, 15 * 60);
      return await answerNoSooner(request);
    }
    if (path.endsWith("/reset-password")) await enforcePeerLimit(request, "auth_reset_use_peer", 10, 15 * 60);
    if (path.endsWith("/passkey/generate-authenticate-options") || path.endsWith("/passkey/verify-authentication")) await enforcePeerLimit(request, "auth_passkey_peer", 60, 15 * 60);
    const refused = await passkeyRegistrationRefused(request);
    if (refused) return refused;
    // ENG-379: a wrong current password counts against the sign-in budget of the same account, so a stolen session
    // cookie cannot use this form to guess the password at the address limit's pace.
    if (path.endsWith("/change-password")) {
      await enforcePeerLimit(request, "auth_change_password_peer", 30, 15 * 60);
      const session = await auth.api.getSession({ headers: request.headers });
      if (!session) return await handlers.POST(request); // Better Auth answers a missing session itself (401)
      const account = await reserveAttempt(session.user.email.trim().toLowerCase());
      let wrongPassword = false;
      try {
        const response = await handlers.POST(request);
        wrongPassword = response.status === 400 && (await response.clone().json().catch(() => null))?.code === "INVALID_PASSWORD";
        return response;
      } finally {
        if (!wrongPassword) await refundRateLimit(account);
      }
    }
    if (!path.endsWith("/sign-in/email")) return await handlers.POST(request);
    await enforcePeerLimit(request, "auth_signin_peer", 30, 15 * 60);
    const account = await reserveAttempt(await signInAccount(request));
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
