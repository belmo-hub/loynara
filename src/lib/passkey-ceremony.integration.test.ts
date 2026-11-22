// Review of #349 (M-1, F-1): WebAuthn ceremonies against the real auth route with a software authenticator (a P-256
// key made here), so the passkey wiring is pinned in CI: the plugin is there, adding a passkey needs a session, and a
// passkey must verify the user (Face ID, fingerprint or PIN). Adapted from the Reviewer's proof, 22 Nov.
// Better Auth skips its origin checks under a test environment, so both markers are cleared before it loads.
import { createHash, generateKeyPairSync, randomUUID, sign as signData } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

const realEnv = { nodeEnv: process.env.NODE_ENV, test: process.env.TEST, ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
process.env.NODE_ENV = "development"; delete process.env.TEST; process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
const { GET, POST } = await import("@/app/api/auth/[...all]/route");
const { isoBase64URL, isoCBOR } = await import("@simplewebauthn/server/helpers");
const origin = "http://localhost:3000", rpId = "localhost";
let peer = 0;
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE'); await pool.query("DELETE FROM verification"); });
afterAll(async () => {
  process.env.NODE_ENV = realEnv.nodeEnv; if (realEnv.test !== undefined) process.env.TEST = realEnv.test;
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: realEnv.ingress, PUBLIC_REGISTRATION_ENABLED: realEnv.registration })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

const sha = (data: Uint8Array | string) => new Uint8Array(createHash("sha256").update(data).digest());
const b64 = (bytes: Uint8Array) => isoBase64URL.fromBuffer(bytes);
const u32 = (n: number) => new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
const cat = (...parts: Uint8Array[]) => { const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let i = 0; for (const p of parts) { all.set(p, i); i += p.length; } return all; };
const jar = (...responses: Response[]) => responses.flatMap(r => r.headers.getSetCookie()).map(c => c.split(";")[0]).filter(c => !/=$/.test(c)).join("; ");
const headers = (cookie = "") => ({ origin, "content-type": "application/json", "cf-connecting-ip": `198.51.100.${(peer += 1) % 250 + 1}`, ...(cookie ? { cookie } : {}) });
const get = (path: string, cookie = "") => GET(new Request(`${origin}/api/auth${path}`, { headers: headers(cookie) }));
const post = (path: string, body: unknown, cookie = "") => POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: headers(cookie), body: JSON.stringify(body) }));

/** A software authenticator: one P-256 credential, a counter, and switches for the faults to try. */
function authenticator() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
  const credentialId = new Uint8Array(sha(randomUUID()).slice(0, 16));
  const cose = isoCBOR.encode(new Map<number, number | Uint8Array>([[1, 2], [3, -7], [-1, 1], [-2, isoBase64URL.toBuffer(jwk.x)], [-3, isoBase64URL.toBuffer(jwk.y)]]));
  let counter = 0;
  const clientData = (type: string, challenge: string, o = origin) => new TextEncoder().encode(JSON.stringify({ type, challenge, origin: o, crossOrigin: false }));
  return {
    id: b64(credentialId),
    register(challenge: string, flags = 0x45) {
      const authData = cat(sha(rpId), new Uint8Array([flags]), u32(counter), new Uint8Array(16), new Uint8Array([0, credentialId.length]), credentialId, cose);
      const attestationObject = isoCBOR.encode(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
      return { id: b64(credentialId), rawId: b64(credentialId), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: b64(clientData("webauthn.create", challenge)), attestationObject: b64(attestationObject), transports: ["internal"] } };
    },
    assert(challenge: string, f: { origin?: string; rpId?: string; flags?: number; counter?: number } = {}) {
      if (f.counter === undefined) counter += 1;
      const authData = cat(sha(f.rpId ?? rpId), new Uint8Array([f.flags ?? 0x05]), u32(f.counter ?? counter));
      const cdj = clientData("webauthn.get", challenge, f.origin);
      const signature = new Uint8Array(signData("sha256", cat(authData, sha(cdj)), privateKey));
      return { id: b64(credentialId), rawId: b64(credentialId), type: "public-key", clientExtensionResults: {}, authenticatorAttachment: "platform",
        response: { clientDataJSON: b64(cdj), authenticatorData: b64(authData), signature: b64(signature) } };
    },
  };
}

async function account(verified = true) {
  const email = `${randomUUID()}@example.test`, password = "synthetic-passkey-password";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  await post("/sign-up/email", { name: "Synthetic owner", email, password });
  if (verified) await pool.query('UPDATE "user" SET "emailVerified" = true WHERE email = $1', [email]);
  const signIn = await post("/sign-in/email", { email, password });
  const id = (await pool.query('SELECT id FROM "user" WHERE email = $1', [email])).rows[0].id as string;
  return { email, id, cookie: jar(signIn) };
}
async function register(user: { cookie: string }, a = authenticator(), flags?: number) {
  const options = await get("/passkey/generate-register-options", user.cookie);
  if (options.status !== 200) return { status: `options ${options.status}`, a };
  const { challenge } = await options.json() as { challenge: string };
  const verified = await post("/passkey/verify-registration", { response: a.register(challenge, flags) }, `${user.cookie}; ${jar(options)}`);
  return { status: `${verified.status}`, a };
}
async function signInWith(a: ReturnType<typeof authenticator>, faults: Parameters<ReturnType<typeof authenticator>["assert"]>[1] = {}) {
  const options = await get("/passkey/generate-authenticate-options");
  const { challenge } = await options.json() as { challenge: string };
  const challengeCookie = jar(options);
  const response = await post("/passkey/verify-authentication", { response: a.assert(challenge, faults) }, challengeCookie);
  return { status: response.status, session: response.headers.getSetCookie().some(c => c.startsWith("better-auth.session_token=") && !/=;/.test(c)), challengeCookie, challenge };
}

const passkeys = async () => (await pool.query("SELECT count(*)::int AS n FROM passkey")).rows[0].n as number;

describe("passkeys at the auth route", () => {
  it("are wired in: a signed-in person adds one and signs in with it; without a session nothing is offered (M-1)", async () => {
    expect((await get("/passkey/generate-register-options")).status).toBe(401);
    const owner = await account();
    const added = await register(owner);
    expect(added.status).toBe("200");
    expect(await passkeys()).toBe(1);
    expect(await signInWith(added.a)).toMatchObject({ status: 200, session: true });
  });

  it("must verify the user: a key that only shows presence can neither be added nor sign in (F-1)", async () => {
    const owner = await account();
    // Presence and attested data, without the user-verified flag.
    expect((await register(owner, authenticator(), 0x41)).status).not.toBe("200");
    expect(await passkeys()).toBe(0);
    const added = await register(owner);
    expect(added.status).toBe("200");
    const presenceOnly = await signInWith(added.a, { flags: 0x01 });
    expect(presenceOnly.status).not.toBe(200);
    expect(presenceOnly.session).toBe(false);
    expect(await signInWith(added.a)).toMatchObject({ status: 200, session: true });
  });
});
