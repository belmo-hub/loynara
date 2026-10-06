import { createHash, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";
import { applePassArchive, applePassJson, applePassToken, appleVoidedPassJson, appleWalletStatus, validApplePassToken } from "./apple";
import { apnsPassUpdateRequest } from "./apple-push";
import { walletAvailability } from "./capability";
import { passInk, walletProgress } from "./content";
import { GoogleWalletClient, googleClass, googleObject, googleObjectId, googleRevokedObject, googleSaveUrl, googleWalletStatus } from "./google";
import { appleLogoFromData, decodeMerchantLogoPng, merchantGoogleLogoUrl, pngDimensions } from "./logo";
import { appleFixture, fakeGoogleApi, googleFixture } from "./test-support";
import { createDownloadTicket, readDownloadTicket } from "./ticket";
import type { WalletPassData, WalletRevokedData } from "./types";

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
  cardLocator: "K-7QX2MA",
  reward: { title: "Kaffee nach Wahl", cost: 10 },
  brandColor: "#264C45",
  country: "DE",
  locale: "de",
};
const serial = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const revoked: WalletRevokedData = { tenantId: pass.tenantId, programId: pass.programId, merchantName: pass.merchantName, programName: pass.programName, locationName: pass.locationName, brandColor: pass.brandColor, country: "DE", locale: "de", membershipId: pass.membershipId, reason: "reissued" };
const appleConfig = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "a".repeat(40) };
const tinyPng = pngOfSize(1, 1);
function pngChunk(type: string, data: Buffer) {
  const label = Buffer.from(type), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([label, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, label, data, checksum]);
}
function pngOfSize(width: number, height: number, extra = 0) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const bytes = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), pngChunk("IHDR", header),
    ...(extra ? [pngChunk("tEXt", Buffer.concat([Buffer.from("padding\0"), Buffer.alloc(extra, 65)]))] : []),
    pngChunk("IDAT", deflateSync(Buffer.alloc((width * 4 + 1) * height))), pngChunk("IEND", Buffer.alloc(0))]);
  return `data:image/png;base64,${bytes.toString("base64")}`;
}

