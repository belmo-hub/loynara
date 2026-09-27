import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";
import { verifySdm } from "../secure-tap-crypto";

// NXP NT4H2421Gx data sheet Rev 3.0, §§8.2.3, 9.1, 10.2, 10.4, 10.6–10.8.
// APDUs are deliberately confined to this operator-only module.
export interface ApduTransport { transmit(apdu: Buffer): Promise<Buffer>; reconnect?(): Promise<void> }
export type Version = { uid: string; hardware: string; software: string; production: string };
export type DevelopmentKeys = { key0: Buffer; fileReadKey: Buffer; metaReadKey: Buffer; key3: Buffer; key4: Buffer };
const zero = Buffer.alloc(16);

function crypt(key: Buffer, input: Buffer, iv: Buffer, decrypt = false): Buffer {
  const cipher = decrypt ? createDecipheriv("aes-128-cbc", key, iv) : createCipheriv("aes-128-cbc", key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}
function block(key: Buffer, input: Buffer): Buffer {
  const cipher = createCipheriv("aes-128-ecb", key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(input), cipher.final()]);
}
function cmac(key: Buffer, message: Buffer): Buffer {
  const shift = (input: Buffer) => {
    const out = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) out[i] = ((input[i] << 1) & 255) | (i < 15 ? input[i + 1] >> 7 : 0);
    if (input[0] & 128) out[15] ^= 0x87;
    return out;
  };
  const k1 = shift(block(key, zero));
  const k2 = shift(k1);
  const complete = message.length > 0 && message.length % 16 === 0;
  const count = Math.max(1, Math.ceil(message.length / 16));
  let state: Buffer = Buffer.alloc(16);
  for (let i = 0; i < count; i++) {
    const part = Buffer.alloc(16);
    const chunk = message.subarray(i * 16, (i + 1) * 16);
    chunk.copy(part);
    if (i === count - 1) {
      if (!complete) part[chunk.length] = 0x80;
      const subkey = complete ? k1 : k2;
      for (let j = 0; j < 16; j++) part[j] ^= subkey[j];
    }
    for (let j = 0; j < 16; j++) part[j] ^= state[j];
    state = block(key, part);
  }
  return state;
}
function truncated(mac: Buffer): Buffer { return Buffer.from(Array.from({ length: 8 }, (_, i) => mac[2 * i + 1])); }
function pad(input: Buffer): Buffer { return Buffer.concat([input, Buffer.from([0x80]), Buffer.alloc((15 - input.length % 16 + 16) % 16)]); }
function little3(value: number): Buffer { return Buffer.from([value & 255, (value >> 8) & 255, (value >> 16) & 255]); }
function rotate(input: Buffer): Buffer { return Buffer.concat([input.subarray(1), input.subarray(0, 1)]); }
function apdu(ins: number, data?: Buffer): Buffer {
  if (!data?.length) return Buffer.from([0x90, ins, 0, 0, 0]);
  if (data.length > 255) throw new Error("APDU data exceeds short length");
  return Buffer.concat([Buffer.from([0x90, ins, 0, 0, data.length]), data, Buffer.from([0])]);
}
function response(raw: Buffer, expected: number): Buffer {
  if (raw.length < 2 || raw[raw.length - 2] !== 0x91 || raw[raw.length - 1] !== expected) {
    throw new Error(`NTAG command failed (status ${raw.length >= 2 ? raw.subarray(-2).toString("hex") : "missing"})`);
  }
  return raw.subarray(0, -2);
}
export async function selectNdefApplication(transport: ApduTransport): Promise<void> {
  const result = await transport.transmit(Buffer.from("00a4040c07d276000085010100", "hex"));
  if (!result.equals(Buffer.from("9000", "hex"))) throw new Error("NDEF application select failed");
}
export function protectedCommand(input: { ins: number; header: Buffer; plain: Buffer; enc: Buffer; mac: Buffer; ti: Buffer; counter: number }): Buffer {
  if (input.enc.length !== 16 || input.mac.length !== 16 || input.ti.length !== 4 || input.counter < 0 || input.counter > 0xffff) throw new Error("Invalid EV2 session");
  const counter = Buffer.from([input.counter & 255, input.counter >> 8]);
  const iv = block(input.enc, Buffer.concat([Buffer.from([0xa5, 0x5a]), input.ti, counter, Buffer.alloc(8)]));
  const ciphertext = crypt(input.enc, pad(input.plain), iv);
  const mac = truncated(cmac(input.mac, Buffer.concat([Buffer.from([input.ins]), counter, input.ti, input.header, ciphertext])));
  return apdu(input.ins, Buffer.concat([input.header, ciphertext, mac]));
}
export async function getVersion(transport: ApduTransport): Promise<Version> {
  await selectNdefApplication(transport);
  const first = response(await transport.transmit(apdu(0x60)), 0xaf);
  const second = response(await transport.transmit(apdu(0xaf)), 0xaf);
  const third = response(await transport.transmit(apdu(0xaf)), 0x00);
  if (first.length !== 7 || second.length !== 7 || third.length < 14 || first[0] !== 4 || first[1] !== 4 || first[3] !== 0x30 || first[6] !== 5 || second[0] !== 4 || second[1] !== 4 || second[2] !== 2 || second[6] !== 5 || third.subarray(0, 7).equals(Buffer.alloc(7))) {
    throw new Error("Card is not a supported UID-visible NTAG 424 DNA");
  }
  return { uid: third.subarray(0, 7).toString("hex"), hardware: first.toString("hex"), software: second.toString("hex"), production: third.subarray(7).toString("hex") };
}

