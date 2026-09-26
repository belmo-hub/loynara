import { createPrivateKey, createSign } from "node:crypto";
import { readFileSync } from "node:fs";
import type { WalletPassData, WalletStatus } from "./types";

export type GoogleConfig = { issuerId: string; logoUrl: string; approvedDeviceTestLogoUrl?: string };
export type GoogleCredentials = { clientEmail: string; privateKey: string };
const API = "https://walletobjects.googleapis.com/walletobjects/v1";
const SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer";

export function googleWalletStatus(env: Record<string, string | undefined> = process.env): WalletStatus & { publishingStatus: "demo" | "published" } {
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
  if (!status.ready) throw new Error(status.reason ?? "Google Wallet nicht verfügbar");
  const json = JSON.parse(readFileSync(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, "utf8"));
  return {
    issuerId: env.GOOGLE_WALLET_ISSUER_ID!, logoUrl: env.GOOGLE_WALLET_PROGRAM_LOGO_URL!, clientEmail: json.client_email, privateKey: json.private_key,
    ...(env.DEVICE_TEST_APPROVED_WALLET_PROVIDER === "google-demo"
      ? { approvedDeviceTestLogoUrl: env.DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL ?? "" } : {}),
  };
}

export function googleClass(pass: WalletPassData, config: GoogleConfig) {
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
  return {
    id: `${config.issuerId}.program_${pass.programId}`,
    issuerName: pass.merchantName,
    programName: pass.programName,
    reviewStatus: "UNDER_REVIEW",
    programLogo: { sourceUri: { uri: logoUrl }, contentDescription: { defaultValue: { language: "de-DE", value: `${pass.merchantName} Logo` } } },
    countryCode: pass.country,
    hexBackgroundColor: pass.brandColor,
    ...(pass.latitude !== undefined && pass.longitude !== undefined ? { locations: [{ latitude: pass.latitude, longitude: pass.longitude }] } : {}),
  };
}

export function googleObject(pass: WalletPassData, config: GoogleConfig) {
  return {
    id: `${config.issuerId}.member_${pass.membershipId}`,
    classId: `${config.issuerId}.program_${pass.programId}`,
    state: "ACTIVE",
    accountId: pass.membershipId.slice(0, 8),
    accountName: "Mitgliedskarte",
    barcode: { type: "QR_CODE", value: pass.scanCode },
    loyaltyPoints: { label: pass.programType === "points" ? "Punkte" : "Stempel", balance: { int: pass.balance } },
    ...(pass.latitude !== undefined && pass.longitude !== undefined ? { locations: [{ latitude: pass.latitude, longitude: pass.longitude }] } : {}),
  };
}

function signJwt(body: Record<string, unknown>, credentials: GoogleCredentials): string {
  const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  const signingInput = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256").update(signingInput).end().sign(credentials.privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

export function googleSaveUrl(object: ReturnType<typeof googleObject>, credentials: GoogleCredentials, issuedAt = Math.floor(Date.now() / 1000)): string {
  const jwt = signJwt({ iss: credentials.clientEmail, aud: "google", typ: "savetowallet", iat: issuedAt, origins: [], payload: { loyaltyObjects: [object] } }, credentials);
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

function accessAssertion(credentials: GoogleCredentials, issuedAt = Math.floor(Date.now() / 1000)): string {
  return signJwt({ iss: credentials.clientEmail, scope: SCOPE, aud: "https://oauth2.googleapis.com/token", iat: issuedAt, exp: issuedAt + 3600 }, credentials);
}

export class GoogleWalletClient {
  constructor(private credentials: GoogleCredentials, private fetcher: typeof fetch = fetch) {}

  private async token(): Promise<string> {
    const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: accessAssertion(this.credentials) });
    const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Google OAuth failed (${response.status})`);
    const data = await response.json();
    if (!data.access_token) throw new Error("Google OAuth returned no access token");
    return data.access_token as string;
  }

  private async request(method: string, path: string, token: string, body?: object): Promise<Response> {
    return this.fetcher(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000) });
  }

  async upsert(pass: WalletPassData, config: GoogleConfig): Promise<string> {
    const cls = googleClass(pass, config);
    const object = googleObject(pass, config);
    const token = await this.token();
    const classGet = await this.request("GET", `/loyaltyClass/${encodeURIComponent(cls.id)}`, token);
    if (classGet.status === 404) {
      const inserted = await this.request("POST", "/loyaltyClass", token, cls);
      if (!inserted.ok && inserted.status !== 409) throw new Error(`Google class creation failed (${inserted.status})`);
    } else if (classGet.ok) {
      const current = await classGet.json() as Record<string, unknown>;
      const patch: Record<string, unknown> = {};
      for (const key of ["issuerName", "programName", "hexBackgroundColor", "programLogo", "locations"] as const) {
        if (JSON.stringify(current[key]) !== JSON.stringify(cls[key as keyof typeof cls])) {
          const value = cls[key as keyof typeof cls];
          if (value !== undefined) patch[key] = value;
        }
      }
      if (Object.keys(patch).length) {
        const updated = await this.request("PATCH", `/loyaltyClass/${encodeURIComponent(cls.id)}`, token, patch);
        if (!updated.ok) throw new Error(`Google class update failed (${updated.status})`);
      }
    } else throw new Error(`Google class lookup failed (${classGet.status})`);
    const objectGet = await this.request("GET", `/loyaltyObject/${encodeURIComponent(object.id)}`, token);
    if (objectGet.status === 404) {
      const inserted = await this.request("POST", "/loyaltyObject", token, object);
      if (!inserted.ok && inserted.status !== 409) throw new Error(`Google object creation failed (${inserted.status})`);
    } else if (objectGet.ok) {
      const patch = await this.request("PATCH", `/loyaltyObject/${encodeURIComponent(object.id)}`, token, { barcode: object.barcode, loyaltyPoints: object.loyaltyPoints });
      if (!patch.ok) throw new Error(`Google object update failed (${patch.status})`);
    } else throw new Error(`Google object lookup failed (${objectGet.status})`);
    return object.id;
  }
}
