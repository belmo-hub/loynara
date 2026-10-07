import { createHash, createHmac, createPrivateKey, createSign, timingSafeEqual, verify, X509Certificate } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import { hexToRgb, passInk, walletProgress, walletText } from "./content";
import type { WalletPassData, WalletRevokedData, WalletStatus } from "./types";

export type ApplePassConfig = {
  passTypeId: string;
  teamId: string;
  webServiceUrl: string;
  authSecret: string;
};

export type AppleSigningConfig = ApplePassConfig & {
  certPath: string;
  keyPath: string;
  wwdrPath: string;
};

const required = ["APPLE_PASS_TYPE_ID", "APPLE_TEAM_ID", "APPLE_SIGNING_CERT_PATH", "APPLE_SIGNING_KEY_PATH", "APPLE_WWDR_CERT_PATH", "APPLE_WALLET_AUTH_SECRET", "APPLE_WALLET_WEB_SERVICE_URL"] as const;

/** Operator diagnostics (npm run diagnose, production guard). Never returned to a browser: see capability.ts. */
export type AppleWalletStatus = WalletStatus & { certificateExpiresAt?: string; certificateDaysRemaining?: number; opensslVersion?: string; zipVersion?: string };
let cachedStatus: { value: AppleWalletStatus; until: number } | undefined;

export function appleWalletStatus(env: Record<string, string | undefined> = process.env): AppleWalletStatus {
  if (env === process.env && cachedStatus && cachedStatus.until > Date.now()) return cachedStatus.value;
  const value = inspectAppleWallet(env);
  if (env === process.env) cachedStatus = { value, until: Date.now() + 300_000 };
  return value;
}

/** Tests and operator tooling that change the environment in-process. */
export function resetAppleWalletStatusCache() { cachedStatus = undefined; }

function inspectAppleWallet(env: Record<string, string | undefined>): AppleWalletStatus {
  if (env.APPLE_WALLET_ENABLED !== "true") return { enabled: false, ready: false, reason: "Apple Wallet ist deaktiviert" };
  const missing = required.filter((key) => !env[key]);
  if (missing.length) return { enabled: true, ready: false, reason: `Fehlende Konfiguration: ${missing.join(", ")}` };
  if (env.APPLE_WALLET_AUTH_SECRET!.length < 32) return { enabled: true, ready: false, reason: "APPLE_WALLET_AUTH_SECRET benötigt mindestens 32 Zeichen" };
  const childEnv = { ...process.env, PATH: env.PATH ?? process.env.PATH };
  const openssl = spawnSync("openssl", ["version"], { encoding: "utf8", env: childEnv, timeout: 5000 });
  const opensslVersion = openssl.status === 0 ? openssl.stdout.match(/^(?:OpenSSL|LibreSSL) [^\n]+/)?.[0] : undefined;
  if (!opensslVersion) return { enabled: true, ready: false, reason: "OpenSSL ist nicht verfügbar oder seine Version kann nicht gelesen werden" };
  const zip = spawnSync("zip", ["-v"], { encoding: "utf8", env: childEnv, timeout: 5000 });
  const zipVersion = zip.status === 0 ? zip.stdout.match(/\bZip \d[^\n]*/)?.[0] : undefined;
  if (!zipVersion) return { enabled: true, ready: false, reason: "zip ist nicht verfügbar oder seine Version kann nicht gelesen werden", opensslVersion };
  const versions = { opensslVersion, zipVersion };
  try {
    const cert = new X509Certificate(readFileSync(env.APPLE_SIGNING_CERT_PATH!));
    const key = createPrivateKey(readFileSync(env.APPLE_SIGNING_KEY_PATH!));
    const challenge = Buffer.from("wallet-configuration-check");
    const signature = createSign("RSA-SHA256").update(challenge).end().sign(key);
    if (!verify("RSA-SHA256", challenge, cert.publicKey, signature)) return { enabled: true, ready: false, reason: "Apple-Zertifikat und privater Schlüssel passen nicht zusammen", ...versions };
    const wwdr = new X509Certificate(readFileSync(env.APPLE_WWDR_CERT_PATH!));
    if (cert.fingerprint256 === wwdr.fingerprint256 || !wwdr.ca || !cert.checkIssued(wwdr) || !cert.verify(wwdr.publicKey)) {
      return { enabled: true, ready: false, reason: "Apple-Signaturzertifikat benötigt das passende separate WWDR-Zwischenzertifikat", ...versions };
    }
    const now = Date.now();
    const days = Math.floor((Date.parse(cert.validTo) - now) / 86_400_000);
    if ([cert, wwdr].some(value => Date.parse(value.validFrom) > now || Date.parse(value.validTo) <= now)) {
      return { enabled: true, ready: false, reason: "Apple-Signaturzertifikat oder WWDR-Zwischenzertifikat ist noch nicht gültig oder abgelaufen", certificateExpiresAt: cert.validTo, certificateDaysRemaining: days, ...versions };
    }
    if (env.NODE_ENV === "production") {
      // These checks prevent ordinary fixture certificates and wrong pass/team credentials. Subject fields do not
      // establish Apple root trust: operators must verify the supplied WWDR chain against Apple's approved root.
      const subject = (value: X509Certificate) => Object.fromEntries(value.subject.split("\n").map(field => {
        const split = field.indexOf("=");
        return [field.slice(0, split), field.slice(split + 1)];
      }));
      const leaf = subject(cert), intermediate = subject(wwdr);
      if (leaf.UID !== env.APPLE_PASS_TYPE_ID || leaf.OU !== env.APPLE_TEAM_ID || intermediate.O !== "Apple Inc."
        || !/^Apple Worldwide Developer Relations Certification Authority(?: G\d+)?$/.test(intermediate.CN ?? "")) {
        return { enabled: true, ready: false, reason: "Apple-Produktionszertifikat muss zum Pass Type ID, Team und Apple-WWDR-Aussteller passen", ...versions };
      }
    }
    const url = new URL(env.APPLE_WALLET_WEB_SERVICE_URL!);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return { enabled: true, ready: false, reason: "Apple-Webservice benötigt HTTPS (außer localhost)", ...versions };
    if (!/^pass(\.[A-Za-z0-9-]+){2,}$/.test(env.APPLE_PASS_TYPE_ID!) || !/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID!)) return { enabled: true, ready: false, reason: "APPLE_PASS_TYPE_ID oder APPLE_TEAM_ID hat kein gültiges Format", ...versions };
    return { enabled: true, ready: true, reason: null, certificateExpiresAt: cert.validTo, certificateDaysRemaining: days, ...versions };
  } catch {
    return { enabled: true, ready: false, reason: "Apple-Zertifikat, Schlüssel oder WWDR-Datei ist nicht lesbar", ...versions };
  }
}

