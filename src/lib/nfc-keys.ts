import { hkdfSync, timingSafeEqual } from "node:crypto";
import { isProductionDeployment } from "./pilot-policy";

/**
 * Per-tag NFC keys derived from two independent master secrets (HKDF-SHA256, RFC 5869).
 *
 *   VERIFY master  (application)   -> metaReadKey, fileReadKey : what the server needs to verify a tap.
 *   ADMIN  master  (operator only) -> key0, key3, key4          : what can rewrite or re-key a tag.
 *
 * The server never receives the ADMIN master, so a compromised web process can verify and forge SDM reads
 * (inherent to server-side SDM verification) but cannot re-key or rewrite a tag.
 * Derivation is bound to the tag UID and a per-tag key reference, so keys differ per tag, a reference can
 * be rotated for the same UID, and an interrupted provisioning can recompute its keys instead of relying on a
 * key file written mid-flight. Real masters are never in source, logs or reports: callers pass them in.
 *
 * WHICH SYSTEM HOLDS THE MASTERS (production secret store, offline copy, rotation) IS AN OPEN OWNER DECISION.
 * This module only defines the derivation and the provider contract.
 */
export type TapKeys = { metaReadKey: Buffer; fileReadKey: Buffer };
export type AdminKeys = { key0: Buffer; key3: Buffer; key4: Buffer };
export type TagKeys = TapKeys & AdminKeys;
export type TapKeyContext = { uid?: string };
export interface TapKeyProvider { getKeys(ref: string, context?: TapKeyContext): Promise<TapKeys> }

export const DERIVED_KEY_PROVIDER = "derived_v1";
const VERIFY_SALT = "loynara/nfc/v1/verification";
const ADMIN_SALT = "loynara/nfc/v1/administration";
const REF = /^[A-Za-z0-9_-]{1,80}$/;
const UID = /^[a-f0-9]{14}$/;

export class NfcKeyError extends Error {
  constructor(public code: "MASTER_INVALID" | "MASTERS_NOT_DISTINCT" | "KEY_CONTEXT_INVALID") { super(code); this.name = "NfcKeyError"; }
}

/** A master is 32 random bytes as 64 hex characters. Near-constant bytes (placeholders) are refused. */
export function parseMaster(value: string | undefined): Buffer {
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value)) throw new NfcKeyError("MASTER_INVALID");
  const master = Buffer.from(value, "hex");
  if (new Set(master).size < 8) throw new NfcKeyError("MASTER_INVALID");
  return master;
}

function expand(master: Buffer, salt: string, ref: string, uid: string, label: string): Buffer {
  if (!REF.test(ref) || !UID.test(uid)) throw new NfcKeyError("KEY_CONTEXT_INVALID");
  return Buffer.from(hkdfSync("sha256", master, salt, `${ref}|${uid}|${label}`, 16));
}

export function deriveVerificationKeys(verifyMaster: Buffer, ref: string, uid: string): TapKeys {
  return { metaReadKey: expand(verifyMaster, VERIFY_SALT, ref, uid, "meta"), fileReadKey: expand(verifyMaster, VERIFY_SALT, ref, uid, "file") };
}

export function deriveAdminKeys(adminMaster: Buffer, ref: string, uid: string): AdminKeys {
  return { key0: expand(adminMaster, ADMIN_SALT, ref, uid, "key0"), key3: expand(adminMaster, ADMIN_SALT, ref, uid, "key3"), key4: expand(adminMaster, ADMIN_SALT, ref, uid, "key4") };
}

/** Operator side: all five keys for one tag. Refuses identical masters, which would defeat the separation. */
export function deriveTagKeys(input: { verifyMaster: Buffer; adminMaster: Buffer; ref: string; uid: string }): TagKeys {
  if (input.verifyMaster.length === input.adminMaster.length && timingSafeEqual(input.verifyMaster, input.adminMaster)) throw new NfcKeyError("MASTERS_NOT_DISTINCT");
  return { ...deriveVerificationKeys(input.verifyMaster, input.ref, input.uid), ...deriveAdminKeys(input.adminMaster, input.ref, input.uid) };
}

/** Server side: holds the VERIFY master only. */
export class DerivedTapKeyProvider implements TapKeyProvider {
  constructor(private readonly verifyMaster: Buffer) {}
  async getKeys(ref: string, context?: TapKeyContext): Promise<TapKeys> {
    if (!context?.uid) throw new NfcKeyError("KEY_CONTEXT_INVALID");
    return deriveVerificationKeys(this.verifyMaster, ref, context.uid);
  }
}

type NfcEnv = { PRODUCTION_ENVIRONMENT?: string; NFC_ENABLED?: string; NFC_KEY_PROVIDER?: string; NFC_VERIFY_MASTER_KEY?: string; TAP_SYNTHETIC_KEY_FILE?: string; [name: string]: string | undefined };
export type NfcCapability =
  | { available: true; provider: "derived" | "synthetic" }
  | { available: false; reason: "NFC_DISABLED" | "KEY_PROVIDER_MISSING" | "KEY_INVALID" };

/**
 * What this deployment can actually do. Settings, navigation and the customer/cashier surfaces follow this,
 * not the environment name: NFC is offered exactly where a verification-key provider is configured.
 */
export function nfcCapability(env: NfcEnv = process.env): NfcCapability {
  const derived = env.NFC_KEY_PROVIDER === DERIVED_KEY_PROVIDER;
  if (isProductionDeployment(env)) {
    if (env.NFC_ENABLED !== "true") return { available: false, reason: "NFC_DISABLED" };
    if (!derived) return { available: false, reason: "KEY_PROVIDER_MISSING" };
    try { parseMaster(env.NFC_VERIFY_MASTER_KEY); } catch { return { available: false, reason: "KEY_INVALID" }; }
    return { available: true, provider: "derived" };
  }
  if (derived) {
    try { parseMaster(env.NFC_VERIFY_MASTER_KEY); } catch { return { available: false, reason: "KEY_INVALID" }; }
    return { available: true, provider: "derived" };
  }
  return env.TAP_SYNTHETIC_KEY_FILE ? { available: true, provider: "synthetic" } : { available: false, reason: "KEY_PROVIDER_MISSING" };
}

/** Real production only ever uses the derived provider; the synthetic file provider is for development, preview and device tests. */
export function derivedProviderFromEnv(env: NfcEnv = process.env): TapKeyProvider | undefined {
  if (env.NFC_KEY_PROVIDER !== DERIVED_KEY_PROVIDER) return undefined;
  return new DerivedTapKeyProvider(parseMaster(env.NFC_VERIFY_MASTER_KEY));
}
