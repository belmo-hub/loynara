/** Read-only classification of a chip from its (unauthenticated) NDEF file settings. No key is used and nothing is written. */
export type TagCondition = "factory" | "configured" | "unrecognised";

export function classifyFileSettings(settings: Buffer): TagCondition {
  if (settings.length >= 7 && settings[0] === 0 && settings[1] === 0 && settings.subarray(2, 4).equals(Buffer.from([0xe0, 0xee]))) return "factory";
  if (settings.length >= 7 && settings[0] === 0 && (settings[1] & 0x40) !== 0 && settings.subarray(2, 4).equals(Buffer.from([0x00, 0xe0]))) return "configured";
  return "unrecognised";
}
