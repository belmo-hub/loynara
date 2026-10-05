import { randomBytes } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { parse } from "dotenv";
import type { PcscBridge } from "../src/lib/nfc-provision/pcsc";
import type { ProvisionRepository, ProvisionStage } from "../src/lib/nfc-provision/flow";
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
async function databaseRepository(): Promise<{ repository: ProvisionRepository; status: (actor: string, id: string) => Promise<unknown>; revoke: (actor: string, id: string) => Promise<unknown>; close: () => Promise<void> }> {
  const { and, eq } = await import("drizzle-orm");
  const [{ db, pool }, schema, tap] = await Promise.all([import("../src/db"), import("../src/db/schema"), import("../src/lib/secure-tap")]);
  const { programs, staffRoles, secureTags } = schema;
  async function owner(actor: string, tenant: string) {
    const [role] = await db.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, tenant), eq(staffRoles.userId, actor), eq(staffRoles.role, "owner"), eq(staffRoles.active, true)));
    if (!role) throw new Error("Active owner role required");
  }
  const repository: ProvisionRepository = {
    async checkTarget({ actorUserId, programId }) {
      const [program] = await db.select().from(programs).where(eq(programs.id, programId));
      if (!program) throw new Error("Programme not found");
      await owner(actorUserId, program.tenantId);
      if (program.type !== "stamp" || program.earningMode !== "manual" || program.status !== "active" || program.tapMode === "disabled" || !program.tapCooldownSeconds) throw new Error("Approved active fixed-stamp tap policy and cooldown required");
      return { tenantId: program.tenantId, locationId: program.locationId, programId: program.id, mode: program.tapMode, cooldownSeconds: program.tapCooldownSeconds };
    },
    async reserve({ actorUserId, programId, uid, keyRef }) {
      return tap.provisionSecureTag({ actorUserId, programId, uid, keyRef, configVersion: 1 });
    },
    async verifyMapping(expected) {
      const rows = await db.select({ id: secureTags.id, publicRef: secureTags.publicRef, uid: secureTags.uid, tenantId: secureTags.tenantId, locationId: secureTags.locationId, programId: secureTags.programId, status: secureTags.status }).from(secureTags).where(eq(secureTags.uid, expected.uid));
      const tag = rows[0];
      if (rows.length !== 1 || !tag || tag.id !== expected.tagId || tag.publicRef !== expected.publicRef || tag.tenantId !== expected.tenantId || tag.locationId !== expected.locationId || tag.programId !== expected.programId || tag.status !== "provisioned") throw new Error("Tag database mapping mismatch");
    },
    async activate({ actorUserId, tagId, initialCounter }) { await tap.activateSecureTag({ actorUserId, tagId, initialCounter }); },
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
async function diagnostic(ref: string, stage: ProvisionStage, note: Record<string, string>) {
  const folder = path.resolve("var/nfc-diagnostics");
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const filename = path.join(folder, `${ref}.json`);
  const file = await open(filename, "w", 0o600);
  try { await file.writeFile(JSON.stringify({ classification: "DEVELOPMENT_ONLY", stage, timestamp: new Date().toISOString(), ...note })); await file.sync(); }
  finally { await file.close(); }
}
async function main() {
  const command = process.argv[2];
  const opts = parseOperatorOptions(process.argv.slice(3));
  const mode = operatorMode(command, opts);
  if (mode === "offline_dry_run") {
    const target = required(opts, "target");
    if (target !== "preview" && target !== "production") throw new Error("--target must be preview or production");
    if (command === "resume" && target !== "production") throw new Error("resume is a production command");
    if (command === "tag-revoke" && target !== "preview") throw new Error("tag-revoke is a preview command");
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
  if (command === "resume") throw new Error("resume is a production command");
  const custody = command === "provision" ? await (await import("./nfc-operator-keys")).loadTransportKeyCustody(required(opts, "transport-keys-file")) : undefined;
  await loadEnvironment(required(opts, "env-file"));
  const { assertProvisioningEnvironment, DevelopmentKeyStore } = await import("../src/lib/nfc-provision/operator-safety");
  const origin = process.env.DEVICE_TEST_APPROVED_ORIGIN ?? "";
  assertProvisioningEnvironment(process.env, origin);
  const actor = required(opts, "actor-user-id");
  if (!/^[0-9a-f-]{36}$/i.test(actor)) throw new Error("Invalid owner user ID");
  if (command === "provision") { required(opts, "program-id"); required(opts, "reader"); }
  const database = await databaseRepository();
  if (command === "tag-status" || command === "tag-revoke") {
    try {
      const tagId = required(opts, "tag-id");
      console.log(await database.status(actor, tagId));
      if (command === "tag-revoke") {
        if (!await confirm(`Type REVOKE ${tagId} to block future tap awards: `, `REVOKE ${tagId}`)) throw new Error("Revocation not confirmed");
        console.log(await database.revoke(actor, tagId));
      }
    } finally { await database.close(); }
    return;
  }
  const programId = required(opts, "program-id");
  const readerName = required(opts, "reader");
  const { EvidenceJournal } = await import("../src/lib/nfc-provision/evidence");
  const { provisionPhysicalTag } = await import("../src/lib/nfc-provision/flow");
  const journal = new EvidenceJournal();
  let evidenceUid: string | undefined;
  const bridge = new PcscBridge();
  const keyRef = `dev_${randomBytes(18).toString("base64url")}`;
  let lastStage: ProvisionStage = "preflight";
  let diagnosticNote: Record<string, string> = { programId, origin, reader: readerName };
  const evidenceNote = () => ({ journalVersion: "2", uid: evidenceUid!, keyRef, programId, origin, provenanceRef: opts["provenance-ref"], tenantId: diagnosticNote.tenantId, locationId: diagnosticNote.locationId, cooldownSeconds: diagnosticNote.cooldownSeconds });
  try {
    const card = await selectCard(bridge, readerName);
    console.log(`PC/SC selected: ${readerName}; ${card.protocol}; ATR ${card.atr}`);
    const result = await journal.withExclusive(custody!.expectedUid, () => provisionPhysicalTag({
      transport: bridge,
      repository: database.repository,
      keyStore: new DevelopmentKeyStore(),
      actorUserId: actor, programId, origin, keyRef,
      provenanceRef: opts["provenance-ref"],
      ...custody,
      async assertSafeToStart(uid) {
        if ((await journal.verdict(uid)).state !== "none") throw new Error("Prior provisioning evidence blocks restart; inspect and recover the recorded attempt");
        evidenceUid = uid;
      },
      async confirm(summary) {
        diagnosticNote = { ...diagnosticNote, uid: summary.uid, originalFileSettings: summary.originalFileSettings, tenantId: summary.mapping.tenantId, locationId: summary.mapping.locationId, cooldownSeconds: String(summary.mapping.cooldownSeconds) };
        console.log(`NTAG 424 DNA UID: ${summary.uid}; original NDEF settings: ${summary.originalFileSettings}`);
        console.log(`Mapping: tenant ${summary.mapping.tenantId}; location ${summary.mapping.locationId}; programme ${summary.mapping.programId}; mode ${summary.mapping.mode}; cooldown ${summary.mapping.cooldownSeconds}s`);
        console.log("This will replace the five explicitly supplied current AES keys, write NDEF, and restrict NDEF/settings writes. Development keys stay in ignored mode-0600 var/ storage.");
        return confirm(`Type PROVISION ${summary.uid} to continue: `, `PROVISION ${summary.uid}`);
      },
      async onIntent(intent) {
        if (!evidenceUid) throw new Error("Chip evidence UID is required before mutations");
        await journal.record(evidenceUid, { kind: "intent", name: intent, note: evidenceNote() });
      },
      async onStage(stage) {
        if (!evidenceUid) throw new Error("Chip evidence UID is required before stage recording");
        await journal.record(evidenceUid, { kind: "stage", name: stage, note: evidenceNote() });
        lastStage = stage; await diagnostic(keyRef, stage, diagnosticNote);
      },
    }));
    console.log(`PASS: tag ${result.tagId} active for ${programId}; counters ${result.firstCounter} -> ${result.secondCounter}. Key material was not printed.`);
  } catch (error) {
    if (evidenceUid) await journal.record(evidenceUid, { kind: "failure", name: "provisioning_stopped", note: evidenceNote() }).catch(() => undefined);
    await diagnostic(keyRef, lastStage, { ...diagnosticNote, result: "FAILED_OR_INTERRUPTED" }).catch(() => undefined);
    throw error;
  } finally { await bridge.close(); await database.close(); }
}
main().catch(error => { console.error(`FAIL: ${error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "operator command failed"}`); process.exitCode = 1; });
