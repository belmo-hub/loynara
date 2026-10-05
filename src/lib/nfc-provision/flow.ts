import { Ntag424, ndefTemplate, verifyDynamicNdef, type ApduTransport, type DevelopmentKeys, type Version } from "./ntag";
import { verifySdm } from "../secure-tap-crypto";
import { assertCurrentKeys, assertProvenance } from "./provenance";

export interface ProvisionRepository {
  checkTarget(input: { actorUserId: string; programId: string; replacesTagId?: string }): Promise<{ tenantId: string; locationId: string; programId: string; mode: string; cooldownSeconds: number }>;
  reserve(input: { actorUserId: string; programId: string; uid: string; keyRef: string; replacesTagId?: string; publicRef?: string }): Promise<{ id: string; publicRef: string }>;
  verifyMapping(input: { tagId: string; publicRef: string; uid: string; tenantId: string; locationId: string; programId: string; keyRef?: string }): Promise<void>;
  activate(input: { actorUserId: string; tagId: string; initialCounter: number }): Promise<void>;
  fail(input: { actorUserId: string; tagId: string }): Promise<void>;
}
export interface ProvisionKeyStore { save(ref: string, uid: string, keys: DevelopmentKeys): Promise<void> }
export type ProvisionTag = Pick<Ntag424, "version" | "reconnect" | "readFileSettings" | "writeNdef" | "readNdef" | "authenticateFirst" | "changeKey" | "changeFileSettings">;
/** An operation group that may have changed the tag. Recorded BEFORE it starts, so an interruption leaves the uncertainty on record. */
export type ProvisionIntent = "writing_ndef" | "changing_keys" | "changing_key1" | "changing_key2" | "changing_key3" | "changing_key4" | "changing_settings" | "changing_key0";
export type ProvisionStage = "preflight" | "confirmed" | "keys_saved" | "reserved" | "ndef_written" | "key1_changed" | "key2_changed" | "key3_changed" | "key4_changed" | "keys_changed" | "settings_changed" | "key0_changed" | "readback_verified" | "active";
export type ProvisionResult = { tagId: string; publicRef: string; uid: string; firstCounter: number; secondCounter: number; sampleUrl: string; stage: ProvisionStage };
export type ProvisionProof = { firstCounter: number; secondCounter: number; sampleUrl: string };

/** Thrown before any change when earlier work on this chip ended in an uncertain, key-changing step. */
export class ProvisionUncertain extends Error {
  constructor(public readonly intent: ProvisionIntent | string) { super(`Earlier provisioning of this tag was interrupted during "${intent}". It is not repeated automatically.`); }
}

