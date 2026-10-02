import { randomBytes } from "node:crypto";
import { deriveTagKeys } from "../nfc-keys";
import { completeProvisioning, provisionPhysicalTag, ProvisionUncertain, type ProvisionIntent, type ProvisionStage, type ProvisionTag } from "./flow";
import { analyseEvidence, type EvidenceJournal } from "./evidence";
import { classifyFileSettings, type TagCondition } from "./inspect";
import { assertProductionOperatorEnvironment, buildRegistrationBundle, offlineRepository, type Binding, type RegistrationBundle } from "./production";
import { Ntag424, type ApduTransport, type Version } from "./ntag";

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
  const { verifyMaster, adminMaster } = assertProductionOperatorEnvironment(input.env, input.origin);
  const inspection = await inspectChip(input);
  const verdict = await input.journal.verdict(inspection.uid);
  let blockedBy: string | undefined;
  if (verdict.state === "complete") blockedBy = "this chip is already provisioned (see its evidence); use inspection, not provisioning";
  else if (verdict.state === "uncertain") blockedBy = `interrupted earlier: ${verdict.reason}; stop and recover by hand`;
  else if (verdict.state === "resumable") blockedBy = "an earlier attempt can be finished with resume, not restarted";
  else if (inspection.condition !== "factory") blockedBy = "the chip is not in the factory NDEF state";
  if (!input.execute) return { mode: "dry_run", inspection, wouldChange: blockedBy ? [] : CHANGES, blockedBy };
  if (blockedBy) throw new ProvisionUncertain(blockedBy);

  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const note = (extra: Record<string, string> = {}) => ({ keyRef, origin: input.origin, programId: input.binding.programId, ...extra });
  const base = offlineRepository(input.binding);
  let publicRef = "";
  const repository = { ...base, async reserve(args: Parameters<typeof base.reserve>[0]) { const reserved = await base.reserve(args); publicRef = reserved.publicRef; await input.journal.record(args.uid, { kind: "stage", name: "reserved_ref", note: note({ publicRef }) }); return reserved; } };
  const result = await provisionPhysicalTag({
    transport: input.transport, repository, keyStore: { async save() { /* keys are derived, never stored */ } },
    actorUserId: "operator", programId: input.binding.programId, origin: input.origin, keyRef,
    tagFactory: input.tagFactory,
    keyFactory: ({ uid, keyRef: ref }) => deriveTagKeys({ verifyMaster, adminMaster, ref, uid }),
    assertSafeToStart: async uid => { const state = (await input.journal.verdict(uid)).state; if (state !== "none" && state !== "restartable") throw new ProvisionUncertain(state); },
    confirm: async summary => input.confirm({ uid: summary.uid, text: `UID ${summary.uid}; binding tenant ${summary.mapping.tenantId} location ${summary.mapping.locationId} programme ${summary.mapping.programId}; ${CHANGES.join("; ")}` }),
    onIntent: async (intent: ProvisionIntent) => input.journal.record(inspection.uid, { kind: "intent", name: intent, note: note() }),
    onStage: async (stage: ProvisionStage) => input.journal.record(inspection.uid, { kind: "stage", name: stage, note: note() }),
  }).catch(async error => { await input.journal.record(inspection.uid, { kind: "failure", name: "provisioning_stopped", note: note() }).catch(() => undefined); throw error; });
  const bundle = buildRegistrationBundle({ tenantId: input.binding.tenantId, locationId: input.binding.locationId, programId: input.binding.programId, origin: input.origin, uid: result.uid, publicRef: result.publicRef, keyRef, sampleUrl: result.sampleUrl, firstCounter: result.firstCounter, secondCounter: result.secondCounter });
  return { mode: "provisioned", inspection, bundle };
}

/** Finish a provisioning that stopped after the file settings changed. Needs the operator's explicit confirmation of the key-0 probe. */
export async function resumeProductionProvisioning(input: Common & { confirm(summary: { uid: string; text: string }): Promise<boolean> }): Promise<ProductionOutcome> {
  const { verifyMaster, adminMaster } = assertProductionOperatorEnvironment(input.env, input.origin);
  const inspection = await inspectChip(input);
  const events = await input.journal.read(inspection.uid);
  const verdict = analyseEvidence(events);
  if (verdict.state !== "resumable") throw new ProvisionUncertain(`evidence says "${verdict.state}", not resumable`);
  const ref = [...events].reverse().find(event => event.name === "reserved_ref" && event.note?.publicRef);
  const keyRef = ref?.note?.keyRef; const publicRef = ref?.note?.publicRef;
  if (!keyRef || !publicRef || ref?.note?.origin !== input.origin || ref?.note?.programId !== input.binding.programId) throw new ProvisionUncertain("evidence does not match this origin and programme");
  const keys = deriveTagKeys({ verifyMaster, adminMaster, ref: keyRef, uid: inspection.uid });
  const done = await completeProvisioning({
    transport: input.transport, origin: input.origin, publicRef, keys, expectedUid: inspection.uid, tagFactory: input.tagFactory,
    confirm: async summary => input.confirm({ uid: summary.uid, text: `finish key 0 for ${summary.uid}: up to two authentication attempts` }),
    onIntent: async intent => input.journal.record(inspection.uid, { kind: "intent", name: intent, note: { keyRef } }),
    onStage: async stage => input.journal.record(inspection.uid, { kind: "stage", name: stage, note: { keyRef } }),
  });
  await input.journal.record(inspection.uid, { kind: "stage", name: "active", note: { keyRef } });
  const bundle = buildRegistrationBundle({ tenantId: input.binding.tenantId, locationId: input.binding.locationId, programId: input.binding.programId, origin: input.origin, uid: done.uid, publicRef, keyRef, sampleUrl: done.sampleUrl, firstCounter: done.firstCounter, secondCounter: done.secondCounter });
  return { mode: "resumed", inspection, bundle };
}