describe("Apple Wallet configuration status (operator diagnostics)", () => {
  it("rejects a duplicated signer, malformed intermediate and unrelated intermediate", () => {
    const apple = appleFixture();
    const other = appleFixture();
    try {
      const invalid = join(apple.dir, "invalid-wwdr.pem");
      writeFileSync(invalid, "not a certificate");
      for (const wwdr of [apple.config.certPath, invalid, other.config.wwdrPath]) {
        expect(appleWalletStatus({ ...apple.env, APPLE_WWDR_CERT_PATH: wwdr }).ready, wwdr).toBe(false);
      }
    } finally { apple.cleanup(); other.cleanup(); }
  });

  it("refuses certificates before their validity interval and after expiry", () => {
    const apple = appleFixture();
    const now = Date.now();
    try {
      for (const time of [now - 2 * 86_400_000, now + 2 * 86_400_000]) {
        const clock = vi.spyOn(Date, "now").mockReturnValue(time);
        try { expect(appleWalletStatus({ ...apple.env, APPLE_WWDR_CERT_PATH: apple.config.wwdrPath }).ready).toBe(false); }
        finally { clock.mockRestore(); }
      }
    } finally { apple.cleanup(); }
  });

  it("rejects synthetic signing certificates in production despite plausible environment identifiers", () => {
    const apple = appleFixture();
    try {
      expect(appleWalletStatus({ ...apple.env, APPLE_WWDR_CERT_PATH: apple.config.wwdrPath, NODE_ENV: "production", APPLE_PASS_TYPE_ID: "pass.com.getloynara.loyalty" }).ready).toBe(false);
    } finally { apple.cleanup(); }
  });

  it("is not ready without signing inputs and names what is missing only in the operator reason", () => {
    const status = appleWalletStatus({ APPLE_WALLET_ENABLED: "true" });
    expect(status.ready).toBe(false);
    expect(status.reason).toContain("APPLE_PASS_TYPE_ID");
  });

  it("rejects a short web-service secret", () => {
    const status = appleWalletStatus({ APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.local.loop", APPLE_TEAM_ID: "ABCDE12345", APPLE_SIGNING_CERT_PATH: "/fixture/cert", APPLE_SIGNING_KEY_PATH: "/fixture/key", APPLE_WWDR_CERT_PATH: "/fixture/wwdr", APPLE_WALLET_AUTH_SECRET: "short", APPLE_WALLET_WEB_SERVICE_URL: "https://wallet.example.test/api/apple" });
    expect(status.ready).toBe(false);
    expect(status.reason).toContain("32");
  });

  it("is not ready when OpenSSL or zip is missing from the runtime", () => {
    const dir = mkdtempSync(join(tmpdir(), "loynara-bin-check-"));
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
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("is ready with a matching key pair and rejects malformed pass type or team identifiers", () => {
    const apple = appleFixture();
    try {
      expect(appleWalletStatus(apple.env).ready).toBe(true);
      expect(appleWalletStatus({ ...apple.env, APPLE_PASS_TYPE_ID: "loyalty" }).ready).toBe(false);
      expect(appleWalletStatus({ ...apple.env, APPLE_TEAM_ID: "abc" }).ready).toBe(false);
      expect(appleWalletStatus({ ...apple.env, APPLE_WALLET_WEB_SERVICE_URL: "http://wallet.example.test/api/apple" }).ready).toBe(false);
    } finally { apple.cleanup(); }
  });
});

describe("public Wallet availability never leaks diagnostics", () => {
  it("reduces provider status to available / test_only / unavailable", () => {
    const apple = appleFixture();
    const google = googleFixture("demo");
    try {
      expect(walletAvailability({})).toEqual({ apple: "unavailable", google: "unavailable" });
      expect(walletAvailability({ APPLE_WALLET_ENABLED: "true" })).toEqual({ apple: "unavailable", google: "unavailable" });
      const both = walletAvailability({ ...apple.env, ...google.env });
      expect(both).toEqual({ apple: "available", google: "test_only" });
      expect(walletAvailability({ ...google.env, GOOGLE_WALLET_PUBLISHING_STATUS: "published" }).google).toBe("available");
      const text = JSON.stringify([both, walletAvailability({ APPLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ENABLED: "true" })]);
      for (const leak of ["APPLE_", "GOOGLE_", "OpenSSL", "zip", "certificate", "Zertifikat", ".pem", "/", "reason", "expires"]) expect(text).not.toContain(leak);
    } finally { apple.cleanup(); google.cleanup(); }
  });
});

describe("pass content derived from Loynara state", () => {
  it("shows stamp progress, the target reward and the reward-ready state", () => {
    expect(walletProgress(pass)).toEqual({ unit: "Stempel", balanceText: "7 / 10", rewardTitle: "Kaffee nach Wahl", ready: false, statusText: "Noch 3 Stempel" });
    expect(walletProgress({ ...pass, balance: 10 })).toMatchObject({ ready: true, statusText: "An der Kasse einlösen", balanceText: "10 / 10" });
    expect(walletProgress({ ...pass, programType: "points", balance: 120, reward: { title: "Gutschein", cost: 200 } })).toMatchObject({ unit: "Punkte", balanceText: "120", statusText: "Noch 80 Punkte" });
    expect(walletProgress({ ...pass, reward: undefined })).toEqual({ unit: "Stempel", balanceText: "7", ready: false });
    expect(walletProgress({ ...pass, locale: "fr" })).toMatchObject({ unit: "tampons", statusText: "Encore 3 tampons" });
  });

  it("picks readable text like the browser card", () => {
    expect(passInk("#264C45")).toBe("light");
    expect(passInk("#F2D16B")).toBe("dark");
    expect(() => passInk("red")).toThrow();
  });
});

describe("Apple pass", () => {
  it("binds its token to the serial, never to the card link or scan code", () => {
    const token = applePassToken(serial, appleConfig);
    expect(validApplePassToken(serial, token, appleConfig)).toBe(true);
    expect(validApplePassToken("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", token, appleConfig)).toBe(false);
    expect(validApplePassToken(serial, token, { ...appleConfig, passTypeId: "pass.other.loop" })).toBe(false);
    expect(validApplePassToken(serial, `${token}x`, appleConfig)).toBe(false);
    expect(token).not.toContain(pass.scanCode);
    const first = applePassJson(pass, serial, appleConfig);
    const updated = applePassJson({ ...pass, balance: 8 }, serial, appleConfig);
    expect(first.authenticationToken).toBe(updated.authenticationToken);
    expect(first.serialNumber).toBe(serial);
    expect(first.serialNumber).not.toBe(pass.membershipId);
  });

  it("puts merchant first and shows progress, reward, status and the card number with one change message", () => {
    const json = applePassJson(pass, serial, appleConfig);
    expect(json).toMatchObject({ organizationName: "Kasseler Kaffee", logoText: "Kasseler Kaffee", foregroundColor: "rgb(255, 255, 255)", backgroundColor: "rgb(38, 76, 69)", sharingProhibited: true, webServiceURL: appleConfig.webServiceUrl });
    expect(json.storeCard.headerFields).toEqual([{ key: "balance", label: "STEMPEL", value: "7 / 10" }]);
    expect(json.storeCard.primaryFields).toEqual([{ key: "reward", label: "NÄCHSTE PRÄMIE", value: "Kaffee nach Wahl" }]);
    expect(json.storeCard.secondaryFields[0]).toEqual({ key: "status", label: "STATUS", value: "Noch 3 Stempel", changeMessage: "%@" });
    expect(json.storeCard.secondaryFields[1]).toMatchObject({ key: "card", value: "K-7QX2MA" });
    expect(json.barcodes).toEqual([{ format: "PKBarcodeFormatQR", message: pass.scanCode, messageEncoding: "iso-8859-1", altText: "K-7QX2MA" }]);
    expect(JSON.stringify(json)).not.toMatch(/card_[A-Za-z0-9]/); // never the bearer card link
    const ready = applePassJson({ ...pass, balance: 10 }, serial, appleConfig);
    expect(ready.storeCard.primaryFields[0].label).toBe("PRÄMIE BEREIT");
    expect(applePassJson({ ...pass, brandColor: "#F2D16B" }, serial, appleConfig).foregroundColor).toBe("rgb(17, 17, 17)");
    const noReward = applePassJson({ ...pass, reward: undefined }, serial, appleConfig);
    expect(noReward.storeCard.headerFields[0]).toMatchObject({ changeMessage: "%@" });
  });

  it("voids a revoked pass without QR code, balance or card number", () => {
    const json = appleVoidedPassJson(revoked, serial, appleConfig);
    expect(json.voided).toBe(true);
    expect("barcodes" in json).toBe(false);
    const text = JSON.stringify(json);
    expect(text).not.toContain(pass.scanCode);
    expect(text).not.toContain("K-7QX2MA");
    expect(text).toContain("neuer Zugang");
    expect(appleVoidedPassJson({ ...revoked, reason: "closed" }, serial, appleConfig).storeCard.primaryFields[0].value).toBe("Geschlossen");
  });

  it("includes merchant location coordinates only when supplied", () => {
    expect(applePassJson({ ...pass, latitude: 51.3127, longitude: 9.4797 }, serial, appleConfig).locations).toMatchObject([{ latitude: 51.3127, longitude: 9.4797 }]);
    expect("locations" in applePassJson(pass, serial, appleConfig)).toBe(false);
  });

  it("packages a signed archive whose manifest matches every file, including the merchant logo", async () => {
    const apple = appleFixture();
    try {
      const logo = appleLogoFromData(pngOfSize(120, 40));
      expect(logo).toBeDefined();
      const withLogo = { ...pass, appleLogo: logo };
      const buffer = await applePassArchive(applePassJson(withLogo, serial, apple.config), withLogo, apple.config);
      const archive = join(apple.dir, "fixture.pkpass");
      writeFileSync(archive, buffer);
      const files = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
      expect(files).toEqual(expect.arrayContaining(["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png"]));
      const manifest = JSON.parse(execFileSync("unzip", ["-p", archive, "manifest.json"], { encoding: "utf8" }));
      for (const name of files.filter(file => file !== "manifest.json" && file !== "signature")) {
        expect(manifest[name], name).toBe(createHash("sha1").update(execFileSync("unzip", ["-p", archive, name])).digest("hex"));
      }
      const passJson = JSON.parse(execFileSync("unzip", ["-p", archive, "pass.json"], { encoding: "utf8" }));
      expect(passJson.logoText).toBeUndefined(); // a wide wordmark already carries the name
      const signature = join(apple.dir, "signature");
      const manifestFile = join(apple.dir, "manifest.json");
      writeFileSync(signature, execFileSync("unzip", ["-p", archive, "signature"]));
      writeFileSync(manifestFile, execFileSync("unzip", ["-p", archive, "manifest.json"]));
      execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-binary", "-in", signature, "-content", manifestFile, "-CAfile", apple.config.wwdrPath, "-purpose", "any", "-out", join(apple.dir, "verified")], { stdio: "ignore" });
      expect(readFileSync(join(apple.dir, "verified"))).toEqual(readFileSync(manifestFile));
    } finally { apple.cleanup(); }
  });

  it("sends update pushes as empty background notifications for the pass topic", () => {
    const request = apnsPassUpdateRequest("pass.local.loop", "a".repeat(64));
    expect(request.headers).toMatchObject({ ":method": "POST", ":path": `/3/device/${"a".repeat(64)}`, "apns-topic": "pass.local.loop", "apns-push-type": "background", "apns-priority": "5" });
    expect(request.body).toBe("{}");
  });
});

describe("merchant logo handling", () => {
  it("falls back for truncated, checksum-corrupted, invalid image data and decompression bombs", () => {
    const valid = Buffer.from(pngOfSize(32, 32).split(",")[1], "base64");
    const badCrc = Buffer.from(valid); badCrc[29] ^= 1;
    const header = valid.subarray(16, 29);
    const image = (data: Buffer, ihdr = header) => Buffer.concat([valid.subarray(0, 8), pngChunk("IHDR", ihdr), pngChunk("IDAT", data), pngChunk("IEND", Buffer.alloc(0))]);
    const illegalHeader = Buffer.from(header); illegalHeader[8] = 3;
    const hugeHeader = Buffer.from(header); hugeHeader.writeUInt32BE(1_000_000, 0); hugeHeader.writeUInt32BE(1_000_000, 4);
    const env = { GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.example.test" };
    for (const bytes of [valid.subarray(0, 24), valid.subarray(0, -12), badCrc, Buffer.concat([valid, Buffer.from("trailing")]),
      image(Buffer.from("broken zlib")), image(Buffer.concat([deflateSync(Buffer.alloc(32 * 129)), Buffer.from("extra stream data")])),
      image(deflateSync(Buffer.alloc(10_000))), image(deflateSync(Buffer.alloc(32 * 129)), illegalHeader),
      image(deflateSync(Buffer.alloc(32 * 129, 5))),
      image(deflateSync(Buffer.alloc(1_000_000)), hugeHeader)]) {
      const data = `data:image/png;base64,${bytes.toString("base64")}`;
      expect(decodeMerchantLogoPng(data)).toBeNull();
      expect(appleLogoFromData(data)).toBeUndefined();
      expect(merchantGoogleLogoUrl(pass.programId, data, env)).toBeUndefined();
    }
  });

  it("accepts a reasonable PNG for Apple and falls back for anything else", () => {
    expect(pngDimensions(decodeMerchantLogoPng(pngOfSize(320, 100))!)).toEqual({ width: 320, height: 100 });
    expect(appleLogoFromData(pngOfSize(320, 100))).toMatchObject({ width: 320, height: 100 });
    expect(appleLogoFromData(null)).toBeUndefined();
    expect(appleLogoFromData("data:image/jpeg;base64,/9j/4AAQ")).toBeUndefined();
    expect(appleLogoFromData(pngOfSize(4000, 100))).toBeUndefined(); // too wide
    expect(appleLogoFromData(pngOfSize(8, 8))).toBeUndefined(); // too small
    expect(appleLogoFromData(pngOfSize(200, 200, 600_000))).toBeUndefined(); // too heavy
    expect(appleLogoFromData("data:image/png;base64,not-base64!")).toBeUndefined();
  });

  it("derives a versioned merchant PNG URL for Google only with an explicitly enabled HTTPS asset origin", () => {
    const env = { GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.example.test" };
    const url = merchantGoogleLogoUrl(pass.programId, tinyPng, env);
    expect(url).toMatch(new RegExp(`^https://assets\\.example\\.test/api/wallet/assets/google-logo/${pass.programId}\\.png\\?v=[0-9a-f]{16}$`));
    expect(merchantGoogleLogoUrl(pass.programId, tinyPng, { ...env, GOOGLE_WALLET_ASSET_ENABLED: "false" })).toBeUndefined();
    expect(merchantGoogleLogoUrl(pass.programId, tinyPng, { ...env, GOOGLE_WALLET_ASSET_ORIGIN: "http://localhost:3000" })).toBeUndefined();
    expect(merchantGoogleLogoUrl(pass.programId, "data:image/jpeg;base64,YWJj", env)).toBeUndefined();
  });
});

describe("Google Wallet adapter", () => {
  const config = { issuerId: "123456", logoUrl: "https://example.test/logo.png" };

  it("requires credentials and an HTTPS logo before reporting ready", () => {
    expect(googleWalletStatus({ GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123456" }).ready).toBe(false);
    const dir = mkdtempSync(join(tmpdir(), "loynara-google-config-"));
    try {
      const file = join(dir, "service-account.json");
      writeFileSync(file, JSON.stringify({ client_email: "issuer@example.test", private_key: "-----BEGIN PRIVATE KEY-----\nbad\n-----END PRIVATE KEY-----" }));
      expect(googleWalletStatus({ GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "123456", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: file, GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://example.test/logo.png" }).ready).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("maps a programme to one class and each issued pass (credential generation) to its own object", () => {
    const cls = googleClass(pass, config);
    const object = googleObject(pass, serial, config);
    expect(cls).toMatchObject({ id: "123456.program_cccccccc-cccc-4ccc-8ccc-cccccccccccc", issuerName: "Kasseler Kaffee", programName: "Kaffeeclub", hexBackgroundColor: "#264C45", multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES" });
    expect(object.id).toBe(googleObjectId(serial, config));
    expect(object.id).not.toContain(pass.membershipId);
    expect(object).toMatchObject({ classId: cls.id, state: "ACTIVE", accountId: "K-7QX2MA", barcode: { type: "QR_CODE", value: pass.scanCode, alternateText: "K-7QX2MA" }, loyaltyPoints: { label: "Stempel", balance: { string: "7 / 10" } } });
    expect(object.textModulesData[0]).toEqual({ id: "reward", header: "Nächste Prämie", body: "Kaffee nach Wahl · Noch 3 Stempel" });
    expect(googleObject({ ...pass, programType: "points", reward: undefined }, serial, config).loyaltyPoints).toEqual({ label: "Punkte", balance: { int: 7 } });
  });

  it("deactivates a revoked object without barcode, balance or card number", () => {
    const object = googleRevokedObject(revoked, "123456.loynara_old", config);
    expect(object.state).toBe("INACTIVE");
    const text = JSON.stringify(object);
    expect(text).not.toContain("barcode");
    expect(text).not.toContain("loyaltyPoints");
    expect(text).not.toContain("K-7QX2MA");
  });

  it("uses a merchant PNG for the class when approved, the fallback otherwise, and refuses non-HTTPS logos", () => {
    const merchantLogoUrl = "https://assets.example.test/api/wallet/assets/google-logo/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png?v=abc123";
    expect(googleClass({ ...pass, googleLogoUrl: merchantLogoUrl }, config).programLogo.sourceUri.uri).toBe(merchantLogoUrl);
    expect(googleClass(pass, config).programLogo.sourceUri.uri).toBe(config.logoUrl);
    expect(() => googleClass({ ...pass, googleLogoUrl: "http://localhost:3000/logo.png" }, config)).toThrow("HTTPS");
  });

  it("signs a Save link that references the prepared object by id only (no scan code in the URL)", () => {
    const google = googleFixture();
    try {
      const url = googleSaveUrl({ id: googleObjectId(serial, config), classId: "123456.program_x" }, { clientEmail: "issuer@example.test", privateKey: google.privateKey }, ["https://app.example.test"], 1_800_000_000);
      const jwt = url.split("/save/")[1];
      const [header, payload, signature] = jwt.split(".");
      const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
      expect(claims).toMatchObject({ iss: "issuer@example.test", aud: "google", typ: "savetowallet", origins: ["https://app.example.test"] });
      expect(claims.payload).toEqual({ loyaltyObjects: [{ id: googleObjectId(serial, config), classId: "123456.program_x" }] });
      expect(url).not.toContain(pass.scanCode);
      expect(Buffer.from(payload, "base64url").toString()).not.toContain(pass.scanCode);
      expect(verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), google.publicKey, Buffer.from(signature, "base64url"))).toBe(true);
    } finally { google.cleanup(); }
  });

  it("creates class and object once, then overwrites only the displayed state from Loynara", async () => {
    const google = googleFixture();
    try {
      const api = fakeGoogleApi();
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, api.fetcher);
      const created = await client.upsert(pass, serial, config);
      expect(created).toEqual({ id: googleObjectId(serial, config), classId: "123456.program_cccccccc-cccc-4ccc-8ccc-cccccccccccc" });
      expect(api.calls.filter(call => call.method === "POST" && call.url.includes("walletobjects"))).toHaveLength(2);
      await client.upsert({ ...pass, balance: 10, programName: "Kaffeeclub Neu" }, serial, config);
      expect(api.calls.find(call => call.method === "PATCH" && call.url.includes("loyaltyClass/"))?.body).toEqual({ programName: "Kaffeeclub Neu" });
      const objectPatch = api.calls.find(call => call.method === "PATCH" && call.url.includes("loyaltyObject/"));
      expect(objectPatch?.body).toMatchObject({ state: "ACTIVE", loyaltyPoints: { label: "Stempel", balance: { string: "10 / 10" } }, textModulesData: [{ id: "reward", header: "Prämie bereit" }, { id: "note" }] });
      expect(objectPatch?.body).not.toHaveProperty("id");
      expect(api.calls.filter(call => call.url.endsWith("/token"))).toHaveLength(1); // one access token per client
    } finally { google.cleanup(); }
  });

  it("revokes with a full INACTIVE replacement and treats a never-created object as done", async () => {
    const google = googleFixture();
    try {
      const api = fakeGoogleApi();
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, api.fetcher);
      const { id } = await client.upsert(pass, serial, config);
      expect(await client.revoke(revoked, id, config)).toBe("revoked");
      expect(api.objects.get(id)).toMatchObject({ state: "INACTIVE" });
      expect(api.objects.get(id)).not.toHaveProperty("barcode");
      expect(await client.revoke(revoked, "123456.loynara_never", config)).toBe("absent");
    } finally { google.cleanup(); }
  });

  it("raises provider failures without response bodies", async () => {
    const google = googleFixture();
    try {
      const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey: google.privateKey }, fakeGoogleApi({ failWith: 503 }).fetcher);
      await expect(client.upsert(pass, serial, config)).rejects.toMatchObject({ name: "GoogleWalletError", status: 503 });
    } finally { google.cleanup(); }
  });
});

describe("Apple download tickets", () => {
  const env = { BETTER_AUTH_SECRET: "x".repeat(40) };
  it("round-trips for two minutes and names only the pass", () => {
    const now = 1_800_000_000_000;
    const ticket = createDownloadTicket(serial, now, env);
    expect(ticket).not.toContain(pass.scanCode);
    expect(createDownloadTicket(serial, now, env)).not.toBe(ticket); // each issuance is distinct
    expect(readDownloadTicket(ticket, now + 60_000, env)).toEqual({ passId: serial });
    expect(readDownloadTicket(ticket, now + 121_000, env)).toBeNull();
  });

  it("rejects tampering, other keys and malformed input", () => {
    const now = 1_800_000_000_000;
    const ticket = createDownloadTicket(serial, now, env);
    const [body, signature] = ticket.split(".");
    const nonce = Buffer.from(body, "base64url").toString().split(".")[2];
    const forged = Buffer.from(`eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.${Math.floor(now / 1000) + 120}.${nonce}`).toString("base64url");
    expect(readDownloadTicket(`${forged}.${signature}`, now, env)).toBeNull();
    const extended = Buffer.from(`${serial}.${Math.floor(now / 1000) + 99_999}.${nonce}`).toString("base64url");
    expect(readDownloadTicket(`${extended}.${signature}`, now, env)).toBeNull();
    expect(readDownloadTicket(ticket, now, { BETTER_AUTH_SECRET: "y".repeat(40) })).toBeNull();
    expect(readDownloadTicket(`${body}.`, now, env)).toBeNull();
    expect(readDownloadTicket("card_abc", now, env)).toBeNull();
    expect(() => createDownloadTicket("not-a-uuid", now, env)).toThrow();
  });
});