export class ProvisionFailure extends Error {
  constructor(public readonly stage: ProvisionStage, public readonly tagId: string | undefined, cause: unknown, public readonly openIntent?: ProvisionIntent) {
    super(`Provisioning failed at ${stage}: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
}


function expectedSettings(template: ReturnType<typeof ndefTemplate>) {
  return Buffer.concat([Buffer.from("004000e0000100", "hex"), template.settings.subarray(3)]);
}

/** NXP NT4H2421Gx §§9.3.1/9.3.4 permit consecutive same-file reads to reuse counter/padding.
 * Verify repeated material, then explicitly SELECT between independent observations. */
async function verifyProvisionedTag(input: { tag: ProvisionTag; keys: DevelopmentKeys; origin: string; publicRef: string; uid: string; templateLength: number }) {
  const { tag, keys } = input;
  await tag.reconnect();
  if (!(await tag.readFileSettings()).equals(expectedSettings(ndefTemplate(input.origin, input.publicRef)))) throw new Error("SDM settings readback mismatch");
  await tag.authenticateFirst(0, keys.key0);
  await tag.reconnect();
  const first = verifyDynamicNdef(await tag.readNdef(input.templateLength), input.origin, input.publicRef, keys);
  const repeated = verifyDynamicNdef(await tag.readNdef(input.templateLength), input.origin, input.publicRef, keys);
  if (first.uid !== input.uid || repeated.uid !== input.uid || first.counter < 1 || repeated.counter < first.counter) throw new Error("Dynamic SDM counter or UID mismatch");
  // reconnect includes SELECT; PC/SC LEAVE_CARD alone does not imply an RF reset.
  await tag.reconnect();
  const second = verifyDynamicNdef(await tag.readNdef(input.templateLength), input.origin, input.publicRef, keys);
  if (second.uid !== input.uid || second.counter <= repeated.counter || second.url === repeated.url) throw new Error("Dynamic SDM counter or UID mismatch");
  const wrongMeta = Buffer.from(keys.metaReadKey); wrongMeta[0] ^= 1;
  const wrongKey = { metaReadKey: wrongMeta, fileReadKey: keys.fileReadKey };
  const parsed = new URL(second.url);
  try {
    verifySdm({ encrypted: parsed.searchParams.get("e")!, mac: parsed.searchParams.get("c")! }, wrongKey);
    throw new Error("Wrong key unexpectedly accepted");
  } catch (error) { if (error instanceof Error && error.message === "Wrong key unexpectedly accepted") throw error; }
  return { first, second };
}

export async function provisionPhysicalTag(input: {
  transport: ApduTransport;
  repository: ProvisionRepository;
  keyStore: ProvisionKeyStore;
  actorUserId: string;
  programId: string;
  origin: string;
  keyRef: string;
  provenanceRef?: string;
  currentKeys?: DevelopmentKeys;
  expectedUid?: string;
  expectedPublicRef?: string;
  requireEmptyNdef?: boolean;
  replacesTagId?: string;
  confirm(summary: { uid: string; version: Version; originalFileSettings: string; mapping: Awaited<ReturnType<ProvisionRepository["checkTarget"]>> }): Promise<boolean>;
  onStage(stage: ProvisionStage, proof?: ProvisionProof): Promise<void>;
  /** Called before an operation group that may change the tag; the matching onStage call closes it. */
  onIntent(intent: ProvisionIntent): Promise<void>;
  /** Called with the presented chip before anything changes; throws ProvisionUncertain to stop. */
  assertSafeToStart(uid: string): Promise<void>;
  tagFactory?(transport: ApduTransport): ProvisionTag;
  keyFactory?(context: { uid: string; keyRef: string }): DevelopmentKeys;
}): Promise<ProvisionResult> {
  let stage: ProvisionStage = "preflight";
  let tagId: string | undefined;
  let openIntent: ProvisionIntent | undefined;
  const intend = async (next: ProvisionIntent) => { openIntent = next; await input.onIntent?.(next); };
  const note = async (next: ProvisionStage, proof?: ProvisionProof) => { await input.onStage(next, proof); openIntent = undefined; stage = next; };
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  try {
    assertProvenance(input.provenanceRef);
    assertCurrentKeys(input.currentKeys);
    if (!input.keyFactory) throw new Error("Explicit prepared or derived key factory is required; hardware key generation is forbidden");
    if (!input.onStage || !input.onIntent || !input.assertSafeToStart) throw new Error("Durable intent/stage evidence and prior-state guard are required");
    if (!input.expectedUid || !/^[a-f0-9]{14}$/.test(input.expectedUid)) throw new Error("Execution requires the custody-bound expected chip UID");
    const mapping = await input.repository.checkTarget(input);
    const version = await tag.version();
    await tag.reconnect();
    const repeat = await tag.version();
    if (repeat.uid !== version.uid || (input.expectedUid && version.uid !== input.expectedUid)) throw new Error("Presented tag changed during preflight");
    const settings = await tag.readFileSettings();
    if (!settings.equals(Buffer.from("0000e0ee000100", "hex"))) throw new Error("Tag is not in expected factory NDEF state");
    if (input.requireEmptyNdef) {
      const nlen = await tag.readNdef(2);
      if (nlen.length !== 2 || nlen.readUInt16BE(0) !== 0) throw new Error("Prepared plan requires empty NDEF");
    }
    await input.assertSafeToStart?.(version.uid);
    if (!await input.confirm({ uid: version.uid, version, originalFileSettings: settings.toString("hex"), mapping })) throw new Error("Operator did not confirm irreversible changes");
    await note("confirmed");
    // Establish the explicitly supplied current credential before reserving or writing. No fallback.
    await tag.authenticateFirst(0, input.currentKeys.key0);
    await tag.reconnect();
    const keys = input.keyFactory({ uid: version.uid, keyRef: input.keyRef });
    await input.keyStore.save(input.keyRef, version.uid, keys);
    await note("keys_saved");
    const reserved = await input.repository.reserve({ actorUserId: input.actorUserId, programId: input.programId, uid: version.uid, keyRef: input.keyRef, replacesTagId: input.replacesTagId, publicRef: input.expectedPublicRef });
    tagId = reserved.id;
    await note("reserved");
    if (input.expectedPublicRef && reserved.publicRef !== input.expectedPublicRef) throw new Error("Reservation differs from approved plan");
    const template = ndefTemplate(input.origin, reserved.publicRef);
    await intend("writing_ndef");
    await tag.writeNdef(template.bytes);
    await tag.reconnect();
    const staticRead = await tag.readNdef(template.bytes.length);
    if (!staticRead.equals(template.bytes)) throw new Error("Static NDEF writeback mismatch");
    await note("ndef_written");
    await tag.authenticateFirst(0, input.currentKeys.key0);
    for (const [number, key, old] of [[1, keys.fileReadKey, input.currentKeys.fileReadKey], [2, keys.metaReadKey, input.currentKeys.metaReadKey], [3, keys.key3, input.currentKeys.key3], [4, keys.key4, input.currentKeys.key4]] as const) {
      await intend(`changing_key${number}`);
      await tag.changeKey(number, key, old);
      await note(`key${number}_changed`);
    }
    await note("keys_changed");
    await intend("changing_settings");
    await tag.changeFileSettings(template.settings);
    await tag.reconnect();
    const configured = await tag.readFileSettings();
    if (!configured.equals(expectedSettings(template))) throw new Error("SDM settings readback mismatch");
    await note("settings_changed");
    await tag.authenticateFirst(0, input.currentKeys.key0);
    await intend("changing_key0");
    await tag.changeKey(0, keys.key0, input.currentKeys.key0);
    await note("key0_changed");
    const { first, second } = await verifyProvisionedTag({ tag, keys, origin: input.origin, publicRef: reserved.publicRef, uid: version.uid, templateLength: template.bytes.length });
    await input.repository.verifyMapping({ tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, tenantId: mapping.tenantId, locationId: mapping.locationId, programId: mapping.programId });
    await note("readback_verified", { firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url });
    await input.repository.activate({ actorUserId: input.actorUserId, tagId: reserved.id, initialCounter: second.counter });
    await note("active");
    return { tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url, stage };
  } catch (error) {
    if (tagId) { try { await input.repository.fail({ actorUserId: input.actorUserId, tagId }); } catch { /* report original failure, keep diagnostic record */ } }
    if (error instanceof ProvisionUncertain) throw error;
    throw new ProvisionFailure(stage, tagId, error, openIntent);
  }
}

/**
 * Recovery from durably acknowledged states only. Lost key-0 responses are quarantined by the journal.
 * Credentials are selected from known state, never discovered by probing alternates.
 */
export async function completeProvisioning(input: {
  transport: ApduTransport;
  origin: string;
  publicRef: string;
  keys: DevelopmentKeys;
  expectedUid: string;
  provenanceRef?: string;
  currentKeys?: DevelopmentKeys;
  key0State: "transport" | "personalized";
  confirm(summary: { uid: string; settings: string }): Promise<boolean>;
  onIntent(intent: ProvisionIntent): Promise<void>;
  onStage(stage: ProvisionStage, proof?: ProvisionProof): Promise<void>;
  tagFactory?(transport: ApduTransport): ProvisionTag;
}): Promise<{ uid: string; firstCounter: number; secondCounter: number; sampleUrl: string }> {
  assertProvenance(input.provenanceRef);
  if (!input.onIntent || !input.onStage) throw new Error("Durable recovery evidence is required");
  if (input.key0State !== "transport" && input.key0State !== "personalized") throw new Error("Recovery requires an acknowledged key-0 state");
  if (input.key0State === "transport") assertCurrentKeys(input.currentKeys);
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  const template = ndefTemplate(input.origin, input.publicRef);
  const version = await tag.version();
  if (version.uid !== input.expectedUid) throw new Error("Presented tag is not the tag in the evidence");
  await tag.reconnect();
  const settings = await tag.readFileSettings();
  if (!settings.equals(expectedSettings(template))) throw new Error("Tag does not show the expected configured SDM settings");
  const sample = verifyDynamicNdef(await tag.readNdef(template.bytes.length), input.origin, input.publicRef, input.keys);
  if (sample.uid !== input.expectedUid || sample.counter < 1) throw new Error("Recovery SDM binding mismatch");
  if (!await input.confirm({ uid: version.uid, settings: settings.toString("hex") })) throw new Error("Operator did not confirm recovery");
  if (input.key0State === "transport") {
    await tag.reconnect();
    await tag.authenticateFirst(0, input.currentKeys!.key0);
    await input.onIntent?.("changing_key0");
    await tag.changeKey(0, input.keys.key0, input.currentKeys!.key0);
    await input.onStage?.("key0_changed");
  }
  const { first, second } = await verifyProvisionedTag({ tag, keys: input.keys, origin: input.origin, publicRef: input.publicRef, uid: version.uid, templateLength: template.bytes.length });
  await input.onStage("readback_verified", { firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url });
  return { uid: version.uid, firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url };
}
