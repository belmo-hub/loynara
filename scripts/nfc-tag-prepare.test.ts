import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EvidenceJournal } from "../src/lib/nfc-provision/evidence";
import { loadTransportKeyCustody } from "./nfc-operator-keys";
import { requireProvenanceRef } from "./nfc-operator-mode";
import { main, prepareFactoryTag, writeKeyFile } from "./nfc-tag-prepare";

// Synthetic only: a made-up credential, made-up source files and their own hashes. No real key or custody path.
const UID = "04de5f1eacc040";
const READER = "Synthetic Reader 0";
const KEY = Buffer.alloc(16, 0x5a);
const SOURCE = "const credential = Buffer.alloc(16, 90);\n";
const RECEIPT = JSON.stringify({ tag: "TAG-01", authentication_attempts: [1, 1, 1, 1, 1], keys: [0, 1, 2, 3, 4].map(slot => ({ slot, result: "PASS" })) });
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const pinned = { "auth-only.mts": sha(SOURCE), "authentication-evidence.json": sha(RECEIPT) };

const aes = (key: Buffer, data: Buffer, decrypt = false) => {
  const cipher = decrypt ? createDecipheriv("aes-128-cbc", key, Buffer.alloc(16)) : createCipheriv("aes-128-cbc", key, Buffer.alloc(16));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
};
const rotate = (value: Buffer) => Buffer.concat([value.subarray(1), value.subarray(0, 1)]);

/** Fake reader with an NTAG 424 DNA behind it: card side of select, GetVersion, GetFileSettings and AuthenticateEV2First. */
class FakeCard {
  keys = [KEY, KEY, KEY, KEY, KEY];
  uid = UID;
  settings = "0000e0ee000100";
  sent: string[] = [];
  private frame = 0;
  private pending?: { key: Buffer; rndB: Buffer };
  async transmit(apdu: Buffer): Promise<Buffer> {
    const hex = apdu.toString("hex");
    this.sent.push(hex);
    const reply = (data: Buffer | string, status: string) => Buffer.concat([typeof data === "string" ? Buffer.from(data, "hex") : data, Buffer.from(status, "hex")]);
    if (hex === "00a4040c07d276000085010100") { this.pending = undefined; return reply("", "9000"); }
    if (hex === "9060000000") { this.frame = 1; return reply("04040830001105", "91af"); }
    if (hex === "90af000000" && this.frame === 1) { this.frame = 2; return reply("04040201011105", "91af"); }
    if (hex === "90af000000" && this.frame === 2) { this.frame = 0; return reply(`${this.uid}11223344556677`, "9100"); }
    if (hex === "90f50000010200") return reply(this.settings, "9100");
    if (hex.startsWith("9071000002")) { const key = this.keys[apdu[5]]; const rndB = randomBytes(16); this.pending = { key, rndB }; return reply(aes(key, rndB), "91af"); }
    if (hex.startsWith("90af000020") && this.pending) {
      const { key, rndB } = this.pending;
      this.pending = undefined;
      const plain = aes(key, apdu.subarray(5, 37), true);
      if (!plain.subarray(16).equals(rotate(rndB))) return reply("", "91ae");
      return reply(aes(key, Buffer.concat([randomBytes(4), rotate(plain.subarray(0, 16)), Buffer.alloc(12)])), "9100");
    }
    return reply("", "911c");
  }
  async reconnect() { this.frame = 0; this.pending = undefined; }
  async close() {}
  auths() { return this.sent.filter(hex => hex.startsWith("9071")).map(hex => Number.parseInt(hex.slice(10, 12), 16)); }
}

let custody = "";
let source = "";
let evidence = "";
let journal: EvidenceJournal;
beforeEach(async () => {
  custody = await mkdtemp(path.join(os.tmpdir(), "nfc-prep-custody-"));
  source = await mkdtemp(path.join(os.tmpdir(), "nfc-prep-source-"));
  await writeFile(path.join(source, "auth-only.mts"), SOURCE);
  await writeFile(path.join(source, "authentication-evidence.json"), RECEIPT);
  await mkdir("var", { recursive: true });
  evidence = await mkdtemp(path.resolve("var/nfc-prep-test-"));
  journal = new EvidenceJournal(evidence);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  for (const folder of [custody, source, evidence]) await rm(folder, { recursive: true, force: true });
});
const prepare = (card: FakeCard, folder = custody) => prepareFactoryTag({ transport: card, journal, custodyDir: folder, credentialSource: source, pinned, reader: READER });
const keyFileOf = (folder = custody) => path.join(folder, `${UID}.current-keys.json`);
const formOf = async () => JSON.parse(await readFile(path.join(evidence, `${UID}.tag-prep.json`), "utf8"));

