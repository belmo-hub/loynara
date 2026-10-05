import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import { ndefTemplate, type DevelopmentKeys } from "./ntag";

const hash = (value: Buffer | string) => createHash("sha256").update(value).digest("hex");
const hexKey = z.string().regex(/^[a-f0-9]{32}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const uid = z.string().regex(/^[a-f0-9]{14}$/);
const ref = z.string().regex(/^[A-Za-z0-9_-]{24}$/);
const fields = ["key0", "fileReadKey", "metaReadKey", "key3", "key4"] as const;
const shared = z.object({ classification: z.literal("TAG01_PREVIEW_NON_PRODUCTION"), tag: z.literal("TAG-01"), uid, keyRef: z.string().regex(/^dev_[A-Za-z0-9_-]{1,76}$/), publicRef: ref, origin: z.literal("https://preview.getloynara.com"), keyModel: z.literal("five independent development AES-128 keys; no masters"), expectedKeyVersions: z.tuple([z.literal(1), z.literal(1), z.literal(1), z.literal(1), z.literal(1)]) });
const schema = z.object({
  format: z.literal("LOY NARA TAG01 PREVIEW CUSTODY BACKUP v1"), shared,
  admin: shared.extend({ role: z.literal("OPERATOR_ADMIN_ONLY"), key0: hexKey, key3: hexKey, key4: hexKey }),
  verification: shared.extend({ role: z.literal("PREVIEW_VERIFICATION_ONLY"), fileReadKey: hexKey, metaReadKey: hexKey }),
  transport: shared.extend({ role: z.literal("VERIFIED_CURRENT_TRANSPORT_STATE"), key0: hexKey, fileReadKey: hexKey, metaReadKey: hexKey, key3: hexKey, key4: hexKey }),
  binding: z.object({ tenantId: z.uuid(), locationId: z.uuid(), programId: z.uuid(), actorUserId: z.uuid(), cooldownSeconds: z.number().int().min(1).max(86400), mode: z.literal("staff_confirmed") }),
  fingerprints: z.object({ key0: digest, fileReadKey: digest, metaReadKey: digest, key3: digest, key4: digest }),
  authEvidence: z.object({ tag: z.literal("TAG-01"), uid_match: z.literal("PASS"), mutating_apdus_sent: z.literal(0), authentication_attempts: z.tuple([z.literal(1), z.literal(1), z.literal(1), z.literal(1), z.literal(1)]), keys: z.array(z.object({ slot: z.number().int(), result: z.literal("PASS") })).length(5) }),
  acceptanceEvidence: z.object({ tag: z.literal("TAG-01"), uid }),
});

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
type PublicPlan = {
  version: 1; tag: "TAG-01"; target: "preview"; origin: string; uid: string; keyRef: string; publicRef: string;
  custodyId: string; provenanceRef: string; policy: "ntag424-preview-v1";
  binding: z.infer<typeof schema>["binding"];
  slots: { slot: number; field: typeof fields[number]; role: "admin" | "verification"; version: 1; fingerprint: string }[];
  ndefHex: string; url: string; settingsHex: string; expectedSettingsHex: string; expectedOriginalSettingsHex: string; expectedNlen: 0;
};
export type PreparedPlan = Readonly<PublicPlan & { fingerprint: string }>;
const secrets = new WeakMap<PreparedPlan, { keys: DevelopmentKeys; current: DevelopmentKeys }>();
function invalid(): never { throw new Error("CUSTODY_INVALID"); }
function buffers(value: Record<typeof fields[number], string>): DevelopmentKeys { return Object.fromEntries(fields.map(name => [name, Buffer.from(value[name], "hex")])) as DevelopmentKeys; }
function copies(keys: DevelopmentKeys): DevelopmentKeys { return Object.fromEntries(fields.map(name => [name, Buffer.from(keys[name])])) as DevelopmentKeys; }

/** Decrypted custody is input only; the serializable immutable plan contains no credentials. */
export function normalizePreparedCustody(raw: unknown, ciphertextSha256: string, target: string): PreparedPlan {
  try {
    if (target !== "preview" || !digest.safeParse(ciphertextSha256).success) invalid();
    const value = schema.parse(raw);
    for (const side of [value.admin, value.verification, value.transport]) {
      for (const name of Object.keys(value.shared) as (keyof typeof value.shared)[]) if (canonical(side[name]) !== canonical(value.shared[name])) invalid();
    }
    const original = raw as Record<string, Record<string, unknown>>;
    if (["fileReadKey", "metaReadKey"].some(k => k in original.admin) || ["key0", "key3", "key4"].some(k => k in original.verification)) invalid();
    if (value.acceptanceEvidence.uid !== value.shared.uid || value.authEvidence.keys.some((k, i) => k.slot !== i)) invalid();
    const encoded = { key0: value.admin.key0, key3: value.admin.key3, key4: value.admin.key4, fileReadKey: value.verification.fileReadKey, metaReadKey: value.verification.metaReadKey };
    if (new Set(Object.values(encoded)).size !== 5) invalid();
    for (const name of fields) if (hash(Buffer.from(encoded[name], "hex")) !== value.fingerprints[name]) invalid();
    const template = ndefTemplate(value.shared.origin, value.shared.publicRef);
    const publicPlan: PublicPlan = {
      version: 1, tag: "TAG-01", target: "preview", origin: value.shared.origin, uid: value.shared.uid,
      keyRef: value.shared.keyRef, publicRef: value.shared.publicRef, custodyId: ciphertextSha256,
      provenanceRef: "TAG01-transport-auth-verified-20261005", policy: "ntag424-preview-v1", binding: value.binding,
      slots: fields.map((field, slot) => ({ slot, field, role: slot === 1 || slot === 2 ? "verification" : "admin", version: 1, fingerprint: value.fingerprints[field] })),
      ndefHex: template.bytes.toString("hex"), url: template.url, settingsHex: template.settings.toString("hex"),
      expectedSettingsHex: Buffer.concat([Buffer.from("004000e0000100", "hex"), template.settings.subarray(3)]).toString("hex"), expectedOriginalSettingsHex: "0000e0ee000100", expectedNlen: 0,
    };
    const plan = freeze({ ...publicPlan, fingerprint: hash(canonical(publicPlan)) });
    secrets.set(plan, { keys: buffers(encoded), current: buffers(value.transport) });
    return plan;
  } catch { return invalid(); }
}

async function restrictedFile(filename: string, maxSize: number): Promise<Buffer> {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > maxSize) invalid();
    return await file.readFile();
  } finally { await file.close(); }
}