export function generateDevelopmentKeys(): DevelopmentKeys {
  const values: Buffer[] = [];
  while (values.length < 5) {
    const next = randomBytes(16);
    if (!next.equals(zero) && values.every(value => !value.equals(next))) values.push(next);
  }
  return { key0: values[0], fileReadKey: values[1], metaReadKey: values[2], key3: values[3], key4: values[4] };
}

export class Ntag424 {
  private session?: { enc: Buffer; mac: Buffer; ti: Buffer; counter: number };
  constructor(private readonly transport: ApduTransport, private readonly challenge: () => Buffer = () => randomBytes(16)) {}
  async version(): Promise<Version> { return getVersion(this.transport); }
  async authenticateFirst(keyNumber: number, key: Buffer): Promise<void> {
    if (keyNumber < 0 || keyNumber > 4 || key.length !== 16) throw new Error("Invalid authentication key");
    this.session = undefined;
    const rndBEncrypted = response(await this.transport.transmit(apdu(0x71, Buffer.from([keyNumber, 0]))), 0xaf);
    if (rndBEncrypted.length !== 16) throw new Error("Invalid EV2 first response");
    const rndB = crypt(key, rndBEncrypted, zero, true);
    const rndA = this.challenge();
    if (rndA.length !== 16) throw new Error("Invalid EV2 challenge source");
    const challenge = crypt(key, Buffer.concat([rndA, rotate(rndB)]), zero);
    const answer = response(await this.transport.transmit(apdu(0xaf, challenge)), 0x00);
    if (answer.length !== 32) throw new Error("Invalid EV2 second response");
    const plain = crypt(key, answer, zero, true);
    if (!timingSafeEqual(plain.subarray(4, 20), rotate(rndA)) || !plain.subarray(20).equals(Buffer.alloc(12))) throw new Error("EV2 authentication failed");
    const context = Buffer.concat([rndA.subarray(0, 2), Buffer.from(Array.from({ length: 6 }, (_, i) => rndA[i + 2] ^ rndB[i])), rndB.subarray(6), rndA.subarray(8)]);
    this.session = {
      enc: cmac(key, Buffer.concat([Buffer.from("a55a00010080", "hex"), context])),
      mac: cmac(key, Buffer.concat([Buffer.from("5aa500010080", "hex"), context])),
      ti: plain.subarray(0, 4), counter: 0,
    };
  }
  private async full(ins: number, header: Buffer, plain: Buffer, changingAuthKey = false): Promise<Buffer> {
    const session = this.session;
    if (!session || session.counter >= 0xffff) throw new Error("EV2 authentication required");
    const command = protectedCommand({ ins, header, plain, ...session });
    let data: Buffer;
    try { data = response(await this.transport.transmit(command), 0x00); }
    catch (error) { this.session = undefined; throw error; }
    session.counter++;
    // AN12196 §5.16.2: changing the currently authenticated key returns only 9100.
    if (changingAuthKey && data.length === 0) { this.session = undefined; return data; }
    if (data.length < 8) { this.session = undefined; throw new Error("Missing EV2 response MAC"); }
    const body = data.subarray(0, -8);
    const gotMac = data.subarray(-8);
    const nextCounter = Buffer.from([session.counter & 255, session.counter >> 8]);
    const expected = truncated(cmac(session.mac, Buffer.concat([Buffer.from([0]), nextCounter, session.ti, body])));
    if (!timingSafeEqual(gotMac, expected)) { this.session = undefined; throw new Error("Invalid EV2 response MAC"); }
    return body;
  }
  async changeKey(number: number, next: Buffer, old = zero): Promise<void> {
    if (!Number.isInteger(number) || number < 0 || number > 4 || next.length !== 16 || old.length !== 16) throw new Error("Invalid key change");
    const payload = changeKeyPayload(number, next, old);
    await this.full(0xc4, Buffer.from([number]), payload, number === 0);
    if (number === 0) this.session = undefined;
  }
  async changeFileSettings(settings: Buffer): Promise<void> { await this.full(0x5f, Buffer.from([2]), settings); }
  async readFileSettings(): Promise<Buffer> {
    // Keep this read unauthenticated: after EV2, GetFileSettings has MAC communication.
    if (this.session) throw new Error("Reconnect before plain file-settings read");
    return response(await this.transport.transmit(apdu(0xf5, Buffer.from([2]))), 0x00);
  }
  async writeNdef(data: Buffer): Promise<void> {
    if (this.session) throw new Error("Reconnect before free-access NDEF write");
    if (data.length < 7 || data.length > 256 || data.readUInt16BE(0) !== data.length - 2) throw new Error("Invalid NDEF file image");
    // Factory NDEF write is free (data sheet Table 8). Keep NLEN zero until
    // all body frames have been written so an interrupted write is not offered.
    const write = async (offset: number, chunk: Buffer) => {
      response(await this.transport.transmit(apdu(0x8d, Buffer.concat([Buffer.from([2]), little3(offset), little3(chunk.length), chunk]))), 0x00);
    };
    await write(0, Buffer.alloc(2));
    for (let offset = 2; offset < data.length; offset += 120) await write(offset, data.subarray(offset, offset + 120));
    await write(0, data.subarray(0, 2));
  }
  async readNdef(length: number): Promise<Buffer> {
    if (this.session) throw new Error("Reconnect before dynamic NDEF read");
    return response(await this.transport.transmit(apdu(0xad, Buffer.concat([Buffer.from([2]), little3(0), little3(length)]))), 0x00);
  }
  async reconnect(): Promise<void> { this.session = undefined; if (this.transport.reconnect) await this.transport.reconnect(); await selectNdefApplication(this.transport); }
}

