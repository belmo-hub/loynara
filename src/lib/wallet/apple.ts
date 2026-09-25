import { createHash, createHmac, createPrivateKey, createSign, timingSafeEqual, verify, X509Certificate } from "node:crypto";
import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import type { WalletPassData, WalletStatus } from "./types";

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

type AppleWalletStatus = WalletStatus & { certificateExpiresAt?: string; certificateDaysRemaining?: number; opensslVersion?: string; zipVersion?: string };
let cachedStatus: { value: AppleWalletStatus; until: number } | undefined;

export function appleWalletStatus(env: Record<string, string | undefined> = process.env): AppleWalletStatus {
  if (env === process.env && cachedStatus && cachedStatus.until > Date.now()) return cachedStatus.value;
  const value = inspectAppleWallet(env);
  if (env === process.env) cachedStatus = { value, until: Date.now() + 300_000 };
  return value;
}

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
    readFileSync(env.APPLE_WWDR_CERT_PATH!);
    const days = Math.floor((Date.parse(cert.validTo) - Date.now()) / 86_400_000);
    if (days < 0) return { enabled: true, ready: false, reason: "Apple-Signaturzertifikat ist abgelaufen", certificateExpiresAt: cert.validTo, certificateDaysRemaining: days, ...versions };
    const url = new URL(env.APPLE_WALLET_WEB_SERVICE_URL!);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return { enabled: true, ready: false, reason: "Apple-Webservice benötigt HTTPS (außer localhost)", ...versions };
    return { enabled: true, ready: true, reason: null, certificateExpiresAt: cert.validTo, certificateDaysRemaining: days, ...versions };
  } catch {
    return { enabled: true, ready: false, reason: "Apple-Zertifikat, Schlüssel oder WWDR-Datei ist nicht lesbar", ...versions };
  }
}

export function appleSigningConfig(env: Record<string, string | undefined> = process.env): AppleSigningConfig {
  const status = appleWalletStatus(env);
  if (!status.ready) throw new Error(status.reason ?? "Apple Wallet nicht verfügbar");
  return {
    passTypeId: env.APPLE_PASS_TYPE_ID!, teamId: env.APPLE_TEAM_ID!, webServiceUrl: env.APPLE_WALLET_WEB_SERVICE_URL!,
    authSecret: env.APPLE_WALLET_AUTH_SECRET!, certPath: env.APPLE_SIGNING_CERT_PATH!, keyPath: env.APPLE_SIGNING_KEY_PATH!, wwdrPath: env.APPLE_WWDR_CERT_PATH!,
  };
}

export function applePassToken(membershipId: string, config: ApplePassConfig): string {
  return createHmac("sha256", config.authSecret).update(`${config.passTypeId}:${membershipId}`).digest("base64url");
}

export function validApplePassToken(membershipId: string, token: string, config: ApplePassConfig): boolean {
  const expected = Buffer.from(applePassToken(membershipId, config));
  const supplied = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

export function applePassJson(pass: WalletPassData, config: ApplePassConfig) {
  const unit = pass.programType === "points" ? "Punkte" : "Stempel";
  const locations = pass.latitude !== undefined && pass.longitude !== undefined ? [{ latitude: pass.latitude, longitude: pass.longitude, relevantText: `${pass.merchantName} ist in der Nähe` }] : undefined;
  return {
    formatVersion: 1,
    passTypeIdentifier: config.passTypeId,
    serialNumber: pass.membershipId,
    teamIdentifier: config.teamId,
    organizationName: pass.merchantName,
    description: `${pass.programName} · ${pass.locationName}`,
    logoText: pass.merchantName,
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: hexToRgb(pass.brandColor),
    labelColor: "rgb(230, 240, 237)",
    webServiceURL: config.webServiceUrl,
    authenticationToken: applePassToken(pass.membershipId, config),
    barcodes: [{ format: "PKBarcodeFormatQR", message: pass.scanCode, messageEncoding: "iso-8859-1" }],
    storeCard: {
      primaryFields: [{ key: "balance", label: unit.toUpperCase(), value: pass.balance }],
      secondaryFields: [{ key: "location", label: "STANDORT", value: pass.locationName }],
      auxiliaryFields: [{ key: "member", label: "KARTE", value: pass.membershipId.slice(0, 8).toUpperCase() }],
      backFields: [{ key: "terms", label: "Hinweis", value: "Guthaben wird beim Kassenvorgang im System geprüft. Diese Karte ist nur eine Anzeige." }],
    },
    ...(locations ? { locations } : {}),
  };
}

function hexToRgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid brand color");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}

const run = promisify(execFile);

export async function applePassArchive(pass: WalletPassData, config: AppleSigningConfig): Promise<Buffer> {
  const dir = await mkdtemp(join(tmpdir(), "looplocal-pass-"));
  try {
    const files = new Map<string, Buffer>();
    files.set("pass.json", Buffer.from(JSON.stringify(applePassJson(pass, config))));
    files.set("icon.png", iconPng(29, pass.brandColor));
    files.set("icon@2x.png", iconPng(58, pass.brandColor));
    files.set("icon@3x.png", iconPng(87, pass.brandColor));
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

// A minimal opaque PNG icon. Merchant branding belongs in the pass text and colors;
// no externally hosted logo or customer data is embedded in this asset.
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
