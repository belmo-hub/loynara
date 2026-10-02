import { aesBlock, cmac } from "./secure-tap-crypto";
import type { TapKeys } from "./nfc-keys";
import { ndefTemplate } from "./nfc-provision/ntag";

/**
 * Synthetic SDM generator for tests. It builds what a chip would answer for a given UID, read counter and key set,
 * using the same published AN12196 construction the verifier uses, and only ever with synthetic keys.
 */
export function sdmFor(input: { uid: string; counter: number; keys: TapKeys }): { encrypted: string; mac: string } {
  const uid = Buffer.from(input.uid, "hex");
  const counter = Buffer.from([input.counter & 255, (input.counter >> 8) & 255, (input.counter >> 16) & 255]);
  const picc = Buffer.concat([Buffer.from([0xc7]), uid, counter, Buffer.alloc(5)]);
  const encrypted = aesBlock(input.keys.metaReadKey, picc).toString("hex");
  const session = cmac(input.keys.fileReadKey, Buffer.concat([Buffer.from("3cc300010080", "hex"), uid, counter]));
  const full = cmac(session, Buffer.alloc(0));
  return { encrypted, mac: Buffer.from(Array.from({ length: 8 }, (_, index) => full[index * 2 + 1])).toString("hex") };
}

export function tapUrl(origin: string, publicRef: string, fields: { encrypted: string; mac: string }) {
  return `${origin}/tap/${publicRef}?e=${fields.encrypted}&c=${fields.mac}`;
}

/** The dynamic NDEF image a configured chip returns for one read. */
export function dynamicNdef(origin: string, publicRef: string, uid: string, counter: number, keys: TapKeys): Buffer {
  const template = ndefTemplate(origin, publicRef);
  const fields = sdmFor({ uid, counter, keys });
  const image = Buffer.from(template.bytes);
  image.write(fields.encrypted, template.piccOffset, "ascii");
  image.write(fields.mac, template.macOffset, "ascii");
  return image;
}
