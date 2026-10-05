import { randomBytes } from "node:crypto";
import { deriveTagKeys } from "../nfc-keys";
import { completeProvisioning, provisionPhysicalTag, ProvisionUncertain, type ProvisionIntent, type ProvisionStage, type ProvisionTag } from "./flow";
import { analyseEvidence, type EvidenceEvent, type EvidenceJournal } from "./evidence";
import { classifyFileSettings, type TagCondition } from "./inspect";
import { assertProductionOperatorEnvironment, assertTagOrigin, bindingSchema, buildRegistrationBundle, offlineRepository, type Binding, type RegistrationBundle } from "./production";
import { ndefTemplate } from "./ntag";
import { Ntag424, type ApduTransport, type DevelopmentKeys, type Version } from "./ntag";
import { assertCurrentKeys, assertProvenance } from "./provenance";

export type Inspection = { uid: string; version: Version; fileSettings: string; condition: TagCondition; evidence: ReturnType<typeof analyseEvidence>["state"]; evidenceDetail: string };
export type ProductionOutcome =
  | { mode: "dry_run"; inspection: Inspection; wouldChange: string[]; blockedBy?: string }
  | { mode: "provisioned" | "resumed"; inspection: Inspection; bundle: RegistrationBundle };

type Common = {
  transport: ApduTransport;
  journal: EvidenceJournal;
  env: Record<string, string | undefined>;
  origin: string;
  binding: Binding;
  provenanceRef?: string;
  currentKeys?: DevelopmentKeys;
  expectedUid?: string;
  tagFactory?(transport: ApduTransport): ProvisionTag;
};

const CHANGES = ["write the NDEF URL to the chip", "change AES keys 1-4 (derived)", "change the NDEF file settings (SDM on, writes need key 0)", "change key 0 last (derived)"];

/** READ-ONLY. Identifies the chip, classifies its state from unauthenticated reads, and reads the evidence journal. */
export async function inspectChip(input: Pick<Common, "transport" | "journal" | "tagFactory">): Promise<Inspection> {
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  const version = await tag.version();
  await tag.reconnect();
  const repeat = await tag.version();
  if (repeat.uid !== version.uid) throw new Error("Presented tag changed during inspection");
  const settings = await tag.readFileSettings();
  const verdict = await input.journal.verdict(version.uid);
  const detail = verdict.state === "uncertain" ? verdict.reason : verdict.state === "resumable" ? `can be finished from ${verdict.lastStage}` : verdict.state;
  return { uid: version.uid, version, fileSettings: settings.toString("hex"), condition: classifyFileSettings(settings), evidence: verdict.state, evidenceDetail: detail };
}

/** Production provisioning. Dry run unless `execute`; an interrupted earlier attempt stops the tool instead of being repeated. */
export async function runProductionProvisioning(input: Common & { execute: boolean; confirm(summary: { uid: string; text: string }): Promise<boolean> }): Promise<ProductionOutcome> {
  if (!input.execute) return provisionAttempt(input);
  assertProvenance(input.provenanceRef); assertCurrentKeys(input.currentKeys);
  if (!input.expectedUid) throw new Error("Custody UID is required");
  return input.journal.withExclusive(input.expectedUid, () => provisionAttempt(input));
}

