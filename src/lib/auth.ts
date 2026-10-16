import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) });

export const auth = betterAuth({
  database: pool,
  plugins: [twoFactor({ issuer: "Loynara Admin", backupCodeOptions: { amount: 10 } })],
  // Avoid Better Auth's default X-Forwarded-For trust. Its existing rate/session
  // controls use the same deployment-approved source as our outer peer limits.
  advanced: { ipAddress: { ipAddressHeaders: process.env.TRUSTED_INGRESS === "cloudflare_tunnel" ? ["cf-connecting-ip"] : [] } },
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000", ...(process.env.ADMIN_ORIGIN ? [process.env.ADMIN_ORIGIN] : [])],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path.startsWith("/two-factor/") && (context.body as { trustDevice?: unknown } | undefined)?.trustDevice === true) {
        throw new APIError("FORBIDDEN", { message: "A second factor is required for every sign-in" });
      }
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
