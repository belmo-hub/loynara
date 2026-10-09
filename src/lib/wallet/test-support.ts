/**
 * Test-only helpers for Wallet fixtures. Imported by *.test.ts files only; nothing here is reachable from a route.
 * Every credential is generated fresh in a temporary directory and is never an Apple- or Google-issued credential.
 */
import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { resetAppleWalletStatusCache } from "./apple";
import { resetGoogleWalletStatusCache } from "./google";
import { googleDirectConfig } from "./google-direct";

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
  writeFileSync(file, JSON.stringify({ type: "service_account", client_email: "wallet-fixture@loynara-synthetic.iam.gserviceaccount.com", private_key: privateKey }), { mode: 0o600 });
  const env: Env = { GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_LOCATION_CLASSES: undefined, GOOGLE_WALLET_ISSUER_ID: "3388000000023201754", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: file, GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://assets.example.test/fallback.png", GOOGLE_WALLET_PUBLISHING_STATUS: publishing };
  return { dir, env, privateKey, publicKey, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** Explicit synthetic scope approval, inside withEnv(googleFixture().env). Never used by application code. */
export function approveSyntheticGoogleScope(merchant: { tenantId: string; locationId: string; programId: string }) {
  const existing = JSON.parse(process.env.GOOGLE_WALLET_LOCATION_CLASSES ?? "[]");
  const binding = { tenantId: merchant.tenantId, locationId: merchant.locationId, programId: merchant.programId,
    classId: `${process.env.GOOGLE_WALLET_ISSUER_ID}.program_${merchant.programId}`, issuanceEnabled: true, testAccountsApproved: true };
  process.env.GOOGLE_WALLET_LOCATION_CLASSES = JSON.stringify([...existing.filter((row: { programId: string }) => row.programId !== merchant.programId), binding]);
  return googleDirectConfig(process.env, merchant.tenantId, merchant.locationId, merchant.programId);
}

/** Historical managed Google rows keep lifecycle coverage after new issuance moved to Direct. Disposable DB only. */
export async function seedHistoricalManagedGoogle(cardToken: string) {
  if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Historical fixture requires disposable database");
  const [{ db }, { memberships, walletPasses }, { and, eq, isNull }, { randomUUID }, { credentialHash, walletCardSnapshot }, { passFastConfig, bindPassFastObjectId }, { enqueueWalletRefresh }] = await Promise.all([
    import("@/db"), import("@/db/schema"), import("drizzle-orm"), import("node:crypto"), import("./data"), import("./passfast"), import("./enqueue"),
  ]);
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member || member.closedAt) throw new Error("Historical fixture card unavailable");
    const snapshot = await walletCardSnapshot(member.id, tx);
    if (!snapshot.open) throw new Error("Historical fixture card unavailable");
    const config = passFastConfig(process.env, member.tenantId, snapshot.pass.locationId);
    const [existing] = await tx.select().from(walletPasses).where(and(eq(walletPasses.membershipId, member.id), eq(walletPasses.provider, "google"), isNull(walletPasses.revokedAt)));
    if (existing) return existing;
    const id = randomUUID();
    const [sibling] = await tx.select().from(walletPasses).where(and(eq(walletPasses.membershipId, member.id), isNull(walletPasses.revokedAt)));
    const [row] = await tx.insert(walletPasses).values({ id, tenantId: member.tenantId, membershipId: member.id, provider: "google", providerObjectId: sibling?.providerObjectId ?? bindPassFastObjectId(id, config), credentialHash: credentialHash(member.scanCode), status: "pending" }).returning();
    await enqueueWalletRefresh(tx, member.tenantId, member.id);
    return row;
  });
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

/** Unsigned synthetic ZIP for provider-response tests; never represents physical-device acceptance. */
export function syntheticPassFastArchive(pass: Record<string, unknown>, compressed = false): Buffer {
  const name=Buffer.from("pass.json"), plain=Buffer.from(JSON.stringify(pass));
  const body=compressed?deflateRawSync(plain):plain;
  let checksum=0xffffffff;
  for(const byte of plain){checksum^=byte;for(let bit=0;bit<8;bit++)checksum=(checksum>>>1)^(checksum&1?0xedb88320:0);}
  checksum=(checksum^0xffffffff)>>>0;
  const local=Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20,4);
  local.writeUInt32LE(checksum,14); local.writeUInt16LE(compressed?8:0,8); local.writeUInt32LE(body.length,18); local.writeUInt32LE(plain.length,22); local.writeUInt16LE(name.length,26);
  const central=Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(20,4); central.writeUInt16LE(20,6);
  central.writeUInt32LE(checksum,16); central.writeUInt16LE(compressed?8:0,10); central.writeUInt32LE(body.length,20); central.writeUInt32LE(plain.length,24); central.writeUInt16LE(name.length,28);
  const end=Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1,8); end.writeUInt16LE(1,10);
  end.writeUInt32LE(central.length+name.length,12); end.writeUInt32LE(local.length+name.length+body.length,16);
  return Buffer.concat([local,name,body,central,name,end]);
}
