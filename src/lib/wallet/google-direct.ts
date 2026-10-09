import { createPrivateKey } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import path from "node:path";
import { googleConfig, googleWalletStatus, type GoogleConfig, type GoogleCredentials } from "./google";
import type { WalletStatus } from "./types";

type Env = Record<string, string | undefined>;
export type GoogleLocationClass = { tenantId: string; locationId: string; programId: string; classId: string; issuanceEnabled: boolean; testAccountsApproved: boolean };
export type GoogleDirectConfig = GoogleConfig & GoogleCredentials & { binding: GoogleLocationClass; publishingStatus: "demo" | "published" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
// This is the existing managed-provider issuer, not Loynara's issuer. Never adopt its resources.
const MANAGED_PASSFAST_ISSUER = "3388000000023094673";

export function googleLocationClasses(env: Env): GoogleLocationClass[] {
  const issuer = env.GOOGLE_WALLET_ISSUER_ID ?? "";
  if (!/^\d{10,25}$/.test(issuer) || issuer === MANAGED_PASSFAST_ISSUER) throw new Error("Google Direct requires an owned issuer");
  const raw = env.GOOGLE_WALLET_LOCATION_CLASSES;
  if (!raw || raw.length > 65536) throw new Error("Google Direct requires approved location classes");
  const rows: unknown = JSON.parse(raw);
  if (!Array.isArray(rows) || !rows.length || rows.length > 500) throw new Error("Invalid Google Direct bindings");
  const scopes = new Set<string>(), classes = new Set<string>();
  return rows.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Google Direct binding");
    const row = value as Record<string, unknown>;
    if (Object.keys(row).sort().join(",") !== "classId,issuanceEnabled,locationId,programId,tenantId,testAccountsApproved"
      || ![row.tenantId, row.locationId, row.programId].every(id => typeof id === "string" && UUID.test(id))
      || typeof row.classId !== "string" || !row.classId.startsWith(`${issuer}.`) || !/^[A-Za-z0-9._-]{1,200}$/.test(row.classId.slice(issuer.length + 1))
      || typeof row.issuanceEnabled !== "boolean" || typeof row.testAccountsApproved !== "boolean") throw new Error("Invalid Google Direct binding");
    const binding = { ...row, tenantId: String(row.tenantId).toLowerCase(), locationId: String(row.locationId).toLowerCase(), programId: String(row.programId).toLowerCase() } as GoogleLocationClass;
    const scope = `${binding.tenantId}/${binding.locationId}/${binding.programId}`;
    if (scopes.has(scope) || classes.has(binding.classId)) throw new Error("Duplicate Google Direct scope or class");
    scopes.add(scope); classes.add(binding.classId);
    return binding;
  });
}

/** Operator diagnostics only. Credential readiness alone never authorizes a customer location. */
export function googleDirectStatus(env: Env = process.env, tenantId?: string, locationId?: string, programId?: string, purpose: "issuance" | "maintenance" = "issuance"): WalletStatus & { publishingStatus: "demo" | "published" } {
  const credentialStatus = googleWalletStatus(env);
  const publishingStatus = credentialStatus.publishingStatus;
  const unavailable = (reason: string) => ({ enabled: env.GOOGLE_WALLET_ENABLED === "true", ready: false, reason, publishingStatus });
  if (env.GOOGLE_WALLET_ENABLED !== "true") return unavailable("Google Direct is disabled");
  if (env.GOOGLE_WALLET_PROVIDER !== "GOOGLE_DIRECT") return unavailable("Google Direct provider must be explicitly selected");
  if (!["demo", "published"].includes(env.GOOGLE_WALLET_PUBLISHING_STATUS ?? "")) return unavailable("Google Direct publishing status must be explicit");
  if (!credentialStatus.ready) return unavailable(credentialStatus.reason ?? "Google credentials unavailable");
  try {
    const filename = env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!;
    const stat = lstatSync(filename);
    const relative = path.relative(realpathSync(process.cwd()), realpathSync(filename));
    if (!path.isAbsolute(filename) || !stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (stat.mode & 0o400) === 0
      || (process.getuid && stat.uid !== process.getuid()) || (relative !== ".." && !relative.startsWith(`..${path.sep}`))) throw new Error("Unsafe credential custody");
    const json = JSON.parse(readFileSync(filename, "utf8"));
    if (json.type !== "service_account" || !/^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(json.client_email ?? "")
      || (createPrivateKey(json.private_key).asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw new Error("Invalid service account");
    const bindings = googleLocationClasses(env);
    if (env.PRODUCTION_ENVIRONMENT === "loynara-production" && (env.WALLET_PRODUCTION_APPROVED !== "true" || publishingStatus !== "published")) throw new Error("Google production approval required");
    if (tenantId === undefined && locationId === undefined && programId === undefined) return { enabled: true, ready: true, reason: null, publishingStatus };
    const binding = bindings.find(row => row.tenantId === tenantId?.toLowerCase() && row.locationId === locationId?.toLowerCase() && row.programId === programId?.toLowerCase());
    if (!binding || (purpose === "issuance" && !binding.issuanceEnabled) || (publishingStatus === "demo" && !binding.testAccountsApproved)) throw new Error("Unapproved Google scope");
    return { enabled: true, ready: true, reason: null, publishingStatus };
  } catch {
    return unavailable("Google Direct requires restricted credentials, valid owned classes and approved issuance scope");
  }
}

export function googleDirectConfig(env: Env, tenantId: string, locationId: string, programId: string, purpose: "issuance" | "maintenance" = "issuance"): GoogleDirectConfig {
  const status = googleDirectStatus(env, tenantId, locationId, programId, purpose);
  if (!status.ready) throw new Error("Google Direct unavailable");
  const binding = googleLocationClasses(env).find(row => row.tenantId === tenantId.toLowerCase() && row.locationId === locationId.toLowerCase() && row.programId === programId.toLowerCase())!;
  return { ...googleConfig(env), binding, publishingStatus: status.publishingStatus };
}
