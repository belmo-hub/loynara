import { Ntag424, generateDevelopmentKeys, ndefTemplate, verifyDynamicNdef, type ApduTransport, type DevelopmentKeys, type Version } from "./ntag";
import { verifySdm } from "../secure-tap-crypto";

export interface ProvisionRepository {
  checkTarget(input: { actorUserId: string; programId: string; replacesTagId?: string }): Promise<{ tenantId: string; locationId: string; programId: string; mode: string; cooldownSeconds: number }>;
  reserve(input: { actorUserId: string; programId: string; uid: string; keyRef: string; replacesTagId?: string }): Promise<{ id: string; publicRef: string }>;
  verifyMapping(input: { tagId: string; publicRef: string; uid: string; tenantId: string; locationId: string; programId: string }): Promise<void>;
  activate(input: { actorUserId: string; tagId: string }): Promise<void>;
  fail(input: { actorUserId: string; tagId: string }): Promise<void>;
}
export interface ProvisionKeyStore { save(ref: string, uid: string, keys: DevelopmentKeys): Promise<void> }
export type ProvisionTag = Pick<Ntag424, "version" | "reconnect" | "readFileSettings" | "writeNdef" | "readNdef" | "authenticateFirst" | "changeKey" | "changeFileSettings">;
/** An operation group that may have changed the tag. Recorded BEFORE it starts, so an interruption leaves the uncertainty on record. */
export type ProvisionIntent = "writing_ndef" | "changing_keys" | "changing_settings" | "changing_key0";
export type ProvisionStage = "preflight" | "confirmed" | "keys_saved" | "reserved" | "ndef_written" | "keys_changed" | "settings_changed" | "readback_verified" | "active";
export type ProvisionResult = { tagId: string; publicRef: string; uid: string; firstCounter: number; secondCounter: number; sampleUrl: string; stage: ProvisionStage };

/** Thrown before any change when earlier work on this chip ended in an uncertain, key-changing step. */
export class ProvisionUncertain extends Error {
  constructor(public readonly intent: ProvisionIntent | string) { super(`Earlier provisioning of this tag was interrupted during "${intent}". It is not repeated automatically.`); }
}

