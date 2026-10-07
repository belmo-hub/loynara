import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { walletProgress, walletText } from "./content";
import type { WalletBrand, WalletPassData, WalletRevokedData, WalletStatus } from "./types";

export type GoogleConfig = { issuerId: string; logoUrl: string; approvedDeviceTestLogoUrl?: string };
export type GoogleCredentials = { clientEmail: string; privateKey: string };
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

type GoogleWalletStatus = WalletStatus & { publishingStatus: "demo" | "published" };
let cachedStatus: { value: GoogleWalletStatus; until: number } | undefined;

/**
 * Operator diagnostics. `reason` may name configuration keys: never send it to a browser (see capability.ts).
 * Cached for one minute per process for the live environment, since card pages ask on every load.
 */
export function googleWalletStatus(env: Record<string, string | undefined> = process.env): GoogleWalletStatus {
  if (env === process.env && cachedStatus && cachedStatus.until > Date.now()) return cachedStatus.value;
  const value = inspectGoogleWallet(env);
  if (env === process.env) cachedStatus = { value, until: Date.now() + 60_000 };
  return value;
}

/** Tests and operator tooling that change the environment in-process. */
export function resetGoogleWalletStatusCache() { cachedStatus = undefined; }

function inspectGoogleWallet(env: Record<string, string | undefined>): GoogleWalletStatus {
  const publishingStatus = env.GOOGLE_WALLET_PUBLISHING_STATUS === "published" ? "published" : "demo";
  if (env.GOOGLE_WALLET_ENABLED !== "true") return { enabled: false, ready: false, reason: "Google Wallet ist deaktiviert", publishingStatus };
  for (const key of ["GOOGLE_WALLET_ISSUER_ID", "GOOGLE_WALLET_SERVICE_ACCOUNT_FILE", "GOOGLE_WALLET_PROGRAM_LOGO_URL"]) {
    if (!env[key]) return { enabled: true, ready: false, reason: `Fehlende Konfiguration: ${key}`, publishingStatus };
  }
  if (!/^\d+$/.test(env.GOOGLE_WALLET_ISSUER_ID!)) return { enabled: true, ready: false, reason: "Ungültige Google Issuer-ID", publishingStatus };
  try {
    const url = new URL(env.GOOGLE_WALLET_PROGRAM_LOGO_URL!);
    if (url.protocol !== "https:") return { enabled: true, ready: false, reason: "Google-Logo muss über HTTPS erreichbar sein", publishingStatus };
    const json = JSON.parse(readFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, "utf8"));
    if (typeof json.client_email !== "string" || typeof json.private_key !== "string" || !json.private_key.includes("BEGIN PRIVATE KEY")) throw new Error("Invalid service account");
    if (createPrivateKey(json.private_key).asymmetricKeyType !== "rsa") throw new Error("Invalid service account key type");
    return { enabled: true, ready: true, reason: null, publishingStatus };
  } catch {
    return { enabled: true, ready: false, reason: "Google Service-Account-Datei ist nicht gültig oder nicht lesbar", publishingStatus };
  }
}

export function googleConfig(env: Record<string, string | undefined> = process.env): GoogleConfig & GoogleCredentials {
  const status = googleWalletStatus(env);
  if (!status.ready) throw new Error("Google Wallet is not available");
  const json = JSON.parse(readFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, "utf8"));
  return {
    issuerId: env.GOOGLE_WALLET_ISSUER_ID!, logoUrl: env.GOOGLE_WALLET_PROGRAM_LOGO_URL!, clientEmail: json.client_email, privateKey: json.private_key,
    ...(env.DEVICE_TEST_APPROVED_WALLET_PROVIDER === "google-demo"
      ? { approvedDeviceTestLogoUrl: env.DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL ?? "" } : {}),
  };
}

export function googleClassId(programId: string, config: Pick<GoogleConfig, "issuerId">) { return `${config.issuerId}.program_${programId}`; }

/**
 * One object per issued pass row (credential generation), never per membership: after a reissue the new pass is a new
 * object and the old one is deactivated, so it can never receive the new QR code.
 */
export function googleObjectId(passId: string, config: Pick<GoogleConfig, "issuerId">) { return `${config.issuerId}.loynara_${passId}`; }

