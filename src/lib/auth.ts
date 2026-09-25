import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export const auth = betterAuth({
  database: pool,
  emailAndPassword: { enabled: true, minPasswordLength: 12 },
  session: { expiresIn: 60 * 60 * 24 * 7 },
  trustedOrigins: [process.env.BETTER_AUTH_URL ?? "http://localhost:3000"],
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (
        context.path === "/sign-up/email" &&
        process.env.PUBLIC_REGISTRATION_ENABLED !== "true"
      ) {
        throw new APIError("FORBIDDEN", { message: "Registration is not enabled" });
      }
    }),
  },
});