export function changeKeyPayload(number: number, next: Buffer, old = zero): Buffer {
  if (!Number.isInteger(number) || number < 0 || number > 4 || next.length !== 16 || old.length !== 16) throw new Error("Invalid key change");
  // Data sheet Table 63: key 0 uses NewKey||KeyVer; other keys use XOR||KeyVer||CRC32(NewKey).
  return number === 0 ? Buffer.concat([next, Buffer.from([1])]) : Buffer.concat([Buffer.from(next.map((byte, i) => byte ^ old[i])), Buffer.from([1]), crc32(next)]);
}

function crc32(input: Buffer): Buffer {
  let crc = 0xffffffff;
  for (const byte of input) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1; }
  // AN12196 Table 25 transmits the running FCS register without final complement.
  return Buffer.from([crc & 255, (crc >>> 8) & 255, (crc >>> 16) & 255, (crc >>> 24) & 255]);
}

export function ndefTemplate(origin: string, publicRef: string): { bytes: Buffer; url: string; piccOffset: number; macOffset: number; settings: Buffer } {
  if (!/^https:\/\/[^/]+$/.test(origin) || !/^[A-Za-z0-9_-]{24}$/.test(publicRef)) throw new Error("Approved HTTPS origin and random tag reference required");
  const url = `${origin}/tap/${publicRef}?e=${"0".repeat(32)}&c=${"0".repeat(16)}`;
  const uri = Buffer.from(url, "ascii");
  if (uri.length + 7 > 256 || uri.length + 1 > 255) throw new Error("NDEF URL exceeds tag capacity");
  const record = Buffer.concat([Buffer.from([0xd1, 1, uri.length + 1, 0x55, 0]), uri]);
  const bytes = Buffer.concat([Buffer.from([record.length >> 8, record.length & 255]), record]);
  const piccOffset = 7 + url.indexOf("?e=") + 3;
  const macOffset = 7 + url.indexOf("&c=") + 3;
  // Table 69: SDM enabled, ASCII, encrypted PICC with UID and read counter;
  // key 02 metadata, key 01 MAC, no public counter retrieval; NDEF writes require key 0.
  const settings = Buffer.concat([
    Buffer.from([0x40, 0x00, 0xe0, 0xc1, 0xff, 0x21]),
    little3(piccOffset), little3(macOffset), little3(macOffset),
  ]);
  return { bytes, url, piccOffset, macOffset, settings };
}

export function decodeDynamicNdef(data: Buffer, expectedOrigin: string, publicRef: string): { url: string; counter: number; uid: string } {
  const length = data.readUInt16BE(0);
  if (length + 2 > data.length || data[2] !== 0xd1 || data[3] !== 1 || data[5] !== 0x55 || data[6] !== 0 || data[4] !== length - 4) throw new Error("Unexpected NDEF URI record");
  const url = data.subarray(7, length + 2).toString("ascii");
  const parsed = new URL(url);
  if (parsed.origin !== expectedOrigin || parsed.pathname !== `/tap/${publicRef}` || !/^[a-f0-9]{32}$/i.test(parsed.searchParams.get("e") ?? "") || !/^[a-f0-9]{16}$/i.test(parsed.searchParams.get("c") ?? "")) throw new Error("Dynamic NDEF does not match provisioned route");
  return { url, counter: -1, uid: "" };
}

export function verifyDynamicNdef(data: Buffer, origin: string, publicRef: string, keys: DevelopmentKeys) {
  const { url } = decodeDynamicNdef(data, origin, publicRef);
  const parsed = new URL(url);
  return { url, ...verifySdm({ encrypted: parsed.searchParams.get("e")!, mac: parsed.searchParams.get("c")! }, keys) };
}