export function appleSigningConfig(env: Record<string, string | undefined> = process.env): AppleSigningConfig {
  const status = appleWalletStatus(env);
  if (!status.ready) throw new Error("Apple Wallet is not available");
  return {
    passTypeId: env.APPLE_PASS_TYPE_ID!, teamId: env.APPLE_TEAM_ID!, webServiceUrl: env.APPLE_WALLET_WEB_SERVICE_URL!,
    authSecret: env.APPLE_WALLET_AUTH_SECRET!, certPath: env.APPLE_SIGNING_CERT_PATH!, keyPath: env.APPLE_SIGNING_KEY_PATH!, wwdrPath: env.APPLE_WWDR_CERT_PATH!,
  };
}

/**
 * The pass web-service token proves possession of ONE issued pass: it is bound to that pass's serial (a random
 * wallet_passes id), never to the card's bearer link or scan code. What the token unlocks is decided server-side from the
 * pass row: the live card for an active pass, a voided pass without QR code or balance once the card was reissued or
 * closed. A reissued card gets a NEW serial and token, so an old pass can never fetch the new QR code.
 */
export function applePassToken(serial: string, config: ApplePassConfig): string {
  return createHmac("sha256", config.authSecret).update(`loynara-apple-pass-v2:${config.passTypeId}:${serial}`).digest("base64url");
}

export function validApplePassToken(serial: string, token: string, config: ApplePassConfig): boolean {
  const expected = Buffer.from(applePassToken(serial, config));
  const supplied = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function colors(brandColor: string) {
  const light = passInk(brandColor) === "light";
  return { foregroundColor: light ? "rgb(255, 255, 255)" : "rgb(17, 17, 17)", labelColor: light ? "rgb(232, 236, 234)" : "rgb(52, 52, 52)", backgroundColor: hexToRgb(brandColor) };
}

function common(pass: WalletPassData | WalletRevokedData, serial: string, config: ApplePassConfig) {
  // A wordmark logo already carries the name; a square mark gets the name beside it.
  const wideLogo = pass.appleLogo ? pass.appleLogo.width / pass.appleLogo.height >= 2.2 : false;
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    serialNumber: serial,
    teamIdentifier: config.teamId,
    organizationName: pass.merchantName,
    description: `${pass.programName} · ${pass.merchantName}`,
    ...(wideLogo ? {} : { logoText: pass.merchantName }),
    ...colors(pass.brandColor),
    webServiceURL: config.webServiceUrl,
    authenticationToken: applePassToken(serial, config),
    sharingProhibited: true,
  };
}

