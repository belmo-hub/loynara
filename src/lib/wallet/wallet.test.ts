import { createHash, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import { applePassArchive, applePassJson, applePassToken, appleVoidedPassJson, appleWalletStatus, validApplePassToken } from "./apple";
import { iconPng, stripPng } from "./apple-images";
import { apnsPassUpdateRequest } from "./apple-push";
import { walletAvailability } from "./capability";
import { passInk, walletProgress } from "./content";
import { GoogleWalletClient, googleClass, googleObject, googleObjectId, googleRevokedObject, googleSaveUrl, googleWalletStatus } from "./google";
import { appleLogoFromData, googleLogoAsset, merchantGoogleLogoUrls } from "./logo";
import { initialLogo } from "./logo-initial";
import { appleFixture, fakeGoogleApi, googleFixture, withEnv } from "./test-support";
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
const fakeLogo = { png1x: Buffer.alloc(1), png2x: Buffer.alloc(1), png3x: Buffer.alloc(1), width: 160, height: 50 };
const svgLogo = async (width: number, height: number, body: string) => `data:image/png;base64,${(await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`)).png().toBuffer()).toString("base64")}`;
// A white wordmark (three blocks with gaps) on transparent: wide, so the pass shows no name beside it.
const wordmark = () => svgLogo(360, 120, `<g fill="#fff"><rect width="100" height="120"/><rect x="130" y="30" width="100" height="90"/><rect x="260" width="100" height="60"/></g>`);
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

  it("serves per-location copies of the environment from the status cache, but never a copy with other Apple inputs", async () => {
    const apple = appleFixture();
    try {
      await withEnv(apple.env, () => {
        expect(appleWalletStatus({ ...process.env, PASSFAST_TENANT_TEMPLATES: "[]" }).ready).toBe(true);
        rmSync(apple.config.keyPath);
        // The file is gone, yet the copy hits the five-minute cache the way process.env does: no openssl/zip per request.
        expect(appleWalletStatus({ ...process.env, PASSFAST_TENANT_TEMPLATES: "[]" }).ready).toBe(true);
        expect(appleWalletStatus({ ...process.env, APPLE_TEAM_ID: "abc" }).ready).toBe(false);
        expect(appleWalletStatus({ ...process.env, APPLE_SIGNING_KEY_PATH: `${apple.config.keyPath}.other` }).ready).toBe(false);
      });
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
      expect(both).toEqual({ apple: "available", google: "unavailable" });
      expect(walletAvailability({ ...google.env, GOOGLE_WALLET_PUBLISHING_STATUS: "published" }).google).toBe("unavailable");
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

  it("counts the last point or stamp in the singular, the field label stays plural (ENG-108)", () => {
    const points = (balance: number, locale: "de" | "fr" = "de") => walletProgress({ ...pass, locale, programType: "points", balance, reward: { title: "Gutschein", cost: 200 } });
    expect(points(199)).toMatchObject({ unit: "Punkte", statusText: "Noch 1 Punkt" });
    expect(points(198)).toMatchObject({ statusText: "Noch 2 Punkte" });
    expect(points(199, "fr")).toMatchObject({ unit: "points", statusText: "Encore 1 point" });
    expect(points(198, "fr")).toMatchObject({ statusText: "Encore 2 points" });
    expect(walletProgress({ ...pass, balance: 9 })).toMatchObject({ statusText: "Noch 1 Stempel" });
    expect(walletProgress({ ...pass, locale: "fr", balance: 9 })).toMatchObject({ unit: "tampons", statusText: "Encore 1 tampon" });
    expect(walletProgress({ ...pass, locale: "fr", balance: 8 })).toMatchObject({ statusText: "Encore 2 tampons" });
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

  it("puts merchant first, the balance in the header and the card number under the QR code", () => {
    const json = applePassJson(pass, serial, appleConfig);
    expect(json).toMatchObject({ organizationName: "Kasseler Kaffee", logoText: "Kasseler Kaffee", foregroundColor: "rgb(255, 255, 255)", backgroundColor: "rgb(38, 76, 69)", sharingProhibited: true, webServiceURL: appleConfig.webServiceUrl });
    expect(json.barcodes).toEqual([{ format: "PKBarcodeFormatQR", message: pass.scanCode, messageEncoding: "iso-8859-1", altText: "K-7QX2MA" }]);
    expect(JSON.stringify(json)).not.toMatch(/card_[A-Za-z0-9]/); // never the bearer card link
    expect(applePassJson({ ...pass, brandColor: "#F2D16B" }, serial, appleConfig).foregroundColor).toBe("rgb(17, 17, 17)");
  });

  it("shows the spec's cases A–E: no primary or auxiliary field, the reward left and what is left right (ENG-119)", () => {
    const front = (data: Partial<WalletPassData>) => applePassJson({ ...pass, ...data }, serial, appleConfig);
    const a = front({ balance: 3, brandColor: "#8A3B2E", reward: { title: "Gratiskaffee", cost: 10 } });
    expect(a).toMatchObject({ logoText: "Kasseler Kaffee", foregroundColor: "rgb(255, 255, 255)" });
    expect(Object.keys(a.storeCard)).toEqual(["headerFields", "secondaryFields", "backFields"]);
    expect(a.storeCard.headerFields).toEqual([{ key: "balance", label: "STEMPEL", value: "3 / 10" }]);
    expect(a.storeCard.secondaryFields).toEqual([
      { key: "reward", label: "NÄCHSTE PRÄMIE", value: "Gratiskaffee" },
      { key: "status", label: "NOCH", value: "7 Stempel", changeMessage: "Noch %@", textAlignment: "PKTextAlignmentRight" },
    ]);
    const b = front({ balance: 8, brandColor: "#F2C14E", appleLogo: { ...fakeLogo, showName: false }, reward: { title: "Kugel gratis", cost: 8 } });
    expect(b).toMatchObject({ foregroundColor: "rgb(17, 17, 17)" });
    expect(b).not.toHaveProperty("logoText"); // a wordmark already carries the name
    expect(b.storeCard.headerFields[0].value).toBe("8 / 8");
    expect(b.storeCard.secondaryFields).toEqual([
      { key: "reward", label: "PRÄMIE BEREIT", value: "Kugel gratis" },
      { key: "status", label: "EINLÖSEN", value: "an der Kasse", changeMessage: "Deine Prämie ist bereit. Du kannst sie %@ einlösen.", textAlignment: "PKTextAlignmentRight" },
    ]);
    expect(front({ balance: 9, reward: { title: "Kuchenstück gratis", cost: 14 } }).storeCard.secondaryFields[1].value).toBe("5 Stempel");
    const d = front({ programType: "points", balance: 21, brandColor: "#2C4A7A", appleLogo: { ...fakeLogo, width: 50, showName: true }, reward: { title: "Haarwäsche gratis", cost: 100 } });
    expect(d).toMatchObject({ logoText: "Kasseler Kaffee" });
    expect(d.storeCard.headerFields).toEqual([{ key: "balance", label: "PUNKTE", value: "21" }]);
    expect(d.storeCard.secondaryFields[1]).toMatchObject({ label: "NOCH", value: "79 Punkte" });
    expect(front({ programType: "points", balance: 99, reward: { title: "Haarwäsche gratis", cost: 100 } }).storeCard.secondaryFields[1].value).toBe("1 Punkt");
    const e = front({ programType: "points", balance: 312, brandColor: "#F3D9DD", reward: { title: "Antipasti-Teller", cost: 300 } });
    expect(e.storeCard.headerFields[0].value).toBe("312");
    expect(e.storeCard.secondaryFields.map(field => [field.label, field.value])).toEqual([["PRÄMIE BEREIT", "Antipasti-Teller"], ["EINLÖSEN", "an der Kasse"]]);
  });

  it("keeps one key on the right-hand field, so Wallet alerts when the reward turns ready and again after redeeming", () => {
    const status = (balance: number) => applePassJson({ ...pass, balance }, serial, appleConfig).storeCard.secondaryFields.find(field => field.key === "status");
    expect(status(9)).toMatchObject({ value: "1 Stempel", changeMessage: "Noch %@" });
    expect(status(10)).toMatchObject({ value: "an der Kasse", changeMessage: "Deine Prämie ist bereit. Du kannst sie %@ einlösen." });
    expect(status(0)).toMatchObject({ value: "10 Stempel", changeMessage: "Noch %@" });
    expect(applePassJson(pass, serial, appleConfig).storeCard.headerFields[0]).not.toHaveProperty("changeMessage"); // one alert per update
  });

  it("shows the programme and announces the balance when no reward is set up", () => {
    const json = applePassJson({ ...pass, reward: undefined }, serial, appleConfig);
    expect(json.storeCard.headerFields).toEqual([{ key: "balance", label: "STEMPEL", value: "7", changeMessage: "Dein Stand: %@" }]);
    expect(json.storeCard.secondaryFields).toEqual([{ key: "programName", label: "PROGRAMM", value: "Kaffeeclub" }]);
    expect(json.storeCard.backFields.map(field => field.key)).not.toContain("rewardTitle");
  });

  it("puts the rules first on the back, then the full reward name, programme, location, card, update and note", () => {
    const rules = ["Ein Stempel pro Heißgetränk.", "Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben."];
    const long = "Gratisgetränk 0,3 l, nur Mo–Fr außer Feiertage";
    const json = applePassJson({ ...pass, rules, reward: { title: long, cost: 10 }, lastActivityAt: new Date("2026-10-28T11:39:00Z") }, serial, appleConfig);
    expect(json.storeCard.backFields.map(field => [field.key, field.label])).toEqual([["rules", "Programmregeln"], ["rewardTitle", "Nächste Prämie"], ["programme", "Programm"], ["location", "Standort"], ["card", "Karte"], ["updated", "Zuletzt aktualisiert"], ["note", "Hinweis"]]);
    expect(json.storeCard.backFields.slice(0, 5).map(field => field.value)).toEqual([rules.join("\n\n"), long, "Kaffeeclub", "Mitte", "K-7QX2MA"]);
    expect(applePassJson({ ...pass, balance: 10 }, serial, appleConfig).storeCard.backFields.find(field => field.key === "rewardTitle")?.label).toBe("Prämie bereit");
    const keys = [...json.storeCard.headerFields, ...json.storeCard.secondaryFields, ...json.storeCard.backFields].map(field => field.key);
    expect(new Set(keys).size).toBe(keys.length); // Wallet needs every field key unique across the pass
  });

  it("turns data detectors off on the rules and the reward name, so „0,3 l“ is no unit and no owner text becomes a link", () => {
    const json = applePassJson({ ...pass, rules: ["Ein Stempel pro Pizza ab 8 €."], reward: { title: "Gratisgetränk 0,3 l, nur Mo–Fr außer Feiertage", cost: 10 } }, serial, appleConfig);
    const back = Object.fromEntries(json.storeCard.backFields.map(field => [field.key, field]));
    expect(back.rules).toMatchObject({ dataDetectorTypes: [] });
    expect(back.rewardTitle).toMatchObject({ dataDetectorTypes: [] });
    expect(back.note).not.toHaveProperty("dataDetectorTypes"); // the rest keeps Wallet's defaults
  });

  it("lists what each reward costs right after the reward name, in the merchant's order (ENG-116)", () => {
    const rewards = [{ title: "Gratiskaffee", cost: 100 }, { title: "Frühstück", cost: 1 }, { title: "Torte", cost: 200 }];
    const back = applePassJson({ ...pass, programType: "points", reward: rewards[0], rewards }, serial, appleConfig).storeCard.backFields;
    expect(back.map(field => field.key).slice(0, 3)).toEqual(["rewardTitle", "rewards", "programme"]);
    expect(back[1]).toEqual({ key: "rewards", label: "Prämien", value: "100 Punkte – Gratiskaffee\n1 Punkt – Frühstück\n200 Punkte – Torte", dataDetectorTypes: [] });
    const stamps = applePassJson({ ...pass, rewards: [{ title: "Gratiskaffee", cost: 10 }, { title: "Brötchen", cost: 1 }] }, serial, appleConfig).storeCard.backFields;
    expect(stamps.find(field => field.key === "rewards")?.value).toBe("10 Stempel – Gratiskaffee\n1 Stempel – Brötchen");
    // No approved French label yet: French passes keep their back as it is.
    expect(applePassJson({ ...pass, locale: "fr", rewards }, serial, appleConfig).storeCard.backFields.map(field => field.key)).not.toContain("rewards");
  });

  it("puts the owner's message after the rules and the reward on the back, with a lock-screen changeMessage, leaving the front as it was (ENG-127)", () => {
    const text = "Heute ruhig: Kaffee zum halben Preis bis 17 Uhr.";
    const rules = ["Ein Stempel pro Kaffee."];
    const json = applePassJson({ ...pass, rules, message: text, messageDay: "28.10." }, serial, appleConfig);
    expect(json.storeCard.backFields.map(field => field.key).slice(0, 3)).toEqual(["rules", "rewardTitle", "message"]);
    expect(json.storeCard.backFields[2]).toEqual({ key: "message", label: "Nachricht von Kasseler Kaffee vom 28.10.", value: text, changeMessage: "%@", dataDetectorTypes: [] });
    const plain = applePassJson({ ...pass, rules }, serial, appleConfig);
    expect(plain.storeCard.backFields.map(field => field.key)).not.toContain("message");
    expect({ ...json.storeCard, backFields: json.storeCard.backFields.filter(field => field.key !== "message") }).toEqual(plain.storeCard);
    // Consent without a message yet: the key exists with a placeholder, so Wallet alerts when the first message changes it.
    expect(applePassJson({ ...pass, message: "" }, serial, appleConfig).storeCard.backFields.find(field => field.key === "message")).toMatchObject({ key: "message", label: "Nachricht von Kasseler Kaffee", value: "Noch keine Nachricht." });
    expect(applePassJson({ ...pass, locale: "fr", message: text }, serial, appleConfig).storeCard.backFields.map(field => field.key)).not.toContain("message");
  });

  it("keeps today's approved French status line while the new strings are German only (founder, 28 Oct)", () => {
    const card = (data: Partial<WalletPassData>) => applePassJson({ ...pass, locale: "fr", ...data }, serial, appleConfig).storeCard;
    expect(card({}).secondaryFields[1]).toEqual({ key: "status", label: "STATUT", value: "Encore 3 tampons", changeMessage: "%@", textAlignment: "PKTextAlignmentRight" });
    expect(card({ balance: 10 }).secondaryFields[1]).toMatchObject({ key: "status", label: "STATUT", value: "À utiliser en caisse", changeMessage: "%@" });
    expect(card({ reward: undefined }).headerFields[0]).toMatchObject({ changeMessage: "%@" });
    expect(card({ rules: ["Un tampon par visite."] }).backFields[0]).toMatchObject({ key: "rules", label: "Règles du programme" });
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

  it("includes the shop pin with the lock-screen line only when coordinates are supplied", () => {
    expect(applePassJson({ ...pass, latitude: 51.3127, longitude: 9.4797 }, serial, appleConfig).locations).toEqual([{ latitude: 51.3127, longitude: 9.4797, relevantText: "Kasseler Kaffee: deine Karte" }]);
    expect(applePassJson({ ...pass, locale: "fr", latitude: 51.3127, longitude: 9.4797 }, serial, appleConfig).locations?.[0].relevantText).toBe("Kasseler Kaffee\u00a0: votre carte");
    expect("locations" in applePassJson(pass, serial, appleConfig)).toBe(false);
  });

  it("packages a signed archive whose manifest matches every file, including the merchant logo", async () => {
    const apple = appleFixture();
    try {
      const logo = await appleLogoFromData(await wordmark(), pass.brandColor);
      expect(logo).toBeDefined();
      expect(new Set([logo!.png1x, logo!.png2x, logo!.png3x].map(png => png.toString("base64"))).size).toBe(3);
      const withLogo = { ...pass, appleLogo: logo };
      const buffer = await applePassArchive(applePassJson(withLogo, serial, apple.config), withLogo, apple.config);
      const archive = join(apple.dir, "fixture.pkpass");
      writeFileSync(archive, buffer);
      const files = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8" }).trim().split("\n");
      expect(files).toEqual(expect.arrayContaining(["pass.json", "manifest.json", "signature", "icon.png", "icon@2x.png", "icon@3x.png", "logo.png", "logo@2x.png", "logo@3x.png", "strip.png", "strip@2x.png", "strip@3x.png"]));
      expect(execFileSync("unzip", ["-p", archive, "strip@3x.png"])).toEqual(stripPng("stamp", 7, [10], 3));
      expect(execFileSync("unzip", ["-p", archive, "icon@3x.png"])).toEqual(iconPng(3, pass.brandColor));
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

  it("takes the pass icon from a square logo and keeps the stamp disc for a wide one (ENG-134)", async () => {
    const apple = appleFixture();
    try {
      const icon = async (logoData: string) => {
        const logo = await appleLogoFromData(logoData, pass.brandColor);
        const withLogo = { ...pass, appleLogo: logo };
        writeFileSync(join(apple.dir, "icon.pkpass"), await applePassArchive(applePassJson(withLogo, serial, apple.config), withLogo, apple.config));
        return { logo, icon3x: execFileSync("unzip", ["-p", join(apple.dir, "icon.pkpass"), "icon@3x.png"]) };
      };
      const square = await icon(await svgLogo(400, 400, `<rect width="400" height="400" fill="#B3261E"/><rect x="80" y="160" width="240" height="80" fill="#fff"/>`));
      expect(square.icon3x).toEqual(square.logo!.icon![2]);
      expect((await icon(await wordmark())).icon3x).toEqual(iconPng(3, pass.brandColor));
    } finally { apple.cleanup(); }
  });

  it("adds no strip without a target reward, nor to a voided pass", async () => {
    const apple = appleFixture();
    try {
      const files = async (json: Parameters<typeof applePassArchive>[0], data: Parameters<typeof applePassArchive>[1]) => {
        writeFileSync(join(apple.dir, "fixture.pkpass"), await applePassArchive(json, data, apple.config));
        return execFileSync("unzip", ["-Z1", join(apple.dir, "fixture.pkpass")], { encoding: "utf8" }).trim().split("\n");
      };
      const noReward = { ...pass, reward: undefined };
      for (const names of [await files(applePassJson(noReward, serial, apple.config), noReward), await files(appleVoidedPassJson(revoked, serial, apple.config), revoked)]) {
        expect(names).toContain("icon@3x.png");
        expect(names.filter(name => name.startsWith("strip"))).toEqual([]);
      }
    } finally { apple.cleanup(); }
  });

  it("sends update pushes as empty background notifications for the pass topic", () => {
    const request = apnsPassUpdateRequest("pass.local.loop", "a".repeat(64));
    expect(request.headers).toMatchObject({ ":method": "POST", ":path": `/3/device/${"a".repeat(64)}`, "apns-topic": "pass.local.loop", "apns-push-type": "background", "apns-priority": "5" });
    expect(request.body).toBe("{}");
  });
});

describe("merchant logo handling", () => {
  it("gives Google no merchant logo for truncated, checksum-corrupted, invalid image data and decompression bombs", async () => {
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
      expect(await merchantGoogleLogoUrls(pass.programId, data, pass.brandColor, pass.merchantName, env)).toEqual({});
    }
  });

  it("gives Apple every readable logo in its own shape and leaves out a missing, unreadable or faint one (ENG-134)", async () => {
    expect(await appleLogoFromData(await wordmark(), pass.brandColor)).toMatchObject({ width: 150, height: 50, showName: false });
    const square = await svgLogo(400, 400, `<rect width="400" height="400" fill="#B3261E"/><rect x="80" y="160" width="240" height="80" fill="#fff"/>`);
    const jpeg = `data:image/jpeg;base64,${(await sharp(Buffer.from(square.split(",")[1], "base64")).jpeg().toBuffer()).toString("base64")}`;
    expect(await appleLogoFromData(jpeg, pass.brandColor)).toMatchObject({ width: 50, height: 50, showName: true, icon: expect.any(Array) });
    expect(await appleLogoFromData(null, pass.brandColor)).toBeUndefined();
    expect(await appleLogoFromData("data:image/jpeg;base64,/9j/4AAQ", pass.brandColor)).toBeUndefined();
    expect(await appleLogoFromData(pngOfSize(8, 8), pass.brandColor)).toBeUndefined(); // too small
    expect(await appleLogoFromData("data:image/png;base64,not-base64!", pass.brandColor)).toBeUndefined();
    const dark = (await wordmark()).replace(/^data:image\/png;base64,/, "");
    const darkLogo = `data:image/png;base64,${(await sharp(Buffer.from(dark, "base64")).negate({ alpha: false }).png().toBuffer()).toString("base64")}`;
    expect(await appleLogoFromData(darkLogo, "#1F4D3A")).toBeUndefined(); // too faint on Waldgrün: the pass shows the name instead
  });

  it("gives Google a versioned URL per asset only with an explicitly enabled HTTPS asset origin (ENG-153)", async () => {
    const env = { GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.example.test" };
    const urls = (logo: string, color = pass.brandColor, e: Record<string, string> = env) => merchantGoogleLogoUrls(pass.programId, logo, color, pass.merchantName, e);
    const route = (name: string) => new RegExp(`^https://assets\\.example\\.test/api/wallet/assets/${name}/${pass.programId}\\.png\\?v=[0-9a-f]{16}$`);
    const square = await svgLogo(400, 400, `<circle cx="200" cy="200" r="180" fill="#fff"/>`);
    expect(Object.keys(await urls(square))).toEqual(["googleLogoUrl"]);
    expect((await urls(square)).googleLogoUrl).toMatch(route("google-logo"));
    const wide = await urls(await wordmark());
    expect(wide.googleLogoUrl).toMatch(route("google-logo"));
    expect(wide.googleWideLogoUrl).toMatch(route("google-wide-logo"));
    expect(new URL(wide.googleWideLogoUrl!).search).not.toBe(new URL(wide.googleLogoUrl!).search);
    // The initial is drawn on the brand colour, so a new colour is a new revision.
    expect((await urls(await wordmark(), "#B3261E")).googleLogoUrl).not.toBe(wide.googleLogoUrl);
    expect(await urls(square, pass.brandColor, { ...env, GOOGLE_WALLET_ASSET_ENABLED: "false" })).toEqual({});
    expect(await urls(square, pass.brandColor, { ...env, GOOGLE_WALLET_ASSET_ORIGIN: "http://localhost:3000" })).toEqual({});
    expect(await urls("data:image/jpeg;base64,YWJj")).toEqual({});
  });

  it("never squeezes a wide logo into Google's circle and drops a faint one for the initial, like Apple (ENG-153)", async () => {
    const size = async (bytes?: Buffer) => { const { width, height } = await sharp(bytes!).metadata(); return [width, height]; };
    const logo = await wordmark();
    const circle = await googleLogoAsset("square", logo, pass.brandColor, pass.merchantName);
    expect(circle).toEqual(await initialLogo(pass.merchantName, pass.brandColor));
    expect(await googleLogoAsset("square", logo, pass.brandColor, pass.merchantName)).toBe(circle); // drawn once, then remembered
    expect(await size(circle)).toEqual([660, 660]);
    expect(await size(await googleLogoAsset("wide", logo, pass.brandColor, pass.merchantName))).toEqual([1280, 400]);
    const dark = (await wordmark()).replace(/^data:image\/png;base64,/, "");
    const darkLogo = `data:image/png;base64,${(await sharp(Buffer.from(dark, "base64")).negate({ alpha: false }).png().toBuffer()).toString("base64")}`;
    expect(await googleLogoAsset("wide", darkLogo, "#1F4D3A", pass.merchantName)).toBeUndefined();
    expect(await googleLogoAsset("square", darkLogo, "#1F4D3A", pass.merchantName)).toEqual(await initialLogo(pass.merchantName, "#1F4D3A"));
    const square = await svgLogo(400, 400, `<circle cx="200" cy="200" r="180" fill="#fff"/>`);
    expect(await googleLogoAsset("wide", square, pass.brandColor, pass.merchantName)).toBeUndefined();
    expect(await googleLogoAsset("square", null, pass.brandColor, pass.merchantName)).toBeUndefined();
  });

  it("draws the shop's initial in the pass ink on the brand colour, accents folded, without any font installed (ENG-153)", async () => {
    const inked = async (name: string, color: string) => {
      const { data } = await sharp(await initialLogo(name, color)).raw().toBuffer({ resolveWithObject: true });
      let count = 0;
      for (let i = 0; i < data.length; i += 4) if (Math.abs(data[i] - parseInt(color.slice(1, 3), 16)) > 100) count++;
      return count;
    };
    expect(await inked("Kasseler Kaffee", "#264C45")).toBeGreaterThan(10_000);
    expect(await inked("éclair", "#264C45")).toBe(await inked("Eis", "#264C45"));
    expect(await inked("Ömer", "#264C45")).not.toBe(await inked("O", "#264C45"));
    expect(await inked("★ Shop", "#264C45")).toBe(0);
    expect((await sharp(await initialLogo("Kasseler Kaffee", "#264C45")).stats()).channels[0].max).toBe(255); // white on dark
    expect((await sharp(await initialLogo("Kasseler Kaffee", "#F2E9DC")).stats()).channels[0].min).toBeLessThan(30); // dark on light
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

  it("puts the shop pin on the class as merchantLocations, the field Google's nearby notification reads", () => {
    const located = { ...pass, latitude: 51.3127, longitude: 9.4797 };
    expect(googleClass(located, config)).toMatchObject({ merchantLocations: [{ latitude: 51.3127, longitude: 9.4797 }] });
    expect("locations" in googleClass(located, config)).toBe(false);
    expect("merchantLocations" in googleClass(pass, config)).toBe(false);
    expect(JSON.stringify(googleObject(located, serial, config))).not.toContain("51.3127");
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

  it("sets wideProgramLogo only for a logo that is not square, keeping the circle for the initial (ENG-153)", () => {
    const googleLogoUrl = "https://assets.example.test/api/wallet/assets/google-logo/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png?v=0123456789abcdef";
    const googleWideLogoUrl = "https://assets.example.test/api/wallet/assets/google-wide-logo/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png?v=fedcba9876543210";
    const cls = googleClass({ ...pass, googleLogoUrl, googleWideLogoUrl }, config);
    expect(cls.programLogo.sourceUri.uri).toBe(googleLogoUrl);
    expect(cls.wideProgramLogo).toEqual({ sourceUri: { uri: googleWideLogoUrl }, contentDescription: { defaultValue: { language: "de-DE", value: "Kasseler Kaffee Logo" } } });
    expect("wideProgramLogo" in googleClass({ ...pass, googleLogoUrl }, config)).toBe(false);
    expect(() => googleClass({ ...pass, googleLogoUrl, googleWideLogoUrl: "http://localhost:3000/wide.png" }, config)).toThrow("HTTPS");
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
      expect(api.calls.find(call => call.method === "PATCH" && call.url.includes("loyaltyClass/"))?.body).toEqual({ programName: "Kaffeeclub Neu", reviewStatus: "UNDER_REVIEW" });
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
