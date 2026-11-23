import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { passkeyName } from "./passkey-names";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";
import { guardPoolErrors } from "@/db/pool-errors";
import { SIGNUP_ACCEPTANCE_HEADER, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "./owner-contract";

// Separate from the application pool. It needs the same listeners: without them a dropped idle connection ends the
// web process.
export const authPool = guardPoolErrors(new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) }));

export const auth = betterAuth({
  database: authPool,
  // Avoid Better Auth's default X-Forwarded-For trust. Its existing rate/session
  // controls use the same deployment-approved source as our outer peer limits.
  advanced: { ipAddress: { ipAddressHeaders: process.env.TRUSTED_INGRESS === "cloudflare_tunnel" ? ["cf-connecting-ip"] : [] } },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    // ENG-283: sign-up never signs in. Better Auth then answers an existing address like a new one, and leaves it alone.
    autoSignIn: false,
    // ENG-279: self-service reset. Every address gets the same answer. The link lasts an hour, works once, and the reset
    // signs every device out. ENG-286: an unconfirmed account gets the mail too, so the inbox's owner can take back an
    // address someone else registered; using the link proves the inbox, so it also confirms the address.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      // The password is already changed and every device signed out; a failure here leaves the address unconfirmed only.
      await authPool.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [user.id])
        .catch(error => console.error(`Address not confirmed after reset (${error instanceof Error ? error.name : "error"})`));
      // A reset takes the account back (ENG-286), so passkeys added before it go too: someone who held the account must
      // not keep a way in. Not caught: the reset must not look done while an old passkey still works.
      await authPool.query('DELETE FROM "passkey" WHERE "userId" = $1', [user.id]);
    },
    sendResetPassword: async ({ user, token }) => {
      const { sendPasswordReset } = await import("./account-verification");
      // Not awaited: the answer must not take longer for an address that gets a mail than for one that does not.
      void sendPasswordReset(user.email, token)
        .catch(error => console.error(`Password reset email not sent (${error instanceof Error ? error.name : "error"})`));
    },
  },
  // ENG-278: every new account gets a link to confirm its address; owner mail goes only to confirmed addresses. Signing in
  // does not wait for it: an unconfirmed owner sees a notice with a resend button (merchant layout).
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, token }, request) => {
      // Loaded lazily, like the sign-up hook below. A failed send never fails the sign-up: the owner can resend.
      const { sendAccountVerification } = await import("./account-verification");
      const sending = sendAccountVerification(user.email, token).catch(error => {
        console.error(`Verification email not sent (${error instanceof Error ? error.name : "error"})`);
        return "unavailable" as const;
      });
      // Sign-up does not wait for the mail (ENG-283): an existing address gets none, so waiting would show in the timing.
      if (!request?.url.endsWith("/send-verification-email")) return;
      // A signed-in owner pressing „E-Mail erneut senden“ learns that nothing went out (Design). An anonymous resend
      // always answers alike and does not wait for the mail either (ENG-344): only an unconfirmed address gets one, so
      // a slow provider would show in the timing.
      const { auth: self } = await import("./auth");
      if (!await self.api.getSession({ headers: request.headers })) return;
      const outcome = await sending;
      if (outcome === "sent") return;
      throw new APIError(outcome === "limited" ? "TOO_MANY_REQUESTS" : "SERVICE_UNAVAILABLE", { message: "Verification email not sent" });
    },
  },
  // freshAge: adding a passkey needs a sign-in from the last 10 minutes (CTO, 22 Nov), so a stolen session cookie cannot
  // plant a lasting way in. Better Auth checks it only for passkey registration here; the other routes that use it
  // (/list-sessions, /unlink-account) are not used by the app.
  session: { expiresIn: 60 * 60 * 24 * 7, freshAge: 10 * 60 },
  // Optional passkeys next to the password (web audit finding 10): added by a signed-in person in Einstellungen, used
  // from the sign-in form's autofill. The relying party is the app's own host; nothing here changes password sign-in.
  // User verification is required (CTO, 22 Nov): a passkey always asks for Face ID, a fingerprint or the device PIN, so a
  // security key without a PIN cannot sign in with a tap. Adding one needs a signed-in session (pinned by a test).
  plugins: [passkey({
    rpID: new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").hostname,
    rpName: "Loynara",
    authenticatorSelection: { userVerification: "required" },
    // Each passkey is named when it is added: its provider (iCloud-Schlüsselbund, Google Passwortmanager …) from the
    // AAGUID, otherwise the device (Design, #349 round 2), so several passkeys can be told apart.
    registration: {
      requireSession: true,
      afterVerification: ({ ctx, verification }) => ({ name: passkeyName(verification.registrationInfo?.aaguid, ctx.headers?.get("user-agent") ?? undefined) }),
    },
  })],
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (
        context.path === "/sign-up/email" &&
        process.env.PUBLIC_REGISTRATION_ENABLED !== "true"
      ) {
        // Loaded lazily so operator scripts that import this module do not open the application pool.
        const { inviteAllowsSignUp, inviteSignUpEnabled } = await import("./invite-signup");
        const body = context.body as { email?: unknown } | undefined;
        if (inviteSignUpEnabled() && await inviteAllowsSignUp(context.headers?.get("x-loynara-invite"), body?.email)) return;
        throw new APIError("FORBIDDEN", { message: "Registration is not enabled" });
      }
      // ENG-277: a page from before a change of Legal's sentence would be recorded under the new text.
      const shown = context.path === "/sign-up/email" ? context.headers?.get(SIGNUP_ACCEPTANCE_HEADER) : null;
      if (shown && shown !== SIGNUP_ACCEPTANCE_TEXT_VERSION) throw new APIError("BAD_REQUEST", { message: "Acceptance text changed" });
    }),
    after: createAuthMiddleware(async (context) => {
      // ENG-277: the click under Legal's sentence on /register makes the contract; record it once the account exists. Sign-up
      // creates no session (ENG-283), so the id comes from its answer; for an address already taken that answer is made up,
      // and recordOwnerAcceptance writes nothing for an id without a user row.
      const userId = (context.context.returned as { user?: { id?: unknown } } | undefined)?.user?.id;
      if (context.path === "/sign-up/email" && typeof userId === "string" && process.env.PUBLIC_REGISTRATION_ENABLED === "true" && context.headers?.get(SIGNUP_ACCEPTANCE_HEADER)) {
        const { recordOwnerAcceptance } = await import("./owner-acceptance");
        await recordOwnerAcceptance(userId);
      }
    }),
  },
});