export function applePassJson(pass: WalletPassData, serial: string, config: ApplePassConfig) {
  const t = walletText(pass.locale);
  const progress = walletProgress(pass);
  const locations = pass.latitude !== undefined && pass.longitude !== undefined ? [{ latitude: pass.latitude, longitude: pass.longitude, relevantText: pass.merchantName }] : undefined;
  // One change message per update: on the progress line when there is a target reward, otherwise on the balance.
  const balanceField = { key: "balance", label: progress.unit.toUpperCase(), value: progress.balanceText, ...(progress.statusText ? {} : { changeMessage: "%@" }) };
  return {
    ...common(pass, serial, config),
    barcodes: [{ format: "PKBarcodeFormatQR", message: pass.scanCode, messageEncoding: "iso-8859-1", altText: pass.cardLocator }],
    storeCard: {
      headerFields: [balanceField],
      primaryFields: progress.rewardTitle ? [{ key: "reward", label: (progress.ready ? t.rewardReady : t.nextReward).toUpperCase(), value: progress.rewardTitle }] : [{ key: "programme", label: t.programme.toUpperCase(), value: pass.programName }],
      secondaryFields: [
        ...(progress.statusText ? [{ key: "status", label: t.status.toUpperCase(), value: progress.statusText, changeMessage: "%@" }] : []),
        { key: "card", label: t.card.toUpperCase(), value: pass.cardLocator, textAlignment: "PKTextAlignmentRight" },
      ],
      auxiliaryFields: [{ key: "location", label: t.location.toUpperCase(), value: pass.locationName }],
      backFields: [
        { key: "programme", label: t.programme, value: pass.programName },
        ...(pass.lastActivityAt ? [{ key: "updated", label: t.updated, value: pass.lastActivityAt.toISOString(), dateStyle: "PKDateStyleMedium", timeStyle: "PKDateStyleShort" }] : []),
        { key: "note", label: t.note, value: t.noteBody },
      ],
    },
    ...(locations ? { locations } : {}),
  };
}

/** A revoked pass: marked void by Wallet, no QR code, no balance, no locator. Only the reason and the merchant remain. */
export function appleVoidedPassJson(pass: WalletRevokedData, serial: string, config: ApplePassConfig) {
  const t = walletText(pass.locale);
  return {
    ...common(pass, serial, config),
    voided: true,
    storeCard: {
      primaryFields: [{ key: "state", label: t.revokedLabel.toUpperCase(), value: t.revoked[pass.reason], changeMessage: "%@" }],
      auxiliaryFields: [{ key: "programme", label: t.programme.toUpperCase(), value: pass.programName }],
      backFields: [{ key: "note", label: t.invalid, value: t.revokedBody[pass.reason] }],
    },
  };
}

const run = promisify(execFile);

/** Signs and zips one pass. OpenSSL and zip must exist in the runtime image (see Dockerfile and scripts/wallet-runtime-check.ts). */
export async function applePassArchive(passJson: ReturnType<typeof applePassJson> | ReturnType<typeof appleVoidedPassJson>, brand: Pick<WalletPassData, "brandColor" | "appleLogo">, config: AppleSigningConfig): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "loynara-pass-"));
  try {
    const files = new Map<string, Buffer>();
    files.set("pass.json", Buffer.from(JSON.stringify(passJson)));
    files.set("icon.png", iconPng(29, brand.brandColor));
    files.set("icon@2x.png", iconPng(58, brand.brandColor));
    files.set("icon@3x.png", iconPng(87, brand.brandColor));
    if (brand.appleLogo) {
      // Wallet scales the logo into its 160 x 50 pt slot; one checked PNG serves every density.
      files.set("logo.png", brand.appleLogo.png);
      files.set("logo@2x.png", brand.appleLogo.png);
    }
    for (const [name, bytes] of files) await writeFile(join(dir, name), bytes);
    const manifest = Object.fromEntries([...files].map(([name, bytes]) => [name, createHash("sha1").update(bytes).digest("hex")]));
    await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
    await run("openssl", ["cms", "-sign", "-binary", "-in", "manifest.json", "-signer", config.certPath, "-inkey", config.keyPath, "-certfile", config.wwdrPath, "-out", "signature", "-outform", "DER"], { cwd: dir });
    await run("zip", ["-q", "-X", "pass.pkpass", ...files.keys(), "manifest.json", "signature"], { cwd: dir });
    return await readFile(join(dir, "pass.pkpass"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// A minimal opaque PNG icon in the merchant colour (lock screen and notifications). No customer data in any asset.
function iconPng(size: number, color: string): Buffer {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const stride = size * 4 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * stride + 1 + x * 4;
      const circle = Math.hypot(x - (size - 1) / 2, y - (size - 1) / 2) < size * 0.24;
      pixels.set(circle ? [255, 255, 255, 255] : [r, g, b, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  const chunk = (type: string, data: Buffer) => {
    const label = Buffer.from(type);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([label, data])));
    return Buffer.concat([length, label, data, checksum]);
  };
  return Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