export function googleClass(pass: WalletBrand, config: GoogleConfig) {
  const logoUrl = pass.googleLogoUrl ?? config.logoUrl;
  if (new URL(logoUrl).protocol !== "https:") throw new Error("Google logo must use HTTPS");
  if (config.approvedDeviceTestLogoUrl !== undefined) {
    // Approval covers one program PNG path and its optional content revision,
    // not arbitrary programs or query parameters on the same asset origin.
    try {
      const approved = new URL(config.approvedDeviceTestLogoUrl);
      const selected = new URL(logoUrl);
      const program = approved.pathname.match(/^\/api\/wallet\/assets\/google-logo\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.png$/i)?.[1];
      if (!program || pass.programId !== program || approved.protocol !== "https:"
        || config.approvedDeviceTestLogoUrl !== `${approved.origin}${approved.pathname}`
        || (selected.search !== "" && !/^\?v=[0-9a-f]{16}$/.test(selected.search))
        || logoUrl !== `${config.approvedDeviceTestLogoUrl}${selected.search}`) throw new Error("Unapproved logo");
    } catch { throw new Error("Google device-test program or selected logo is outside the approved route"); }
  }
  const t = walletText(pass.locale);
  const language = pass.locale === "fr" ? "fr-FR" : "de-DE";
  return {
    id: googleClassId(pass.programId, config),
    issuerName: pass.merchantName,
    programName: pass.programName,
    reviewStatus: "UNDER_REVIEW",
    programLogo: { sourceUri: { uri: logoUrl }, contentDescription: { defaultValue: { language, value: t.logoAlt(pass.merchantName) } } },
    countryCode: pass.country,
    hexBackgroundColor: pass.brandColor,
    // A loyalty card belongs to one person; Google must not offer to hand it to another account.
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
    ...(pass.latitude !== undefined && pass.longitude !== undefined ? { locations: [{ latitude: pass.latitude, longitude: pass.longitude }] } : {}),
  };
}

export function googleObject(pass: WalletPassData, passId: string, config: Pick<GoogleConfig, "issuerId">) {
  const t = walletText(pass.locale);
  const progress = walletProgress(pass);
  return {
    id: googleObjectId(passId, config),
    classId: googleClassId(pass.programId, config),
    state: "ACTIVE",
    accountId: pass.cardLocator,
    accountName: t.memberCard,
    barcode: { type: "QR_CODE", value: pass.scanCode, alternateText: pass.cardLocator },
    loyaltyPoints: { label: progress.unit, balance: pass.programType === "stamp" && pass.reward ? { string: progress.balanceText } : { int: pass.balance } },
    textModulesData: [
      ...(progress.rewardTitle ? [{ id: "reward", header: progress.ready ? t.rewardReady : t.nextReward, body: `${progress.rewardTitle} · ${progress.statusText}` }] : []),
      { id: "note", header: t.note, body: t.noteBody },
    ],
    ...(pass.latitude !== undefined && pass.longitude !== undefined ? { locations: [{ latitude: pass.latitude, longitude: pass.longitude }] } : {}),
  };
}

/** Full replacement for a revoked object: INACTIVE, without barcode, balance or locator. */
export function googleRevokedObject(pass: WalletRevokedData, objectId: string, config: Pick<GoogleConfig, "issuerId">) {
  const t = walletText(pass.locale);
  return {
    id: objectId,
    classId: googleClassId(pass.programId, config),
    state: "INACTIVE",
    accountName: t.memberCard,
    textModulesData: [{ id: "status", header: t.invalid, body: t.revokedBody[pass.reason] }],
  };
}