/** age reads ciphertext and identity through pipes; no temporary plaintext files or secret arguments. */
export async function loadPreparedCustody(input: { bundlePath: string; identityPath: string; target: string }): Promise<PreparedPlan> {
  let identity: Awaited<ReturnType<typeof open>> | undefined;
  let decrypted: Buffer | undefined;
  try {
    const cipher = await restrictedFile(input.bundlePath, 1024 * 1024);
    identity = await open(input.identityPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await identity.stat();
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > 4096) invalid();
    const child = spawnSync("age", ["--decrypt", "--identity", "/dev/fd/3"], { input: cipher, stdio: ["pipe", "pipe", "pipe", identity.fd], maxBuffer: 1024 * 1024, timeout: 15000 });
    decrypted = child.stdout;
    if (child.status !== 0 || !decrypted || child.error) invalid();
    return normalizePreparedCustody(JSON.parse(decrypted.toString("utf8")), hash(cipher), input.target);
  } catch { return invalid(); }
  finally { await identity?.close(); decrypted?.fill(0); }
}

export function assertApprovedPlan(plan: PreparedPlan, approved: string | undefined): void {
  if (!secrets.has(plan) || !approved || approved !== plan.fingerprint) throw new Error("PLAN_APPROVAL_MISMATCH");
}
export function planKeys(plan: PreparedPlan): DevelopmentKeys { const value = secrets.get(plan); if (!value) invalid(); return copies(value.keys); }
export function currentPlanKeys(plan: PreparedPlan): DevelopmentKeys { const value = secrets.get(plan); if (!value) invalid(); return copies(value.current); }
export function disposePreparedPlan(plan: PreparedPlan): void { const value = secrets.get(plan); if (value) for (const keys of [value.keys, value.current]) for (const key of Object.values(keys)) key.fill(0); secrets.delete(plan); }
export function planSummary(plan: PreparedPlan) {
  const { uid: restrictedUid, ndefHex: rawImage, ...summary } = plan;
  void restrictedUid;
  void rawImage;
  return { ...summary, uidBinding: "restricted custody; physical match required at execution", keyGeneration: "NONE" };
}
export function planEvidence(plan: PreparedPlan): Record<string, string> {
  return { journalVersion: "2", uid: plan.uid, keyRef: plan.keyRef, publicRef: plan.publicRef, origin: plan.origin, tenantId: plan.binding.tenantId, locationId: plan.binding.locationId, programId: plan.binding.programId, cooldownSeconds: String(plan.binding.cooldownSeconds), provenanceRef: plan.provenanceRef, tagLabel: plan.tag, environment: plan.target, planFingerprint: plan.fingerprint, custodyId: plan.custodyId, slotFingerprints: JSON.stringify(plan.slots), settingsHex: plan.settingsHex, policy: plan.policy };
}
export function typedPlanConfirmation(plan: PreparedPlan, resume = false): string { return `${resume ? "RESUME" : "PROVISION"} ${plan.tag} ${plan.fingerprint}`; }
