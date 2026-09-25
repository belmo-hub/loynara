import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applePassArchive, applePassJson, applePassToken, appleWalletStatus } from "./apple";
import { GoogleWalletClient, googleClass, googleObject, googleSaveUrl, googleWalletStatus } from "./google";
import { apnsPassUpdateRequest } from "./apple-push";
import type { WalletPassData } from "./types";

const pass: WalletPassData = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  merchantName: "Kasseler Kaffee",
  programName: "Kaffeeclub",
  locationName: "Mitte",
  programType: "stamp",
  balance: 7,
  scanCode: "sc_AbcDef1234567890",
  brandColor: "#264C45",
  country: "DE",
};

describe("wallet pass adapters (fixtures; no provider/device contact)", () => {
  it("does not report Apple as ready when signing inputs are absent", () => {
    const status = appleWalletStatus({ APPLE_WALLET_ENABLED: "true" });
    expect(status.ready).toBe(false);
    expect(status.reason).toContain("APPLE_PASS_TYPE_ID");
  });

  it("rejects a short Apple web-service secret even when all paths are configured", () => {
    const status = appleWalletStatus({ APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.local.loop", APPLE_TEAM_ID: "ABCDE12345", APPLE_SIGNING_CERT_PATH: "/fixture/cert", APPLE_SIGNING_KEY_PATH: "/fixture/key", APPLE_WWDR_CERT_PATH: "/fixture/wwdr", APPLE_WALLET_AUTH_SECRET: "short", APPLE_WALLET_WEB_SERVICE_URL: "https://wallet.example.test/api/apple" });
    expect(status.ready).toBe(false);
    expect(status.reason).toContain("32");
  });

  it("does not report Apple ready when OpenSSL or zip is unavailable at runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "looplocal-bin-check-"));
    const base = { APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.local.loop", APPLE_TEAM_ID: "ABCDE12345", APPLE_SIGNING_CERT_PATH: "/fixture/cert", APPLE_SIGNING_KEY_PATH: "/fixture/key", APPLE_WWDR_CERT_PATH: "/fixture/wwdr", APPLE_WALLET_AUTH_SECRET: "a".repeat(40), APPLE_WALLET_WEB_SERVICE_URL: "https://wallet.example.test/api/apple" };
    try {
      const noTools = appleWalletStatus({ ...base, PATH: join(dir, "empty") });
      expect(noTools.ready).toBe(false);
      expect(noTools.reason).toContain("OpenSSL");
      const openssl = (process.env.PATH ?? "").split(":").map((path) => join(path, "openssl")).find(existsSync);
      if (!openssl) throw new Error("Test environment requires openssl");
      symlinkSync(openssl, join(dir, "openssl"));
      const noZip = appleWalletStatus({ ...base, PATH: dir });
      expect(noZip.ready).toBe(false);
      expect(noZip.reason).toContain("zip");
      expect(noZip.opensslVersion).toMatch(/OpenSSL|LibreSSL/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("keeps the Apple serial and authentication token stable while the displayed balance changes", () => {
    const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple/v1", authSecret: "a".repeat(40) };
    const first = applePassJson(pass, config);
    const updated = applePassJson({ ...pass, balance: 8 }, config);
    expect(first.serialNumber).toBe("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(first.authenticationToken).toBe(updated.authenticationToken);
    expect(first.authenticationToken).not.toContain(pass.scanCode);
    expect(first.storeCard.primaryFields[0].value).toBe(7);
    expect(updated.storeCard.primaryFields[0].value).toBe(8);
    expect(first.barcodes[0].message).toBe(pass.scanCode);
    expect(applePassToken(pass.membershipId, config)).toBe(first.authenticationToken);
  });

  it("requires Google credentials and a public HTTPS logo before offering a save link", () => {
    const status = googleWalletStatus({ GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123456" });
    expect(status.ready).toBe(false);
    expect(status.reason).toContain("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE");
  });

  it("rejects a malformed Google private key before reporting ready", () => {
    const dir = mkdtempSync(join(tmpdir(), "looplocal-google-config-"));
    try {
      const file = join(dir, "service-account.json");
      writeFileSync(file, JSON.stringify({ client_email: "issuer@example.test", private_key: "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----" }));
      const status = googleWalletStatus({ GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123456", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: file, GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://example.test/logo.png" });
      expect(status.ready).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("maps each merchant program to a class and each member to a distinct object with authoritative display balance", () => {
    const config = { issuerId: "123456", logoUrl: "https://example.test/logo.png" };
    const cls = googleClass(pass, config);
    const obj = googleObject(pass, config);
    expect(cls.id).toBe("123456.program_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
    expect(cls.programLogo.sourceUri.uri).toBe(config.logoUrl);
    expect(obj.id).toBe("123456.member_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(obj.classId).toBe(cls.id);
    expect(obj.barcode.value).toBe(pass.scanCode);
    expect(obj.loyaltyPoints.balance.int).toBe(7);
  });

  it("includes only merchant location coordinates in wallet relevance fields when supplied", () => {
    const nearby = { ...pass, latitude: 51.3127, longitude: 9.4797 };
    const apple = applePassJson(nearby, { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "a".repeat(40) });
    const google = googleObject(nearby, { issuerId: "123456", logoUrl: "https://example.test/logo.png" });
    expect(apple.locations).toMatchObject([{ latitude: 51.3127, longitude: 9.4797 }]);
    expect(google.locations).toEqual([{ latitude: 51.3127, longitude: 9.4797 }]);
  });

  it("signs the Google save URL on the server for only the intended object", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const object = googleObject(pass, { issuerId: "123456", logoUrl: "https://example.test/logo.png" });
    const url = googleSaveUrl(object, { clientEmail: "issuer@example.test", privateKey }, 1_800_000_000);
    const jwt = url.split("/save/")[1];
    const [header, payload, signature] = jwt.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString()).alg).toBe("RS256");
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.iss).toBe("issuer@example.test");
    expect(claims.payload.loyaltyObjects).toEqual([object]);
    expect(claims.payload.loyaltyClasses).toBeUndefined();
    expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    expect(createHash("sha256").update(privateKey).digest("hex")).not.toBe(jwt);
  });

  it("packages a signed Apple pass whose manifest hashes match its files", async () => {
    const dir = mkdtempSync(join(tmpdir(), "looplocal-wallet-test-"));
    try {
      const cert = join(dir, "certificate.pem");
      const key = join(dir, "private.pem");
      execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", key, "-out", cert, "-days", "1", "-nodes", "-subj", "/CN=fixture-only"], { stdio: "ignore" });
      const buffer = await applePassArchive(pass, { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple/v1", authSecret: "a".repeat(40), certPath: cert, keyPath: key, wwdrPath: cert });
      const archive = join(dir, "fixture.pkpass");
      const { writeFileSync } = await import("node:fs");
      writeFileSync(archive, buffer);
      const files = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
      expect(files).toEqual(expect.arrayContaining(["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "icon@3x.png"]));
      const manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
      const passJson = execFileSync("unzip", ["-p", archive, "pass.json"]);
      expect(manifest["pass.json"]).toBe(createHash("sha1").update(passJson).digest("hex"));
      expect(JSON.parse(passJson.toString()).storeCard.primaryFields[0].value).toBe(7);
      const signature = join(dir, "signature");
      const manifestFile = join(dir, "manifest.json");
      writeFileSync(signature, execFileSync("unzip", ["-p", archive, "signature"]));
      writeFileSync(manifestFile, execFileSync("unzip", ["-p", archive, "manifest.json"]));
      execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-binary", "-in", signature, "-content", manifestFile, "-noverify", "-out", join(dir, "verified")], { stdio: "ignore" });
      expect(readFileSync(join(dir, "verified"))).toEqual(readFileSync(manifestFile));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("creates missing Google class and object, then patches only balance on repeat", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
    const calls: Array<{ method: string; url: string; body?: Record<string, unknown>; signal?: AbortSignal | null }> = [];
    let existing = false;
    let currentClass: Record<string, unknown> | null = null;
    const fakeFetch: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body = init?.body && typeof init.body === "string" && init.headers && (init.headers as Record<string, string>)["Content-Type"] === "application/json" ? JSON.parse(init.body) : undefined;
      calls.push({ method, url, body, signal: init?.signal });
      if (url.endsWith("/token")) return Response.json({ access_token: "fixture-access-token" });
      if (method === "GET") return existing ? Response.json(url.includes("loyaltyClass/") ? currentClass : {}) : new Response(null, { status: 404 });
      if (method === "POST" && url.endsWith("/loyaltyClass")) currentClass = body ?? null;
      if (method === "POST" && url.endsWith("/loyaltyObject")) existing = true;
      return Response.json({});
    };
    const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey }, fakeFetch);
    const config = { issuerId: "123456", logoUrl: "https://example.test/logo.png" };
    const id = await client.upsert(pass, config);
    expect(id).toBe("123456.member_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(calls.filter((call) => call.method === "POST" && call.url.includes("walletobjects"))).toHaveLength(2);
    await client.upsert({ ...pass, balance: 9, programName: "Kaffeeclub Neu" }, config);
    const classPatch = calls.find((call) => call.method === "PATCH" && call.url.includes("loyaltyClass/"));
    const objectPatch = calls.find((call) => call.method === "PATCH" && call.url.includes("loyaltyObject/"));
    expect(classPatch?.body).toEqual({ programName: "Kaffeeclub Neu" });
    expect(objectPatch?.body).toEqual({ barcode: { type: "QR_CODE", value: pass.scanCode }, loyaltyPoints: { label: "Stempel", balance: { int: 9 } } });
    expect(calls.filter((call) => call.method === "POST" && call.url.includes("walletobjects"))).toHaveLength(2);
    expect(calls.every((call) => call.signal instanceof AbortSignal)).toBe(true);
  });

  it("sends Apple Wallet update pushes as empty, background notifications for the pass topic", () => {
    const request = apnsPassUpdateRequest("pass.local.loop", "a".repeat(64));
    expect(request.headers).toMatchObject({ ":method": "POST", ":path": `/3/device/${"a".repeat(64)}`, "apns-topic": "pass.local.loop", "apns-push-type": "background", "apns-priority": "5" });
    expect(request.body).toBe("{}");
  });
});
