import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";
import type { PcscBridge } from "../src/lib/nfc-provision/pcsc";
import type { PreviewRepository } from "../src/lib/nfc-provision/preview-run";
import type { PreparedPlan } from "../src/lib/nfc-provision/prepared";
import { offlineOperatorPlan, operatorMode, parseOperatorOptions, type OperatorOptions as Options } from "./nfc-operator-mode";
function required(values: Options, name: string): string {
  if (!values[name]) throw new Error(`--${name} is required`);
  return values[name];
}
async function confirm(prompt: string, expected: string): Promise<boolean> {
  if (!process.stdin.isTTY) throw new Error("Interactive operator terminal required");
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await terminal.question(prompt)).trim() === expected; }
  finally { terminal.close(); }
}
async function loadEnvironment(filename: string): Promise<void> {
  const env = parse(await readFile(filename));
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}
async function selectCard(bridge: PcscBridge, readerName: string) {
  const readers = await bridge.readers();
  console.log(`PC/SC readers: ${readers.length}`);
  for (const item of readers) console.log(`  ${item}`);
  if (!readers.includes(readerName)) throw new Error("Selected reader is unavailable");
  const deadline = Date.now() + 30_000;
  while (true) {
    try { return await bridge.connect(readerName); }
    catch (error) { if (Date.now() > deadline) throw error; await new Promise(resolve => setTimeout(resolve, 1000)); }
  }
}
async function databaseRepository(prepared?: PreparedPlan): Promise<{ repository: PreviewRepository; status: (actor: string, id: string) => Promise<unknown>; revoke: (actor: string, id: string) => Promise<unknown>; close: () => Promise<void> }> {
  const { and, eq } = await import("drizzle-orm");
  const [{ db, pool }, schema, tap] = await Promise.all([import("../src/db"), import("../src/db/schema"), import("../src/lib/secure-tap")]);
  const { programs, staffRoles, secureTags } = schema;
  async function owner(actor: string, tenant: string) {
    const [role] = await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, tenant), eq(staffRoles.userId, actor), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!role) throw new Error("Active owner role required");
  }
  const repository: PreviewRepository = {
    async assertReservationAvailable(plan) {
      const { or } = await import("drizzle-orm");
      const rows = await db.select({ id: secureTags.id }).from(secureTags).where(or(eq(secureTags.uid, plan.uid), eq(secureTags.publicRef, plan.publicRef)));
      if (rows.length) throw new Error("PLAN_RESERVATION_EXISTS; stop for review");
    },
    async findReservation(plan) {
      const rows = await db.select({ id: secureTags.id, publicRef: secureTags.publicRef }).from(secureTags).where(and(eq(secureTags.uid, plan.uid), eq(secureTags.publicRef, plan.publicRef), eq(secureTags.keyRef, plan.keyRef), eq(secureTags.status, "provisioned")));
      if (rows.length !== 1) throw new Error("PLAN_RESERVATION_UNAVAILABLE");
      return rows[0];
    },
    async checkTarget({ actorUserId, programId }) {
      const [program] = await db.select().from(programs).where(eq(programs.id, programId));
      if (!program) throw new Error("Programme not found");
      await owner(actorUserId, program.tenantId);
      if (program.type !== "stamp" || program.earningMode !== "manual" || program.status !== "active" || program.tapMode === "disabled" || !program.tapCooldownSeconds) throw new Error("Approved active fixed-stamp tap policy and cooldown required");
      return { tenantId: program.tenantId, locationId: program.locationId, programId: program.id, mode: program.tapMode, cooldownSeconds: program.tapCooldownSeconds };
    },
    async reserve({ actorUserId, programId, uid, keyRef, publicRef }) {
      return tap.provisionSecureTag({ actorUserId, programId, uid, keyRef, publicRef, configVersion: 1, expectedPolicy: prepared?.binding });
    },
    async verifyMapping(expected) {
      const rows = await db.select({ id: secureTags.id, publicRef: secureTags.publicRef, uid: secureTags.uid, tenantId: secureTags.tenantId, locationId: secureTags.locationId, programId: secureTags.programId, keyRef: secureTags.keyRef, status: secureTags.status }).from(secureTags).where(eq(secureTags.uid, expected.uid));
      const tag = rows[0];
      if (rows.length !== 1 || !tag || tag.id !== expected.tagId || tag.publicRef !== expected.publicRef || tag.tenantId !== expected.tenantId || tag.locationId !== expected.locationId || tag.programId !== expected.programId || tag.status !== "provisioned" || (expected.keyRef && tag.keyRef !== expected.keyRef)) throw new Error("Tag database mapping mismatch");
    },
    async activate({ actorUserId, tagId, initialCounter }) { await tap.activateSecureTag({ actorUserId, tagId, initialCounter, expectedPolicy: prepared?.binding, expectedTag: prepared ? { uid: prepared.uid, publicRef: prepared.publicRef, keyRef: prepared.keyRef } : undefined }); },
    async fail({ actorUserId, tagId }) { await tap.revokeSecureTag({ actorUserId, tagId }); },
  };
  async function status(actor: string, id: string) {
      const [tag] = await db.select({ id: secureTags.id, publicRef: secureTags.publicRef, uid: secureTags.uid, tenantId: secureTags.tenantId, locationId: secureTags.locationId, programId: secureTags.programId, status: secureTags.status, lastCounter: secureTags.lastCounter }).from(secureTags).where(eq(secureTags.id, id));
      if (!tag) throw new Error("Tag not found");
      await owner(actor, tag.tenantId);
      return tag;
  }
  return { repository, status, async revoke(actor: string, id: string) { await status(actor, id); return tap.revokeSecureTag({ actorUserId: actor, tagId: id }); }, async close() { await pool.end(); } };
}
async function main() {
  const command = process.argv[2];
  const opts = parseOperatorOptions(process.argv.slice(3));
  const mode = operatorMode(command, opts);
  if (mode === "offline_dry_run") {
    const target = required(opts, "target");
    if (target !== "preview" && target !== "production") throw new Error("--target must be preview or production");
    if (command === "tag-revoke" && target !== "preview") throw new Error("tag-revoke is a preview command");
    if (opts["prepared-custody-file"]) {
      if (target !== "preview" || (command !== "provision" && command !== "resume")) throw new Error("Prepared custody is preview-only");
      const { loadPreparedCustody, assertApprovedPlan, planSummary, disposePreparedPlan } = await import("../src/lib/nfc-provision/prepared");
      const { simulatePreparedPlan } = await import("../src/lib/nfc-provision/preview-run");
      const plan = await loadPreparedCustody({ bundlePath: opts["prepared-custody-file"], identityPath: required(opts, "age-identity-file"), target });
      try {
        if (opts["approved-plan-fingerprint"]) assertApprovedPlan(plan, opts["approved-plan-fingerprint"]);
        console.log(JSON.stringify({ mode: "PREPARED_OFFLINE_CPU_SIMULATION", plan: planSummary(plan), simulation: await simulatePreparedPlan(plan) }));
      } finally { disposePreparedPlan(plan); }
      return;
    }
    for (const line of offlineOperatorPlan(command, target)) console.log(line);
    return;
  }
  const { PcscBridge } = await import("../src/lib/nfc-provision/pcsc");
  if (command === "reader-check") {
    const { getVersion } = await import("../src/lib/nfc-provision/ntag");
    const bridge = new PcscBridge();
    try {
      const readers = await bridge.readers();
      console.log(`PC/SC transport: available; readers: ${readers.length}`);
      for (const item of readers) console.log(`  ${item}`);
      if (!opts.reader) { console.log("CARD/NTAG APDU: NOT RUN (select --reader)"); return; }
      const card = await selectCard(bridge, opts.reader);
      const version = await getVersion(bridge);
      console.log(`CARD: detected; protocol ${card.protocol}; ATR ${card.atr}; NTAG 424 DNA GetVersion PASS; UID ${version.uid}`);
      console.log("READER COMPATIBILITY: PRELIMINARY READ-ONLY PASS; secure writes remain NOT RUN");
    } finally { await bridge.close(); }
    return;
  }
  if (command === "tag-inspect") {
    const { EvidenceJournal } = await import("../src/lib/nfc-provision/evidence");
    const { inspectChip } = await import("../src/lib/nfc-provision/production-run");
    // READ-ONLY: identity, classification from unauthenticated reads, and the evidence journal. No keys, no writes.
    const bridge = new PcscBridge();
    try {
      await selectCard(bridge, required(opts, "reader"));
      const found = await inspectChip({ transport: bridge, journal: new EvidenceJournal() });
      console.log(`UID ${found.uid}; file settings ${found.fileSettings}; condition ${found.condition}; evidence ${found.evidence} (${found.evidenceDetail})`);
    } finally { await bridge.close(); }
    return;
  }
  const target = required(opts, "target");
  if (target !== "preview" && target !== "production") throw new Error("--target must be preview or production");
  if (target === "production") {
    if (command !== "provision" && command !== "resume") throw new Error("Production supports provision (dry run unless --execute) and resume");
    const { loadTransportKeyCustody } = await import("./nfc-operator-keys");
    const custody = await loadTransportKeyCustody(required(opts, "transport-keys-file"));
    await loadEnvironment(required(opts, "env-file"));
    const { EvidenceJournal } = await import("../src/lib/nfc-provision/evidence");
    const { resumeProductionProvisioning, runProductionProvisioning } = await import("../src/lib/nfc-provision/production-run");
    const origin = process.env.PRODUCTION_APPROVED_ORIGIN ?? "";
    const cooldown = Number(required(opts, "cooldown-seconds"));
    if (!Number.isInteger(cooldown) || cooldown < 1 || cooldown > 86400) throw new Error("Invalid cooldown");
    const bridge = new PcscBridge();
    try {
      await selectCard(bridge, required(opts, "reader"));
      const common = {
        transport: bridge, journal: new EvidenceJournal(), env: process.env, origin,
        provenanceRef: opts["provenance-ref"],
        ...custody,
        binding: { tenantId: required(opts, "tenant-id"), locationId: required(opts, "location-id"), programId: required(opts, "program-id"), cooldownSeconds: cooldown },
        async confirm(summary: { uid: string; text: string }) { console.log(summary.text); return confirm(`Type ${command === "resume" ? "RESUME" : "PROVISION"} ${summary.uid} to continue: `, `${command === "resume" ? "RESUME" : "PROVISION"} ${summary.uid}`); },
      };
      const outcome = command === "resume" ? await resumeProductionProvisioning({ ...common, execute: true }) : await runProductionProvisioning({ ...common, execute: true });
      if (outcome.mode === "dry_run") {
        console.log(`DRY RUN: nothing was changed. Origin ${origin}.`);
        if (outcome.blockedBy) console.log(`BLOCKED: ${outcome.blockedBy}`);
        else { console.log("Would: " + outcome.wouldChange.join("; ")); console.log("Run again with --execute to proceed (typed confirmation required)."); }
        return;
      }
      console.log(`Chip ${outcome.inspection.uid}: ${outcome.inspection.condition}; evidence ${outcome.inspection.evidence} (${outcome.inspection.evidenceDetail})`);
      const { deliverRegistrationBundle } = await import("./nfc-operator-bundle");
      const file = await deliverRegistrationBundle(outcome.bundle);
      console.log(`PASS: tag provisioned for ${origin}. Registration bundle (no secrets): ${file}. Key material was not printed. The tag stays unusable until it is registered on production.`);
    } finally { await bridge.close(); }
    return;
  }
  if (command === "provision" || command === "resume") {
    const { loadPreparedCustody, assertApprovedPlan, planSummary, typedPlanConfirmation, disposePreparedPlan } = await import("../src/lib/nfc-provision/prepared");
    const plan = await loadPreparedCustody({ bundlePath: required(opts, "prepared-custody-file"), identityPath: required(opts, "age-identity-file"), target });
    try {
      assertApprovedPlan(plan, required(opts, "approved-plan-fingerprint"));
      for (const [option, expected] of [["actor-user-id", plan.binding.actorUserId], ["program-id", plan.binding.programId], ["tenant-id", plan.binding.tenantId], ["location-id", plan.binding.locationId], ["cooldown-seconds", String(plan.binding.cooldownSeconds)], ["provenance-ref", plan.provenanceRef]] as const) {
        if (opts[option] && opts[option] !== expected) throw new Error("PLAN_OPTION_MISMATCH");
      }
      if (opts["transport-keys-file"]) throw new Error("PREPARED_CUSTODY_ONLY: current credentials are in the approved bundle");
      await loadEnvironment(required(opts, "env-file"));
      const { assertProvisioningEnvironment } = await import("../src/lib/nfc-provision/operator-safety");
      assertProvisioningEnvironment(process.env, plan.origin);
      if (process.env.PRODUCTION_ENVIRONMENT) throw new Error("PREVIEW_PRODUCTION_MARKER_FORBIDDEN");
      const { EvidenceJournal } = await import("../src/lib/nfc-provision/evidence");
      const { runPreparedPreview } = await import("../src/lib/nfc-provision/preview-run");
      const database = await databaseRepository(plan);
      const reader = required(opts, "reader");
      const bridge = new PcscBridge();
      try {
        console.log(JSON.stringify(planSummary(plan)));
        await selectCard(bridge, reader);
        await runPreparedPreview({ plan, approvedFingerprint: opts["approved-plan-fingerprint"], env: process.env, transport: bridge, repository: database.repository, journal: new EvidenceJournal(), resume: command === "resume", confirm: async () => {
          const typed = typedPlanConfirmation(plan, command === "resume");
          return confirm(`Type ${typed} to authorize this exact preview plan: `, typed);
        } });
        console.log(`PASS: ${plan.tag}; preview plan ${plan.fingerprint}; prepared keys unchanged; no key generation.`);
      } catch { throw new Error("PREPARED_PREVIEW_STOPPED: preserve journal and custody; review before recovery"); }
      finally { await bridge.close(); await database.close(); }
    } finally { disposePreparedPlan(plan); }
    return;
  }
  await loadEnvironment(required(opts, "env-file"));
  const { assertProvisioningEnvironment } = await import("../src/lib/nfc-provision/operator-safety");
  assertProvisioningEnvironment(process.env, process.env.DEVICE_TEST_APPROVED_ORIGIN ?? "");
  const actor = required(opts, "actor-user-id");
  if (!/^[0-9a-f-]{36}$/i.test(actor)) throw new Error("Invalid owner user ID");
  const database = await databaseRepository();
  try {
    const tagId = required(opts, "tag-id");
    console.log(await database.status(actor, tagId));
    if (command === "tag-revoke") {
      if (!await confirm(`Type REVOKE ${tagId} to block future tap awards: `, `REVOKE ${tagId}`)) throw new Error("Revocation not confirmed");
      console.log(await database.revoke(actor, tagId));
    }
  } finally { await database.close(); }
}
main().catch(error => { console.error(`FAIL: ${error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "operator command failed"}`); process.exitCode = 1; });