export class ProvisionFailure extends Error {
  constructor(public readonly stage: ProvisionStage, public readonly tagId: string | undefined, cause: unknown, public readonly openIntent?: ProvisionIntent) {
    super(`Provisioning failed at ${stage}: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
}


/** Final proof shared by fresh and resumed provisioning: the new key0 works, two reads give distinct valid dynamic URLs, a wrong key is refused. */
async function verifyProvisionedTag(input: { tag: ProvisionTag; keys: DevelopmentKeys; origin: string; publicRef: string; uid: string; templateLength: number }) {
  const { tag, keys } = input;
  await tag.reconnect();
  await tag.authenticateFirst(0, keys.key0);
  await tag.reconnect();
  const first = verifyDynamicNdef(await tag.readNdef(input.templateLength), input.origin, input.publicRef, keys);
  const second = verifyDynamicNdef(await tag.readNdef(input.templateLength), input.origin, input.publicRef, keys);
  if (first.uid !== input.uid || second.uid !== input.uid || first.counter < 1 || second.counter <= first.counter || second.url === first.url) throw new Error("Dynamic SDM counter or UID mismatch");
  const wrongKey = { metaReadKey: Buffer.alloc(16, 0x5a), fileReadKey: keys.fileReadKey };
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
  replacesTagId?: string;
  confirm(summary: { uid: string; version: Version; originalFileSettings: string; mapping: Awaited<ReturnType<ProvisionRepository["checkTarget"]>> }): Promise<boolean>;
  onStage?(stage: ProvisionStage): Promise<void>;
  /** Called before an operation group that may change the tag; the matching onStage call closes it. */
  onIntent?(intent: ProvisionIntent): Promise<void>;
  /** Called with the presented chip before anything changes; throws ProvisionUncertain to stop. */
  assertSafeToStart?(uid: string): Promise<void>;
  tagFactory?(transport: ApduTransport): ProvisionTag;
  keyFactory?(context: { uid: string; keyRef: string }): DevelopmentKeys;
}): Promise<ProvisionResult> {
  let stage: ProvisionStage = "preflight";
  let tagId: string | undefined;
  let openIntent: ProvisionIntent | undefined;
  const intend = async (next: ProvisionIntent) => { openIntent = next; await input.onIntent?.(next); };
  const note = async (next: ProvisionStage) => { openIntent = undefined; stage = next; await input.onStage?.(next); };
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  try {
    const mapping = await input.repository.checkTarget(input);
    const version = await tag.version();
    await tag.reconnect();
    const repeat = await tag.version();
    if (repeat.uid !== version.uid) throw new Error("Presented tag changed during preflight");
    const settings = await tag.readFileSettings();
    if (settings.length < 7 || settings[0] !== 0 || settings[1] !== 0 || !settings.subarray(2, 4).equals(Buffer.from([0xe0, 0xee])) || (settings[1] & 0x40) !== 0) throw new Error("Tag is not in expected factory NDEF state");
    await input.assertSafeToStart?.(version.uid);
    if (!await input.confirm({ uid: version.uid, version, originalFileSettings: settings.toString("hex"), mapping })) throw new Error("Operator did not confirm irreversible changes");
    await note("confirmed");
    const keys = input.keyFactory?.({ uid: version.uid, keyRef: input.keyRef }) ?? generateDevelopmentKeys();
    await input.keyStore.save(input.keyRef, version.uid, keys);
    await note("keys_saved");
    const reserved = await input.repository.reserve({ actorUserId: input.actorUserId, programId: input.programId, uid: version.uid, keyRef: input.keyRef, replacesTagId: input.replacesTagId });
    tagId = reserved.id;
    await note("reserved");
    const template = ndefTemplate(input.origin, reserved.publicRef);
    await intend("writing_ndef");
    await tag.writeNdef(template.bytes);
    await tag.reconnect();
    const staticRead = await tag.readNdef(template.bytes.length);
    if (!staticRead.equals(template.bytes)) throw new Error("Static NDEF writeback mismatch");
    await note("ndef_written");
    await tag.authenticateFirst(0, Buffer.alloc(16));
    await intend("changing_keys");
    await tag.changeKey(1, keys.fileReadKey);
    await tag.changeKey(2, keys.metaReadKey);
    await tag.changeKey(3, keys.key3);
    await tag.changeKey(4, keys.key4);
    await note("keys_changed");
    await intend("changing_settings");
    await tag.changeFileSettings(template.settings);
    await tag.reconnect();
    const configured = await tag.readFileSettings();
    if (!configured.subarray(0, 4).equals(Buffer.from([0, 0x40, 0x00, 0xe0])) || !configured.subarray(7).equals(template.settings.subarray(3))) throw new Error("SDM settings readback mismatch");
    await note("settings_changed");
    await tag.authenticateFirst(0, Buffer.alloc(16));
    await intend("changing_key0");
    await tag.changeKey(0, keys.key0);
    const { first, second } = await verifyProvisionedTag({ tag, keys, origin: input.origin, publicRef: reserved.publicRef, uid: version.uid, templateLength: template.bytes.length });
    await input.repository.verifyMapping({ tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, tenantId: mapping.tenantId, locationId: mapping.locationId, programId: mapping.programId });
    await note("readback_verified");
    await input.repository.activate({ actorUserId: input.actorUserId, tagId: reserved.id });
    await note("active");
    return { tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url, stage };
  } catch (error) {
    if (tagId) { try { await input.repository.fail({ actorUserId: input.actorUserId, tagId }); } catch { /* report original failure, keep diagnostic record */ } }
    if (error instanceof ProvisionUncertain) throw error;
    throw new ProvisionFailure(stage, tagId, error, openIntent);
  }
}

/**
 * Finish a provisioning that stopped after the file settings were changed but before (or during) the change of
 * key 0. Everything before that is verified by READING the tag; key 0 is then the only open question, and it is
 * settled by a bounded probe: authenticate with the derived key 0 (already changed), else with the factory key 0
 * (not yet changed). If neither works the tag is in a state this tool does not understand and it stops.
 * The probe makes at most two authentication attempts and needs the operator's explicit confirmation.
 */
export async function completeProvisioning(input: {
  transport: ApduTransport;
  origin: string;
  publicRef: string;
  keys: DevelopmentKeys;
  expectedUid: string;
  confirm(summary: { uid: string; settings: string }): Promise<boolean>;
  onIntent?(intent: ProvisionIntent): Promise<void>;
  onStage?(stage: ProvisionStage): Promise<void>;
  tagFactory?(transport: ApduTransport): ProvisionTag;
}): Promise<{ uid: string; firstCounter: number; secondCounter: number; sampleUrl: string }> {
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  const template = ndefTemplate(input.origin, input.publicRef);
  const version = await tag.version();
  if (version.uid !== input.expectedUid) throw new Error("Presented tag is not the tag in the evidence");
  await tag.reconnect();
  const settings = await tag.readFileSettings();
  if (!settings.subarray(0, 4).equals(Buffer.from([0, 0x40, 0x00, 0xe0])) || !settings.subarray(7).equals(template.settings.subarray(3))) throw new Error("Tag does not show the expected configured SDM settings");
  if (!await input.confirm({ uid: version.uid, settings: settings.toString("hex") })) throw new Error("Operator did not confirm the key-0 probe");
  await input.onIntent?.("changing_key0");
  let key0Done = false;
  try { await tag.reconnect(); await tag.authenticateFirst(0, input.keys.key0); key0Done = true; }
  catch {
    await tag.reconnect();
    try { await tag.authenticateFirst(0, Buffer.alloc(16)); }
    catch { throw new Error("Key 0 matches neither the derived nor the factory key: stop and recover by hand"); }
  }
  if (!key0Done) await tag.changeKey(0, input.keys.key0);
  const { first, second } = await verifyProvisionedTag({ tag, keys: input.keys, origin: input.origin, publicRef: input.publicRef, uid: version.uid, templateLength: template.bytes.length });
  await input.onStage?.("readback_verified");
  return { uid: version.uid, firstCounter: first.counter, secondCounter: second.counter, sampleUrl: second.url };
}
