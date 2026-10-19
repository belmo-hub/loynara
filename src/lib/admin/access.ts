import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, type JSONWebKeySet } from "jose";
import { DomainError } from "@/lib/loyalty";
export type AccessEnv = { ADMIN_ACCESS_MODE?: string; ADMIN_ACCESS_TEAM_DOMAIN?: string; ADMIN_ACCESS_AUD?: string; ADMIN_ALLOWED_EMAILS?: string; ADMIN_ACCESS_TEST_JWKS?: string };
const remoteKeys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyAccessAssertion(token: string | null, env: AccessEnv = process.env as AccessEnv): Promise<{ email: string }> {
  try {
    if (!token) throw new Error("Missing assertion");
    let issuer: string, audience: string, keys: ReturnType<typeof createLocalJWKSet> | ReturnType<typeof createRemoteJWKSet>;
    if (env.ADMIN_ACCESS_MODE === "local_test" && process.env.NODE_ENV !== "production") {
      issuer = "https://loynara-local-access.invalid"; audience = "loynara-local-admin";
      keys = createLocalJWKSet(JSON.parse(env.ADMIN_ACCESS_TEST_JWKS ?? "") as JSONWebKeySet);
    } else if (env.ADMIN_ACCESS_MODE === "cloudflare" && env.ADMIN_ACCESS_AUD && /^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(env.ADMIN_ACCESS_TEAM_DOMAIN ?? "")) {
      issuer = `https://${env.ADMIN_ACCESS_TEAM_DOMAIN!.toLowerCase()}`; audience = env.ADMIN_ACCESS_AUD;
      if (!remoteKeys.has(issuer)) remoteKeys.set(issuer, createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)));
      keys = remoteKeys.get(issuer)!;
    } else throw new Error("Invalid Access configuration");
    const { payload } = await jwtVerify(token, keys, { issuer, audience, requiredClaims: ["exp", "email"], algorithms: ["RS256", "ES256"] });
    if (typeof payload.email !== "string") throw new Error("Missing email");
    const email = payload.email.toLowerCase();
    const allowed = (env.ADMIN_ALLOWED_EMAILS ?? "").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
    if (!allowed.includes(email)) throw new Error("Email not allowed");
    return { email };
  } catch { throw new DomainError("NOT_FOUND", "Not found"); }
}
