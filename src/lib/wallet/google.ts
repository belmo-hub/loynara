import { createHash, createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { walletProgress, walletText } from "./content";
import type { WalletBrand, WalletPassData, WalletRevokedData, WalletStatus } from "./types";

export type GoogleConfig = { issuerId: string; logoUrl: string; approvedDeviceTestLogoUrl?: string; binding?: { tenantId: string; locationId: string; programId: string; classId: string }; publishingStatus?: "demo" | "published" };
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

export function googleClassId(programId: string, config: Pick<GoogleConfig, "issuerId" | "binding">) {
  if (config.binding) {
    if (programId.toLowerCase() !== config.binding.programId || !config.binding.classId.startsWith(`${config.issuerId}.`)) throw new Error("Google class outside approved scope");
    return config.binding.classId;
  }
  return `${config.issuerId}.program_${programId}`;
}

/**
 * One object per issued pass row (credential generation), never per membership: after a reissue the new pass is a new
 * object and the old one is deactivated, so it can never receive the new QR code.
 */
export function googleObjectId(passId: string, config: Pick<GoogleConfig, "issuerId" | "binding">) {
  const suffix = config.binding ? "_" + createHash("sha256").update("loynara-google-binding-v1\0").update([config.issuerId, config.binding.tenantId, config.binding.locationId, config.binding.programId, config.binding.classId].join("\0")).digest("hex") : "";
  return `${config.issuerId}.loynara_${passId}${suffix}`;
}

function assertGoogleScope(pass: WalletBrand, config: Pick<GoogleConfig, "issuerId" | "binding">) {
  if (config.binding && (pass.tenantId.toLowerCase() !== config.binding.tenantId || pass.locationId?.toLowerCase() !== config.binding.locationId || pass.programId.toLowerCase() !== config.binding.programId)) throw new Error("Google pass outside approved scope");
  googleClassId(pass.programId, config);
}

export function googleClass(pass: WalletBrand, config: GoogleConfig) {
  assertGoogleScope(pass, config);
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

export function googleObject(pass: WalletPassData, passId: string, config: Pick<GoogleConfig, "issuerId" | "binding">) {
  assertGoogleScope(pass, config);
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
export function googleRevokedObject(pass: WalletRevokedData, objectId: string, config: Pick<GoogleConfig, "issuerId" | "binding">) {
  assertGoogleScope(pass, config);
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
export function googleSaveUrl(object: { id: string; classId: string }, credentials: GoogleCredentials, origins: string[] = [], issuedAt = Math.floor(Date.now() / 1000), config?: Pick<GoogleConfig, "issuerId" | "binding">): string {
  if (config && (!object.id.startsWith(`${config.issuerId}.loynara_`) || object.classId !== config.binding?.classId)) throw new Error("Google save reference outside approved scope");
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
  private tokenExpiresAt = 0;
  private deadline: number;
  constructor(private credentials: GoogleCredentials, private fetcher: typeof fetch = fetch, operationMs = 60_000) { this.deadline = Date.now() + operationMs; }

  private signal(): AbortSignal {
    const remaining = this.deadline - Date.now();
    if (remaining <= 0) throw new GoogleWalletError("timeout", 0);
    return AbortSignal.timeout(Math.min(15_000, remaining));
  }

  private async token(): Promise<string> {
    if (this.tokenExpiresAt && Date.now() >= this.tokenExpiresAt) this.accessToken = undefined;
    this.accessToken ??= (async () => {
      const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: accessAssertion(this.credentials) });
      const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: this.signal(), redirect: "error" });
      if (!response.ok) throw new GoogleWalletError("authorization", response.status);
      const data = await response.json();
      if (typeof data.access_token !== "string" || !data.access_token || data.access_token.length > 16384) throw new GoogleWalletError("authorization", 0);
      this.tokenExpiresAt = Date.now() + Math.max(1, (Number(data.expires_in) || 3600) - 60) * 1000;
      return data.access_token as string;
    })();
    try { return await this.accessToken; } catch (error) { this.accessToken = undefined; throw error; }
  }

  private async request(method: string, path: string, body?: object): Promise<Response> {
    const token = await this.token();
    const response = await this.fetcher(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: this.signal(), redirect: "error" });
    if (response.status === 401) this.accessToken = undefined;
    return response;
  }

  /** Creates or aligns the programme class (merchant name, programme, colour, logo, location). */
  async upsertClass(brand: WalletBrand, config: GoogleConfig): Promise<string> {
    const cls = googleClass(brand, config);
    const classGet = await this.request("GET", `/loyaltyClass/${encodeURIComponent(cls.id)}`);
    if (classGet.status === 404) {
      if (config.binding && config.publishingStatus !== "demo") throw new GoogleWalletError("approved class missing", 404);
      const inserted = await this.request("POST", "/loyaltyClass", cls);
      if (!inserted.ok && inserted.status !== 409) throw new GoogleWalletError("class creation", inserted.status);
      if (inserted.status === 409) {
        const raced = await this.request("GET", `/loyaltyClass/${encodeURIComponent(cls.id)}`);
        if (!raced.ok || (await raced.json()).id !== cls.id) throw new GoogleWalletError("class conflict", 409);
      }
    } else if (classGet.ok) {
      const current = await classGet.json() as Record<string, unknown>;
      if (current.id !== cls.id || current.reviewStatus === "REJECTED" || (config.binding && config.publishingStatus === "published" && current.reviewStatus !== "APPROVED")) throw new GoogleWalletError("class eligibility", 0);
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
      if (inserted.status === 409) {
        const raced = await this.request("GET", `/loyaltyObject/${encodeURIComponent(object.id)}`);
        if (!raced.ok) throw new GoogleWalletError("object conflict", raced.status);
        const current = await raced.json();
        if (current.id !== object.id || current.classId !== object.classId) throw new GoogleWalletError("object conflict", 409);
        const display = { state: object.state, accountId: object.accountId, accountName: object.accountName, barcode: object.barcode, loyaltyPoints: object.loyaltyPoints, textModulesData: object.textModulesData };
        const aligned = await this.request("PATCH", `/loyaltyObject/${encodeURIComponent(object.id)}`, display);
        if (!aligned.ok) throw new GoogleWalletError("object update", aligned.status);
      }
    } else if (objectGet.ok) {
      const current = await objectGet.json();
      if (current.id !== object.id || current.classId !== object.classId) throw new GoogleWalletError("object binding", 0);
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
    assertGoogleScope(pass, config);
    if (config.binding) {
      const match = objectId.match(new RegExp(`^${config.issuerId}\\.loynara_([0-9a-f-]{36})_[0-9a-f]{64}$`));
      if (!match || googleObjectId(match[1], config) !== objectId) throw new GoogleWalletError("object binding", 0);
      const current = await this.getObject(objectId, config);
      if (!current) return "absent";
      // Targeted PATCH clears sensitive projection fields, preserving Google's unrelated object metadata.
      const updated = await this.request("PATCH", `/loyaltyObject/${encodeURIComponent(objectId)}`, { state: "INACTIVE", accountId: "", barcode: null, loyaltyPoints: null, secondaryLoyaltyPoints: null, textModulesData: googleRevokedObject(pass, objectId, config).textModulesData });
      if (!updated.ok) throw new GoogleWalletError("object deactivation", updated.status);
      return "revoked";
    }
    const replaced = await this.request("PUT", `/loyaltyObject/${encodeURIComponent(objectId)}`, googleRevokedObject(pass, objectId, config));
    if (replaced.status === 404) return "absent";
    if (!replaced.ok) throw new GoogleWalletError("object deactivation", replaced.status);
    return "revoked";
  }

  async getObject(objectId: string, config: GoogleConfig): Promise<Record<string, unknown> | null> {
    if (!objectId.startsWith(`${config.issuerId}.loynara_`)) throw new GoogleWalletError("object binding", 0);
    const response = await this.request("GET", `/loyaltyObject/${encodeURIComponent(objectId)}`);
    if (response.status === 404) return null;
    if (!response.ok) throw new GoogleWalletError("object status", response.status);
    const object = await response.json();
    if (object.id !== objectId || (config.binding && object.classId !== config.binding.classId)) throw new GoogleWalletError("object binding", 0);
    return object;
  }
}
