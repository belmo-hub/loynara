import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) });

type AdminSignInLimit = { scope: string; identity: string; max: number; windowSeconds: number };
const adminSignInReservations = new WeakMap<Request, { limits: AdminSignInLimit[]; factor: boolean }>();

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
    after: createAuthMiddleware(async (context) => {
      const response = context.context.returned;
      if (["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(context.path)) {
        const verified = response as { token?: unknown; user?: { id?: unknown } };
        if (!(response instanceof APIError) && typeof verified?.token === "string" && typeof verified.user?.id === "string") {
          await pool.query(`INSERT INTO verification (id, identifier, value, "expiresAt", "createdAt", "updatedAt")
            SELECT 'admin-mfa:' || id, 'admin-mfa:' || id, "userId", "expiresAt", now(), now()
            FROM "session" WHERE token=$1 AND "userId"=$2
            ON CONFLICT(id) DO UPDATE SET "expiresAt"=EXCLUDED."expiresAt", "updatedAt"=now()`, [context.context.newSession?.session.token ?? verified.token, verified.user.id]);
          if (context.path === "/two-factor/verify-totp" && context.context.newSession && context.context.session?.user.twoFactorEnabled === false) {
            await pool.query('DELETE FROM "session" WHERE "userId"=$1 AND id<>$2', [verified.user.id, context.context.newSession.session.id]);
          }
        }
      }
      if (context.request) {
        const reservation = adminSignInReservations.get(context.request);
        if (reservation) {
          adminSignInReservations.delete(context.request);
          if (!(response instanceof APIError) || (response.statusCode !== 401 && !(reservation.factor && response.statusCode === 400))) {
            const { refundRateLimit } = await import("./rate-limit");
            for (const limit of reservation.limits) await refundRateLimit(limit);
          }
        }
      }
    }),
    before: createAuthMiddleware(async (context) => {
      const factorAttempt = ["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(context.path);
      if (context.request && (context.path === "/sign-in/email" || factorAttempt)) {
        let email = (context.body as { email?: unknown } | undefined)?.email;
        let adminAccount = false;
        if (factorAttempt) {
          const session = await auth.api.getSession({ headers: context.headers ?? context.request.headers });
          // Resolve the same signed challenge used by the installed two-factor plugin.
          const challenge = await context.getSignedCookie(context.context.createAuthCookie("two_factor").name, context.context.secret);
          const verification = challenge ? await context.context.internalAdapter.findVerificationValue(challenge) : null;
          const userId = session?.user.id ?? (verification && verification.expiresAt > new Date() ? verification.value : undefined);
          if (userId) {
            const result = await pool.query('SELECT u.email FROM "user" u JOIN platform_admins a ON a.user_id=u.id WHERE u.id=$1 LIMIT 1', [userId]);
            email = result.rows[0]?.email;
            adminAccount = !!result.rowCount;
          }
        } else if (typeof email === "string") {
          const result = await pool.query('SELECT 1 FROM "user" u JOIN platform_admins a ON a.user_id=u.id WHERE lower(u.email)=$1 LIMIT 1', [email.trim().toLowerCase()]);
          adminAccount = !!result.rowCount;
        }
        const configuredHost = process.env.ADMIN_ORIGIN ? new URL(process.env.ADMIN_ORIGIN).host : undefined;
        const requestHost = context.headers?.get("host") ?? new URL(context.request.url).host;
        if (adminAccount || (!factorAttempt && configuredHost && requestHost.toLowerCase() === configuredHost.toLowerCase())) {
          const { enforceRateLimit, refundRateLimit, peerIdentity, RateLimitError } = await import("./rate-limit");
          if (typeof email !== "string" || !email.trim() || email.length > 320) throw new APIError("BAD_REQUEST", { message: "Invalid sign-in request" });
          const limits = [`account:${email.trim().toLowerCase()}`, `ip:${peerIdentity(context.request)}`].map(identity => ({ scope: "admin_signin_failure", identity, max: 5, windowSeconds: 900 }));
          const reserved: AdminSignInLimit[] = [];
          try {
            for (const limit of limits) { await enforceRateLimit(limit); reserved.push(limit); }
          } catch (error) {
            for (const limit of reserved) await refundRateLimit(limit);
            if (error instanceof RateLimitError) throw new APIError("TOO_MANY_REQUESTS", { message: "Too many sign-in attempts" });
            throw error;
          }
          adminSignInReservations.set(context.request, { limits: reserved, factor: factorAttempt });
        }
      }
      if (context.request && context.path.startsWith("/two-factor/") && !["/two-factor/verify-totp", "/two-factor/verify-backup-code"].includes(context.path)) {
        const session = await auth.api.getSession({ headers: context.headers ?? context.request.headers });
        if (session) {
          const admins = await pool.query("SELECT role FROM platform_admins WHERE user_id=$1", [session.user.id]);
          if (admins.rowCount) {
            if (context.path === "/two-factor/disable") throw new APIError("NOT_FOUND", { message: "Not found" });
            const { requireAdmin, requireAdminEnrollment } = await import("./admin/guard");
            try {
              if (context.path === "/two-factor/enable" && !session.user.twoFactorEnabled) await requireAdminEnrollment(context.request);
              else await requireAdmin(context.request, "home.view");
            } catch (error) {
              if ((error as { code?: string }).code === "UNAUTHENTICATED") throw new APIError("UNAUTHORIZED", { message: "Sign in required" });
              throw new APIError("NOT_FOUND", { message: "Not found" });
            }
          }
        }
      }
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
