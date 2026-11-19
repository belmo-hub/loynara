import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";
import { guardPoolErrors } from "@/db/pool-errors";

// Separate from the application pool. It needs the same listeners: without them a dropped idle connection ends the
// web process.
export const authPool = guardPoolErrors(new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) }));

export const auth = betterAuth({
  database: authPool,
  // Avoid Better Auth's default X-Forwarded-For trust. Its existing rate/session
  // controls use the same deployment-approved source as our outer peer limits.
  advanced: { ipAddress: { ipAddressHeaders: process.env.TRUSTED_INGRESS === "cloudflare_tunnel" ? ["cf-connecting-ip"] : [] } },
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  // ENG-278: every new account gets a link to confirm its address; owner mail goes only to confirmed addresses. Signing in
  // does not wait for it: an unconfirmed owner sees a notice with a resend button (merchant layout).
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, token }) => {
      // Loaded lazily, like the sign-up hook below. A failed send never fails the sign-up: the owner can resend.
      const { sendAccountVerification } = await import("./account-verification");
      await sendAccountVerification(user.email, token)
        .catch(error => console.error(`Verification email not sent (${error instanceof Error ? error.name : "error"})`));
    },
  },
  session: { expiresIn: 60 * 60 * 24 * 7 },
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
    }),
  },
});