describe("new factory tag preparation", () => {
  it("authenticates slots 0-4 once each and writes a mode-600 key file that the provisioning loader reads back for this UID", async () => {
    const card = new FakeCard();
    const result = await prepare(card);
    expect(card.auths()).toEqual([0, 1, 2, 3, 4]);
    expect(result.keyFile).toBe(keyFileOf());
    expect((await stat(result.keyFile)).mode & 0o777).toBe(0o600);
    const loaded = await loadTransportKeyCustody(result.keyFile);
    expect(loaded.expectedUid).toBe(UID);
    expect(Object.values(loaded.currentKeys)).toEqual([KEY, KEY, KEY, KEY, KEY]);
    const form = await formOf();
    expect(form).toMatchObject({ uid: UID, reader: READER, status: "transport_keys_verified", provenanceRef: result.provenanceRef, currentKeyFile: { path: result.keyFile, mode: "600" } });
    expect(form.slots).toEqual([0, 1, 2, 3, 4].map(slot => ({ slot, result: "PASS", attempts: 1 })));
    expect(requireProvenanceRef(result.provenanceRef)).toBe(result.provenanceRef);
    expect(JSON.stringify(form).toLowerCase()).not.toContain(KEY.toString("hex"));
  });

  it("refuses a tag that is not in the factory state before any authentication or file", async () => {
    const card = new FakeCard();
    card.settings = "004000e0000100";
    await expect(prepare(card)).rejects.toThrow("TAG_NOT_FACTORY");
    expect(card.auths()).toEqual([]);
    expect(await readdir(custody)).toEqual([]);
    expect(await readdir(evidence)).toEqual([]);
  });

  it("refuses a tag whose provisioning evidence already exists", async () => {
    await journal.record(UID, { kind: "stage", name: "confirmed", note: { uid: UID } });
    const card = new FakeCard();
    await expect(prepare(card)).rejects.toThrow("EVIDENCE_EXISTS");
    expect(card.auths()).toEqual([]);
    expect(await readdir(custody)).toEqual([]);
  });

  it("stops at the first failing slot, records it, and refuses to try again", async () => {
    const card = new FakeCard();
    card.keys[3] = Buffer.alloc(16, 1);
    await expect(prepare(card)).rejects.toThrow("TRANSPORT_AUTHENTICATION_FAILED_SLOT_3");
    expect(card.auths()).toEqual([0, 1, 2, 3]);
    expect(await readdir(custody)).toEqual([]);
    expect(await formOf()).toMatchObject({ status: "stopped", slots: [0, 1, 2].map(slot => ({ slot, result: "PASS", attempts: 1 })) });
    card.keys[3] = KEY;
    await expect(prepare(card)).rejects.toThrow("EVIDENCE_EXISTS");
    expect(card.auths()).toEqual([0, 1, 2, 3]);
  });

  it("refuses when another chip answers after the five authentications", async () => {
    const card = new FakeCard();
    const transmit = card.transmit.bind(card);
    card.transmit = async apdu => { if (card.auths().length === 5) card.uid = "04aaaaaaaaaa01"; return transmit(apdu); };
    await expect(prepare(card)).rejects.toThrow("TAG_CHANGED_DURING_PREPARATION");
    expect(await readdir(custody)).toEqual([]);
    expect(await formOf()).toMatchObject({ status: "stopped", stoppedReason: "TAG_CHANGED_DURING_PREPARATION" });
  });

  it("refuses a second run once the key file exists, without authenticating", async () => {
    const card = new FakeCard();
    await prepare(card);
    await expect(prepare(card)).rejects.toThrow("CURRENT_KEY_FILE_EXISTS");
    expect(card.auths()).toHaveLength(5);
  });

  it("refuses a symlink where the key file would go, without authenticating or touching its target", async () => {
    const target = path.join(custody, "elsewhere.json");
    await writeFile(target, "keep");
    await symlink(target, keyFileOf());
    const card = new FakeCard();
    await expect(prepare(card)).rejects.toThrow("CURRENT_KEY_FILE_EXISTS");
    expect(card.auths()).toEqual([]);
    expect(await readFile(target, "utf8")).toBe("keep");
  });

  it.each([
    ["group-readable", async (folder: string) => { await chmod(folder, 0o750); return folder; }],
    ["a symlink to a directory", async (folder: string) => { const link = `${folder}-link`; await symlink(folder, link); return link; }],
    ["missing", async (folder: string) => path.join(folder, "absent")],
  ])("refuses a custody directory that is %s before using the reader", async (_name, make) => {
    const card = new FakeCard();
    const folder = await make(custody);
    try { await expect(prepare(card, folder)).rejects.toThrow("CUSTODY_DIRECTORY_UNSAFE"); }
    finally { if (folder.endsWith("-link")) await rm(folder); }
    expect(card.sent).toEqual([]);
  });

  it.each([
    ["the source changed", "auth-only.mts", "const credential = Buffer.alloc(16, 91);\n", undefined, "TAG01_SOURCE_OR_RECEIPT_CHANGED"],
    ["the receipt does not show TAG-01 passing", "authentication-evidence.json", JSON.stringify({ tag: "TAG-01", authentication_attempts: [1, 1, 1, 1, 2], keys: [] }), "authentication-evidence.json", "TAG01_RECEIPT_NOT_VERIFIED"],
    ["the source is not a 16-byte credential", "auth-only.mts", "const credential = Buffer.alloc(32);\n", "auth-only.mts", "ORIGINAL_FACTORY_SOURCE_UNSUPPORTED"],
  ])("refuses the credential source when %s, before using the reader", async (_name, file, content, repin, code) => {
    await writeFile(path.join(source, file), content);
    const card = new FakeCard();
    const hashes = repin ? { ...pinned, [repin]: sha(content) } : pinned;
    await expect(prepareFactoryTag({ transport: card, journal, custodyDir: custody, credentialSource: source, pinned: hashes, reader: READER })).rejects.toThrow(code);
    expect(card.sent).toEqual([]);
  });
});

