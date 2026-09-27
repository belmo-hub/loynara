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
export type ProvisionStage = "preflight" | "confirmed" | "keys_saved" | "reserved" | "ndef_written" | "keys_changed" | "settings_changed" | "readback_verified" | "active";
export type ProvisionResult = { tagId: string; publicRef: string; uid: string; firstCounter: number; secondCounter: number; stage: ProvisionStage };

export class ProvisionFailure extends Error {
  constructor(public readonly stage: ProvisionStage, public readonly tagId: string | undefined, cause: unknown) {
    super(`Provisioning failed at ${stage}: ${cause instanceof Error ? cause.message : "unknown error"}`);
  }
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
  tagFactory?(transport: ApduTransport): ProvisionTag;
  keyFactory?(): DevelopmentKeys;
}): Promise<ProvisionResult> {
  let stage: ProvisionStage = "preflight";
  let tagId: string | undefined;
  const note = async (next: ProvisionStage) => { stage = next; await input.onStage?.(next); };
  const tag = input.tagFactory?.(input.transport) ?? new Ntag424(input.transport);
  try {
    const mapping = await input.repository.checkTarget(input);
    const version = await tag.version();
    await tag.reconnect();
    const repeat = await tag.version();
    if (repeat.uid !== version.uid) throw new Error("Presented tag changed during preflight");
    const settings = await tag.readFileSettings();
    if (settings.length < 7 || settings[0] !== 0 || settings[1] !== 0 || !settings.subarray(2, 4).equals(Buffer.from([0xe0, 0xee])) || (settings[1] & 0x40) !== 0) throw new Error("Tag is not in expected factory NDEF state");
    if (!await input.confirm({ uid: version.uid, version, originalFileSettings: settings.toString("hex"), mapping })) throw new Error("Operator did not confirm irreversible changes");
    await note("confirmed");
    const keys = input.keyFactory?.() ?? generateDevelopmentKeys();
    await input.keyStore.save(input.keyRef, version.uid, keys);
    await note("keys_saved");
    const reserved = await input.repository.reserve({ actorUserId: input.actorUserId, programId: input.programId, uid: version.uid, keyRef: input.keyRef, replacesTagId: input.replacesTagId });
    tagId = reserved.id;
    await note("reserved");
    const template = ndefTemplate(input.origin, reserved.publicRef);
    await tag.writeNdef(template.bytes);
    await tag.reconnect();
    const staticRead = await tag.readNdef(template.bytes.length);
    if (!staticRead.equals(template.bytes)) throw new Error("Static NDEF writeback mismatch");
    await note("ndef_written");
    await tag.authenticateFirst(0, Buffer.alloc(16));
    await tag.changeKey(1, keys.fileReadKey);
    await tag.changeKey(2, keys.metaReadKey);
    await tag.changeKey(3, keys.key3);
    await tag.changeKey(4, keys.key4);
    await note("keys_changed");
    await tag.changeFileSettings(template.settings);
    await tag.reconnect();
    const configured = await tag.readFileSettings();
    if (!configured.subarray(0, 4).equals(Buffer.from([0, 0x40, 0x00, 0xe0])) || !configured.subarray(7).equals(template.settings.subarray(3))) throw new Error("SDM settings readback mismatch");
    await note("settings_changed");
    await tag.authenticateFirst(0, Buffer.alloc(16));
    await tag.changeKey(0, keys.key0);
    await tag.reconnect();
    await tag.authenticateFirst(0, keys.key0);
    await tag.reconnect();
    const first = verifyDynamicNdef(await tag.readNdef(template.bytes.length), input.origin, reserved.publicRef, keys);
    const second = verifyDynamicNdef(await tag.readNdef(template.bytes.length), input.origin, reserved.publicRef, keys);
    if (first.uid !== version.uid || second.uid !== version.uid || first.counter < 1 || second.counter <= first.counter || second.url === first.url) throw new Error("Dynamic SDM counter or UID mismatch");
    const wrongKey = { metaReadKey: Buffer.alloc(16, 0x5a), fileReadKey: keys.fileReadKey };
    const parsed = new URL(second.url);
    try {
      verifySdm({ encrypted: parsed.searchParams.get("e")!, mac: parsed.searchParams.get("c")! }, wrongKey);
      throw new Error("Wrong key unexpectedly accepted");
    } catch (error) { if (error instanceof Error && error.message === "Wrong key unexpectedly accepted") throw error; }
    await input.repository.verifyMapping({ tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, tenantId: mapping.tenantId, locationId: mapping.locationId, programId: mapping.programId });
    await note("readback_verified");
    await input.repository.activate({ actorUserId: input.actorUserId, tagId: reserved.id });
    await note("active");
    return { tagId: reserved.id, publicRef: reserved.publicRef, uid: version.uid, firstCounter: first.counter, secondCounter: second.counter, stage };
  } catch (error) {
    if (tagId) { try { await input.repository.fail({ actorUserId: input.actorUserId, tagId }); } catch { /* report original failure, keep diagnostic record */ } }
    throw new ProvisionFailure(stage, tagId, error);
  }
}
