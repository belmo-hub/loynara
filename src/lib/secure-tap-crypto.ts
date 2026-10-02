import { createCipheriv, createDecipheriv, timingSafeEqual } from "node:crypto";

// NXP AN12196 Rev 2.0, sections 3.3, 3.4.2.2 and 3.4.4.2.1.
// This verifier supports only encrypted PICC data plus an empty SDMMAC input.
export function aesBlock(key: Buffer, block: Buffer, decrypt = false): Buffer {
  const cipher = decrypt ? createDecipheriv("aes-128-ecb", key, null) : createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(block), cipher.final()]);
}

function doubled(block: Buffer): Buffer {
  const next = Buffer.alloc(16);
  for (let i = 0; i < 16; i++) next[i] = ((block[i] << 1) & 0xff) | (i < 15 ? block[i + 1] >>> 7 : 0);
  if (block[0] & 0x80) next[15] ^= 0x87;
  return next;
}

export function cmac(key: Buffer, message: Buffer): Buffer {
  const l = aesBlock(key, Buffer.alloc(16));
  const k1 = doubled(l);
  const k2 = doubled(k1);
  const complete = message.length > 0 && message.length % 16 === 0;
  const blocks = Math.max(1, Math.ceil(message.length / 16));
  let state: Buffer = Buffer.alloc(16);
  for (let i = 0; i < blocks; i++) {
    const last = i === blocks - 1;
    const chunk = message.subarray(i * 16, (i + 1) * 16);
    const input = Buffer.alloc(16);
    chunk.copy(input);
    if (last && !complete) input[chunk.length] = 0x80;
    const subkey = last ? (complete ? k1 : k2) : null;
    for (let j = 0; j < 16; j++) input[j] ^= state[j] ^ (subkey?.[j] ?? 0);
    state = aesBlock(key, input);
  }
  return state;
}

export function verifySdm(fields: { encrypted: string; mac: string }, keys: { metaReadKey: Buffer; fileReadKey: Buffer }): { uid: string; counter: number } {
  if (!/^[a-fA-F0-9]{32}$/.test(fields.encrypted) || !/^[a-fA-F0-9]{16}$/.test(fields.mac) || keys.metaReadKey.length !== 16 || keys.fileReadKey.length !== 16) throw new Error("Invalid SDM input");
  const picc = aesBlock(keys.metaReadKey, Buffer.from(fields.encrypted, "hex"), true);
  if (picc[0] !== 0xc7) throw new Error("Unsupported SDM PICC layout");
  const uid = picc.subarray(1, 8);
  const counterBytes = picc.subarray(8, 11);
  const sv = Buffer.concat([Buffer.from("3cc300010080", "hex"), uid, counterBytes]);
  const sessionKey = cmac(keys.fileReadKey, sv);
  const fullMac = cmac(sessionKey, Buffer.alloc(0));
  const expected = Buffer.from(Array.from({ length: 8 }, (_, index) => fullMac[index * 2 + 1]));
  if (!timingSafeEqual(expected, Buffer.from(fields.mac, "hex"))) throw new Error("Invalid SDM authentication");
  return { uid: uid.toString("hex"), counter: counterBytes[0] | (counterBytes[1] << 8) | (counterBytes[2] << 16) };
}