describe("key file writer", () => {
  it("is create-exclusive: an existing file stays unchanged", async () => {
    const file = keyFileOf();
    await writeFile(file, "earlier", { mode: 0o600 });
    await expect(writeKeyFile(file, UID, KEY)).rejects.toThrow("CURRENT_KEY_FILE_NOT_CREATED");
    expect(await readFile(file, "utf8")).toBe("earlier");
  });
  it("does not follow a symlink, live or dangling", async () => {
    const target = path.join(custody, "target.json");
    await writeFile(target, "keep");
    await symlink(target, keyFileOf());
    await expect(writeKeyFile(keyFileOf(), UID, KEY)).rejects.toThrow("CURRENT_KEY_FILE_NOT_CREATED");
    expect(await readFile(target, "utf8")).toBe("keep");
    const dangling = path.join(custody, "dangling.json");
    await symlink(path.join(custody, "nowhere.json"), dangling);
    await expect(writeKeyFile(dangling, UID, KEY)).rejects.toThrow("CURRENT_KEY_FILE_NOT_CREATED");
    expect(await readdir(custody)).not.toContain("nowhere.json");
  });
});

describe("operator command output", () => {
  const capture = () => {
    const lines: string[] = [];
    const keep = (...values: unknown[]) => { lines.push(values.map(String).join(" ")); return true; };
    vi.spyOn(console, "log").mockImplementation(keep);
    vi.spyOn(console, "error").mockImplementation(keep);
    vi.spyOn(process.stdout, "write").mockImplementation(keep);
    vi.spyOn(process.stderr, "write").mockImplementation(keep);
    return lines;
  };
  const args = () => ["--reader", READER, "--custody-dir", custody, "--credential-source", source];

  it("prints the UID, paths and provenance reference but no key bytes, on success and on failure", async () => {
    vi.stubEnv("DATABASE_URL", "");
    const lines = capture();
    expect(await main(args(), { openReader: async () => new FakeCard(), journal, pinned })).toBe(0);
    const failing = new FakeCard();
    failing.keys[3] = Buffer.alloc(16, 1);
    await rm(keyFileOf()); await rm(path.join(evidence, `${UID}.tag-prep.json`));
    expect(await main(args(), { openReader: async () => failing, journal, pinned })).toBe(1);
    vi.restoreAllMocks();
    const output = lines.join("\n");
    expect(output).toContain(`UID ${UID}`);
    expect(output).toContain(keyFileOf());
    expect(output).toMatch(/Provenance reference: LOY-04de5f1eacc040-PREP-\d{8}-[a-f0-9]{8}/);
    expect(output).toContain("FAIL: TRANSPORT_AUTHENTICATION_FAILED_SLOT_3");
    expect(output.toLowerCase()).not.toContain(KEY.toString("hex"));
  });

  it("refuses to run where a database is configured, before opening the reader", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://synthetic@127.0.0.1:1/none");
    const lines = capture();
    const openReader = vi.fn(async () => new FakeCard());
    expect(await main(args(), { openReader, journal, pinned })).toBe(1);
    vi.restoreAllMocks();
    expect(openReader).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("FAIL: DATABASE_MUST_NOT_BE_REACHABLE_FROM_THE_OPERATOR_TOOL");
  });
});
