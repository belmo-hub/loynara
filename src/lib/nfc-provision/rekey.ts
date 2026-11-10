import { deriveTagKeys, parseMaster } from "../nfc-keys";
import { classifyFileSettings } from "./inspect";
import type { DevelopmentKeys, Version } from "./ntag";
import type { ProvisionTag } from "./flow";

/**
 * Takes a chip that was personalised for one environment back to the factory NDEF state so the normal provisioning
 * flow can personalise it again for another environment. Keys 0-4 are NOT changed: only the NDEF file settings
 * (SDM off, free read and write), the same ChangeFileSettings command the provisioning flow already uses.
 * Afterwards the chip's current keys are the ones derived here, which the provisioning flow takes as --transport-keys-file.
 */
const FACTORY_SETTINGS_PAYLOAD = Buffer.from("00e0ee", "hex"); // FileOption 00, AR1 e0 (RW free, change key 0), AR2 ee (read, write free)
const FACTORY_SETTINGS_READBACK = Buffer.from("0000e0ee000100", "hex");

export class RekeyRefusal extends Error { constructor(public code: string) { super(code); this.name = "RekeyRefusal"; } }
const refuse = (code: string): never => { throw new RekeyRefusal(code); };

/** The keys the chip holds now: derived from the masters of the environment that configured it. */
export function currentDerivedKeys(input: { env: Record<string, string | undefined>; keyRef: string; uid: string }): DevelopmentKeys {
  const keys = deriveTagKeys({ verifyMaster: parseMaster(input.env.NFC_VERIFY_MASTER_KEY), adminMaster: parseMaster(input.env.NFC_ADMIN_MASTER_KEY), ref: input.keyRef, uid: input.uid });
  return { key0: keys.key0, fileReadKey: keys.fileReadKey, metaReadKey: keys.metaReadKey, key3: keys.key3, key4: keys.key4 };
}

export async function resetKeyedChipToFactorySettings(input: {
  tag: Pick<ProvisionTag, "version" | "reconnect" | "readFileSettings" | "authenticateFirst" | "changeFileSettings">;
  expectedUid: string;
  currentKeys: DevelopmentKeys;
  confirm(summary: { uid: string; version: Version; settings: string }): Promise<boolean>;
  onIntent(): Promise<void>;
  onDone(): Promise<void>;
}): Promise<{ uid: string }> {
  const { tag } = input;
  const version = await tag.version();
  await tag.reconnect();
  const repeat = await tag.version();
  if (version.uid !== repeat.uid || version.uid !== input.expectedUid) refuse("PRESENTED_TAG_IS_NOT_THE_EXPECTED_CHIP");
  const settings = await tag.readFileSettings();
  if (classifyFileSettings(settings) !== "configured") refuse("CHIP_IS_NOT_IN_THE_CONFIGURED_STATE");
  if (!await input.confirm({ uid: version.uid, version, settings: settings.toString("hex") })) refuse("OPERATOR_DID_NOT_CONFIRM");
  // A wrong key fails here, before anything is changed, and proves the custody.
  await tag.authenticateFirst(0, input.currentKeys.key0);
  await input.onIntent();
  await tag.changeFileSettings(FACTORY_SETTINGS_PAYLOAD);
  await tag.reconnect();
  if (!(await tag.readFileSettings()).equals(FACTORY_SETTINGS_READBACK)) refuse("FACTORY_SETTINGS_READBACK_MISMATCH");
  await input.onDone();
  return { uid: version.uid };
}