async function provisionAttempt(input: Common & { execute: boolean; confirm(summary: { uid: string; text: string }): Promise<boolean> }): Promise<ProductionOutcome> {
  bindingSchema.parse(input.binding);
  ndefTemplate(input.origin, "abcdefghijklmnopqrstuvwx"); // capacity/layout before any credential or mutation
  if (input.execute) { assertProvenance(input.provenanceRef); assertCurrentKeys(input.currentKeys); }
  const { verifyMaster, adminMaster } = assertProductionOperatorEnvironment(input.env, input.origin);
  const inspection = await inspectChip(input);
  if (input.execute && input.expectedUid !== inspection.uid) throw new ProvisionUncertain("presented tag does not match current-key custody UID");
  const verdict = await input.journal.verdict(inspection.uid);
  let blockedBy: string | undefined;
  if (verdict.state === "complete") blockedBy = "this chip is already provisioned (see its evidence); use inspection, not provisioning";
  else if (verdict.state === "uncertain") blockedBy = `interrupted earlier: ${verdict.reason}; stop and recover by hand`;
  else if (verdict.state === "resumable") blockedBy = "an earlier attempt can be finished with resume, not restarted";
  else if (verdict.state !== "none") blockedBy = "earlier host preparation exists; do not blindly restart";
  else if (inspection.condition !== "factory") blockedBy = "the chip is not in the factory NDEF state";
  if (!input.execute) return { mode: "dry_run", inspection, wouldChange: blockedBy ? [] : CHANGES, blockedBy };
  if (blockedBy) throw new ProvisionUncertain(blockedBy);

  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const note = (extra: Record<string, string> = {}) => ({ journalVersion: "2", uid: inspection.uid, keyRef, origin: input.origin, tenantId: input.binding.tenantId, locationId: input.binding.locationId, programId: input.binding.programId, cooldownSeconds: String(input.binding.cooldownSeconds), provenanceRef: input.provenanceRef!, ...(publicRef ? { publicRef } : {}), ...extra });
  const base = offlineRepository(input.binding);
  let publicRef = "";
  const repository = { ...base, async reserve(args: Parameters<typeof base.reserve>[0]) { const reserved = await base.reserve(args); publicRef = reserved.publicRef; await input.journal.record(args.uid, { kind: "stage", name: "reserved_ref", note: note({ publicRef }) }); return reserved; } };
  const result = await provisionPhysicalTag({
    transport: input.transport, repository, keyStore: { async save() { /* keys are derived, never stored */ } },
    actorUserId: "operator", programId: input.binding.programId, origin: input.origin, keyRef,
    provenanceRef: input.provenanceRef, currentKeys: input.currentKeys, expectedUid: inspection.uid,
    tagFactory: input.tagFactory,
    keyFactory: ({ uid, keyRef: ref }) => deriveTagKeys({ verifyMaster, adminMaster, ref, uid }),
    assertSafeToStart: async uid => { const state = (await input.journal.verdict(uid)).state; if (state !== "none") throw new ProvisionUncertain(state); },
    confirm: async summary => input.confirm({ uid: summary.uid, text: `UID ${summary.uid}; binding tenant ${summary.mapping.tenantId} location ${summary.mapping.locationId} programme ${summary.mapping.programId}; ${CHANGES.join("; ")}` }),
    onIntent: async (intent: ProvisionIntent) => input.journal.record(inspection.uid, { kind: "intent", name: intent, note: note() }),
    onStage: async (stage: ProvisionStage, proof) => input.journal.record(inspection.uid, { kind: "stage", name: stage, note: note(proof ? { firstCounter: String(proof.firstCounter), secondCounter: String(proof.secondCounter), sampleUrl: proof.sampleUrl } : {}) }),
  }).catch(async error => { await input.journal.record(inspection.uid, { kind: "failure", name: "provisioning_stopped", note: note() }).catch(() => undefined); throw error; });
  const bundle = buildRegistrationBundle({ tenantId: input.binding.tenantId, locationId: input.binding.locationId, programId: input.binding.programId, origin: input.origin, uid: result.uid, publicRef: result.publicRef, keyRef, sampleUrl: result.sampleUrl, firstCounter: result.firstCounter, secondCounter: result.secondCounter });
  return { mode: "provisioned", inspection, bundle };
}

/** Recover only durably acknowledged settings/key-0 states after explicit execution and confirmation. */
export async function resumeProductionProvisioning(input: Common & { execute: boolean; confirm(summary: { uid: string; text: string }): Promise<boolean> }): Promise<ProductionOutcome> {
  if (!input.execute) throw new Error("Resume requires explicit execution; use the offline CLI plan");
  assertProvenance(input.provenanceRef);
  if (!input.expectedUid) throw new Error("Custody UID is required");
  return input.journal.withExclusive(input.expectedUid, () => resumeAttempt(input));
}

