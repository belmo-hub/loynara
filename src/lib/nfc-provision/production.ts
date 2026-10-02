import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import { parseMaster, NfcKeyError } from "../nfc-keys";
import type { ProvisionRepository } from "./flow";

/**
 * Production tag provisioning is split in two so that no component needs more reach than it has:
 *
 *   1. PHYSICAL (operator machine, offline from production): talks to the reader and the chip, derives all five keys
 *      from the two masters, writes the tag, and produces a non-secret REGISTRATION BUNDLE. It never touches the
 *      production database (which is private to Railway) and never sends keys anywhere.
 *   2. REGISTRATION (private Railway console, scripts/operator-register-tag.ts): verifies the programme binding,
 *      proves with the server's own verification keys that the chip answers correctly, then records the tag.
 *
 * A chip that was provisioned but never registered fails closed (its taps are "unavailable").
 */
export const PREVIEW_ORIGIN = "https://preview.getloynara.com";
export type NfcTarget = "preview" | "production";

export class NfcOperatorRefusal extends Error {
  constructor(public code: string) { super(code); this.name = "NfcOperatorRefusal"; }
}
const refuse = (code: string): never => { throw new NfcOperatorRefusal(code); };

/** Preview URLs and production URLs are never interchangeable. */
export function assertTagOrigin(target: NfcTarget, origin: string, env: Record<string, string | undefined>): void {
  let url: URL;
  try { url = new URL(origin); } catch { return refuse("ORIGIN_INVALID"); }
  if (url.protocol !== "https:" || url.origin !== origin || url.pathname !== "/") refuse("ORIGIN_NOT_A_BARE_HTTPS_ORIGIN");
  if (target === "preview") { if (origin !== PREVIEW_ORIGIN) refuse("PREVIEW_ORIGIN_REQUIRED"); return; }
  if (/^(preview|localhost)|\.pages\.dev$|^127\.|^\[?::1/.test(url.hostname)) refuse("PRODUCTION_ORIGIN_IS_NOT_PRODUCTION");
  if (!env.PRODUCTION_APPROVED_ORIGIN || env.PRODUCTION_APPROVED_ORIGIN !== origin) refuse("ORIGIN_NOT_THE_APPROVED_PRODUCTION_ORIGIN");
}

/** The operator environment for a production tag: both masters, distinct, and NO database and NO development keys. */
export function assertProductionOperatorEnvironment(env: Record<string, string | undefined>, origin: string) {
  assertTagOrigin("production", origin, env);
  if (env.DATABASE_URL) refuse("DATABASE_MUST_NOT_BE_REACHABLE_FROM_THE_OPERATOR_TOOL");
  if (env.TAP_SYNTHETIC_KEY_FILE || env.DEVICE_TEST_APPROVED_ORIGIN || env.DEVICE_TEST_DATABASE_KEY_SALT) refuse("DEVELOPMENT_SETTINGS_PRESENT");
  let verifyMaster: Buffer; let adminMaster: Buffer;
  try { verifyMaster = parseMaster(env.NFC_VERIFY_MASTER_KEY); adminMaster = parseMaster(env.NFC_ADMIN_MASTER_KEY); }
  catch (error) { return refuse(error instanceof NfcKeyError ? error.code : "MASTER_INVALID"); }
  if (verifyMaster.equals(adminMaster)) refuse("MASTERS_NOT_DISTINCT");
  return { verifyMaster, adminMaster };
}

export type Binding = { tenantId: string; locationId: string; programId: string; cooldownSeconds: number };

/** No database: the intended binding is recorded in the bundle and verified later, server-side, at registration. */
export function offlineRepository(binding: Binding): ProvisionRepository {
  return {
    async checkTarget() { return { tenantId: binding.tenantId, locationId: binding.locationId, programId: binding.programId, mode: "staff_confirmed", cooldownSeconds: binding.cooldownSeconds }; },
    async reserve() { return { id: randomUUID(), publicRef: randomBytes(18).toString("base64url") }; },
    async verifyMapping() { /* verified by the registration step against the real database */ },
    async activate() { /* activation happens at registration */ },
    async fail() { /* nothing to undo: no row exists */ },
  };
}

export const bundleSchema = z.object({
  version: z.literal(1),
  target: z.literal("production"),
  origin: z.string().max(200),
  tenantId: z.uuid(), locationId: z.uuid(), programId: z.uuid(),
  uid: z.string().regex(/^[a-f0-9]{14}$/),
  publicRef: z.string().regex(/^[A-Za-z0-9_-]{24}$/),
  keyRef: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
  configVersion: z.number().int().min(1).max(1000),
  sampleUrl: z.string().max(300),
  firstCounter: z.number().int().min(1), secondCounter: z.number().int().min(2),
  createdAt: z.string().max(40),
}).strict();
export type RegistrationBundle = z.infer<typeof bundleSchema>;

export function buildRegistrationBundle(input: Omit<RegistrationBundle, "version" | "target" | "createdAt" | "configVersion"> & { configVersion?: number }): RegistrationBundle {
  return bundleSchema.parse({ version: 1, target: "production", configVersion: 1, createdAt: new Date().toISOString(), ...input });
}
export function parseRegistrationBundle(text: string | undefined): RegistrationBundle {
  if (!text) return refuse("BUNDLE_REQUIRED");
  try { return bundleSchema.parse(JSON.parse(text)); } catch { return refuse("BUNDLE_INVALID"); }
}