function signJwt(body: Record<string, unknown>, credentials: GoogleCredentials): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(credentials.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

/**
 * Save link for an object that was already created through the REST API. The JWT only references it by id, so the
 * scan code never travels in the link (which lands in browser history and on pay.google.com).
 */
export function googleSaveUrl(object: { id: string; classId: string }, credentials: GoogleCredentials, origins: string[] = [], issuedAt = Math.floor(Date.now() / 1000)): string {
  const jwt = signJwt({ iss: credentials.clientEmail, aud: "google", typ: "savetowallet", iat: issuedAt, origins, payload: { loyaltyObjects: [{ id: object.id, classId: object.classId }] } }, credentials);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

function accessAssertion(credentials: GoogleCredentials, issuedAt = Math.floor(Date.now() / 1000)): string {
  return signJwt({ iss: credentials.clientEmail, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 3600 }, credentials);
}

/** Error without provider response bodies, which can echo request details. */
export class GoogleWalletError extends Error {
  constructor(readonly step: string, readonly status: number) { super(`Google Wallet ${step} failed (${status})`); this.name = "GoogleWalletError"; }
}

export class GoogleWalletClient {
  private accessToken?: Promise<string>;
  constructor(private credentials: GoogleCredentials, private fetcher: typeof fetch = fetch) {}

  private async token(): Promise<string> {
    this.accessToken ??= (async () => {
      const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: accessAssertion(this.credentials) });
      const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new GoogleWalletError("authorization", response.status);
      const data = await response.json();
      if (!data.access_token) throw new GoogleWalletError("authorization", 0);
      return data.access_token as string;
    })();
    try { return await this.accessToken; } catch (error) { this.accessToken = undefined; throw error; }
  }

  private async request(method: string, path: string, body?: object): Promise<Response> {
    const token = await this.token();
    return this.fetcher(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  }

  /** Creates or aligns the programme class (merchant name, programme, colour, logo, location). */
  async upsertClass(brand: WalletBrand, config: GoogleConfig): Promise<string> {
    const cls = googleClass(brand, config);
    const classGet = await this.request("GET", `/loyaltyClass/${encodeURIComponent(cls.id)}`);
    if (classGet.status === 404) {
      const inserted = await this.request("POST", "/loyaltyClass", cls);
      if (!inserted.ok && inserted.status !== 409) throw new GoogleWalletError("class creation", inserted.status);
    } else if (classGet.ok) {
      const current = await classGet.json() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of ["issuerName", "programName", "hexBackgroundColor", "programLogo", "locations", "multipleDevicesAndHoldersAllowedStatus"] as const) {
        if (JSON.stringify(current[key]) !== JSON.stringify(cls[key as keyof typeof cls])) {
          const value = cls[key as keyof typeof cls];
          if (value !== undefined) patch[key] = value;
        }
      }
      if (Object.keys(patch).length) {
        const updated = await this.request("PATCH", `/loyaltyClass/${encodeURIComponent(cls.id)}`, patch);
        if (!updated.ok) throw new GoogleWalletError("class update", updated.status);
      }
    } else throw new GoogleWalletError("class lookup", classGet.status);
    return cls.id;
  }

  /** Creates the object or overwrites its displayed state from Loynara. Never reads a balance back from Google. */
  async upsert(pass: WalletPassData, passId: string, config: GoogleConfig): Promise<{ id: string; classId: string }> {
    await this.upsertClass(pass, config);
    const object = googleObject(pass, passId, config);
    const objectGet = await this.request("GET", `/loyaltyObject/${encodeURIComponent(object.id)}`);
    if (objectGet.status === 404) {
      const inserted = await this.request("POST", "/loyaltyObject", object);
      if (!inserted.ok && inserted.status !== 409) throw new GoogleWalletError("object creation", inserted.status);
    } else if (objectGet.ok) {
      const display: Partial<typeof object> = { ...object };
      delete display.id;
      delete display.classId;
      const patch = await this.request("PATCH", `/loyaltyObject/${encodeURIComponent(object.id)}`, display);
      if (!patch.ok) throw new GoogleWalletError("object update", patch.status);
    } else throw new GoogleWalletError("object lookup", objectGet.status);
    return { id: object.id, classId: object.classId };
  }

  /** Deactivates a revoked object. An object Google never created needs nothing. */
  async revoke(pass: WalletRevokedData, objectId: string, config: GoogleConfig): Promise<"revoked" | "absent"> {
    const replaced = await this.request("PUT", `/loyaltyObject/${encodeURIComponent(objectId)}`, googleRevokedObject(pass, objectId, config));
    if (replaced.status === 404) return "absent";
    if (!replaced.ok) throw new GoogleWalletError("object deactivation", replaced.status);
    return "revoked";
  }
}