async function resumeAttempt(input: Common & { execute: boolean; confirm(summary: { uid: string; text: string }): Promise<boolean> }): Promise<ProductionOutcome> {
  bindingSchema.parse(input.binding);
  ndefTemplate(input.origin, "abcdefghijklmnopqrstuvwx");
  if (!input.execute) throw new Error("Resume requires explicit execution; use the offline CLI plan");
  assertProvenance(input.provenanceRef);
  const { verifyMaster, adminMaster } = assertProductionOperatorEnvironment(input.env, input.origin);
  const inspection = await inspectChip(input);
  if (input.expectedUid !== inspection.uid) throw new ProvisionUncertain("presented tag does not match custody UID");
  const events = await input.journal.read(inspection.uid);
  const verdict = analyseEvidence(events);
  if (verdict.state !== "resumable") throw new ProvisionUncertain(`evidence says "${verdict.state}", not resumable`);
  const ref = [...events].reverse().find(event => event.name === "reserved_ref" && event.note?.publicRef);
  const keyRef = ref?.note?.keyRef; const publicRef = ref?.note?.publicRef;
  if (!keyRef || !publicRef || ref?.note?.origin !== input.origin || ref?.note?.programId !== input.binding.programId || ref?.note?.tenantId !== input.binding.tenantId || ref?.note?.locationId !== input.binding.locationId || ref?.note?.cooldownSeconds !== String(input.binding.cooldownSeconds) || ref?.note?.provenanceRef !== input.provenanceRef) throw new ProvisionUncertain("evidence does not match this exact custody and environment binding");
  const keys = deriveTagKeys({ verifyMaster, adminMaster, ref: keyRef, uid: inspection.uid });
  const done = await completeProvisioning({
    transport: input.transport, origin: input.origin, publicRef, keys, expectedUid: inspection.uid, tagFactory: input.tagFactory,
    provenanceRef: input.provenanceRef, currentKeys: input.currentKeys, key0State: verdict.lastStage === "settings_changed" ? "transport" : "personalized",
    confirm: async summary => input.confirm({ uid: summary.uid, text: `recover ${summary.uid} from acknowledged ${verdict.lastStage}; no alternate-key probes` }),
    onIntent: async intent => input.journal.record(inspection.uid, { kind: "intent", name: intent, note: ref!.note }),
    onStage: async (stage, proof) => input.journal.record(inspection.uid, { kind: "stage", name: stage, note: { ...ref!.note, ...(proof ? { firstCounter: String(proof.firstCounter), secondCounter: String(proof.secondCounter), sampleUrl: proof.sampleUrl } : {}) } }),
  });
  await input.journal.record(inspection.uid, { kind: "stage", name: "active", note: ref!.note });
  const bundle = buildRegistrationBundle({ tenantId: input.binding.tenantId, locationId: input.binding.locationId, programId: input.binding.programId, origin: input.origin, uid: done.uid, publicRef, keyRef, sampleUrl: done.sampleUrl, firstCounter: done.firstCounter, secondCounter: done.secondCounter });
  return { mode: "resumed", inspection, bundle };
}

/** Recover the ORIGINAL proof after lost local bundle delivery: no reader, keys, new counters or DB. */
export function registrationBundleFromEvidence(events: EvidenceEvent[], uid: string): RegistrationBundle {
  if (analyseEvidence(events).state !== "complete") throw new ProvisionUncertain("only completed coherent evidence can export its original proof");
  const proof = [...events].reverse().find(event => event.kind === "stage" && event.name === "readback_verified")?.note;
  if (!proof) throw new Error("Completed evidence has no original proof");
  if (proof.uid !== uid) throw new Error("Original proof belongs to another chip");
  assertTagOrigin("production", proof.origin, { PRODUCTION_APPROVED_ORIGIN: proof.origin });
  const binding = bindingSchema.parse({ tenantId: proof.tenantId, locationId: proof.locationId, programId: proof.programId, cooldownSeconds: Number(proof.cooldownSeconds) });
  const sample = new URL(proof.sampleUrl);
  if (sample.origin !== proof.origin || sample.pathname !== `/tap/${proof.publicRef}` || !/^[a-f0-9]{32}$/i.test(sample.searchParams.get("e") ?? "") || !/^[a-f0-9]{16}$/i.test(sample.searchParams.get("c") ?? "")) throw new Error("Original proof does not match recorded route");
  const bundle = buildRegistrationBundle({ tenantId: binding.tenantId, locationId: binding.locationId, programId: binding.programId, origin: proof.origin, uid, keyRef: proof.keyRef, publicRef: proof.publicRef, sampleUrl: proof.sampleUrl, firstCounter: Number(proof.firstCounter), secondCounter: Number(proof.secondCounter) });
  if (bundle.secondCounter <= bundle.firstCounter) throw new Error("Original proof counter order is invalid");
  return bundle;
}
