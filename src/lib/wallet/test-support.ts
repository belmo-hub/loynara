/**
 * Test-only helpers for Wallet fixtures. Imported by *.test.ts files only; nothing here is reachable from a route.
 * Every credential is generated fresh in a temporary directory and is never an Apple- or Google-issued credential.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetAppleWalletStatusCache } from "./apple";
import { resetGoogleWalletStatusCache } from "./google";

export type Env = Record<string, string | undefined>;

export function appleFixture() {
  const dir = mkdtempSync(join(tmpdir(), "loynara-apple-fixture-"));
  const cert = join(dir, "cert.pem");
  const key = join(dir, "key.pem");
  const ca = join(dir, "ca.pem");
  // A separate stand-in intermediate like Apple's WWDR: OpenSSL 3.0 (the runtime image) refuses a leaf as its own chain.
  const openssl = (args: string[]) => execFileSync("openssl", args, { cwd: dir, stdio: "ignore" });
  openssl(["req", "-x509", "-newkey", "rsa:2048", "-keyout", "ca-key.pem", "-out", ca, "-days", "1", "-nodes", "-subj", "/CN=fixture-intermediate"]);
  openssl(["req", "-newkey", "rsa:2048", "-keyout", key, "-out", "cert.csr", "-nodes", "-subj", "/CN=fixture-only"]);
  openssl(["x509", "-req", "-in", "cert.csr", "-CA", ca, "-CAkey", "ca-key.pem", "-CAcreateserial", "-out", cert, "-days", "1"]);
  const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "fixture-secret-".padEnd(48, "x"), certPath: cert, keyPath: key, wwdrPath: ca };
  const env: Env = {
    APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: config.passTypeId, APPLE_TEAM_ID: config.teamId, APPLE_SIGNING_CERT_PATH: cert,
    APPLE_SIGNING_KEY_PATH: key, APPLE_WWDR_CERT_PATH: ca, APPLE_WALLET_AUTH_SECRET: config.authSecret, APPLE_WALLET_WEB_SERVICE_URL: config.webServiceUrl,
  };
  return { dir, config, env, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

export function googleFixture(publishing: "demo" | "published" = "published") {
  const dir = mkdtempSync(join(tmpdir(), "loynara-google-fixture-"));
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const file = join(dir, "service-account.json");
  writeFileSync(file, JSON.stringify({ client_email: "issuer@example.test", private_key: privateKey }));
  const env: Env = { GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123456", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: file, GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://assets.example.test/fallback.png", GOOGLE_WALLET_PUBLISHING_STATUS: publishing };
  return { dir, env, privateKey, publicKey, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Sets process.env for the duration of fn (Wallet status caches are reset on entry and exit). */
export async function withEnv<T>(vars: Env, fn: () => Promise<T> | T): Promise<T> {
  const previous = Object.fromEntries(Object.keys(vars).map(name => [name, process.env[name]]));
  for (const [name, value] of Object.entries(vars)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
  resetAppleWalletStatusCache(); resetGoogleWalletStatusCache();
  try { return await fn(); } finally {
    for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    resetAppleWalletStatusCache(); resetGoogleWalletStatusCache();
  }
}

export type GoogleCall = { method: string; url: string; body?: Record<string, unknown> };

/** A stateful stand-in for the Google Wallet REST API. No request leaves the process. */
export function fakeGoogleApi(options: { failWith?: number } = {}) {
  const calls: GoogleCall[] = [];
  const classes = new Map<string, Record<string, unknown>>();
  const objects = new Map<string, Record<string, unknown>>();
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" && (init.headers as Record<string, string> | undefined)?.["Content-Type"] === "application/json" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    if (url === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access-token" });
    if (options.failWith) return new Response(null, { status: options.failWith });
    const match = /\/(loyaltyClass|loyaltyObject)(?:\/([^/?]+))?$/.exec(url);
    if (!match) return new Response(null, { status: 404 });
    const store = match[1] === "loyaltyClass" ? classes : objects;
    const id = match[2] ? decodeURIComponent(match[2]) : undefined;
    if (method === "GET") return id && store.has(id) ? Response.json(store.get(id)) : new Response(null, { status: 404 });
    if (method === "POST") { if (store.has(String(body?.id))) return new Response(null, { status: 409 }); store.set(String(body?.id), body ?? {}); return Response.json(body); }
    if (method === "PATCH") { if (!id || !store.has(id)) return new Response(null, { status: 404 }); store.set(id, { ...store.get(id), ...body }); return Response.json(store.get(id)); }
    if (method === "PUT") { if (!id || !store.has(id)) return new Response(null, { status: 404 }); store.set(id, body ?? {}); return Response.json(body); }
    return new Response(null, { status: 405 });
  };
  return { fetcher, calls, classes, objects };
}
