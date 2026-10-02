import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster } from "../nfc-keys";
import { dynamicNdef } from "../nfc-test-support";
import { verifySdm } from "../secure-tap-crypto";
import { ProvisionUncertain, type ProvisionTag } from "./flow";
import { EvidenceJournal, analyseEvidence } from "./evidence";
import { ndefTemplate } from "./ntag";
import { classifyFileSettings } from "./inspect";
import { NfcOperatorRefusal, assertProductionOperatorEnvironment, assertTagOrigin, bundleSchema, PREVIEW_ORIGIN } from "./production";
import { inspectChip, resumeProductionProvisioning, runProductionProvisioning } from "./production-run";

const VERIFY_HEX = "7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
const ADMIN_HEX = "c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e";
const ORIGIN = "https://app.example-pilot.test";
const env = { PRODUCTION_APPROVED_ORIGIN: ORIGIN, NFC_VERIFY_MASTER_KEY: VERIFY_HEX, NFC_ADMIN_MASTER_KEY: ADMIN_HEX };
const binding = { tenantId: "11111111-1111-4111-8111-111111111111", locationId: "22222222-2222-4222-8222-222222222222", programId: "33333333-3333-4333-8333-333333333333", cooldownSeconds: 60 };
const UID = "04de5f1eacc040";
const zero = Buffer.alloc(16);
const refusalCode = async (fn: () => unknown) => { try { await fn(); } catch (error) { return error instanceof NfcOperatorRefusal ? error.code : "OTHER"; } return "NONE"; };

/** A chip that behaves like an NTAG 424 DNA for the operations the tool uses, keeps its state across tool runs, and can be interrupted. */
class FakeChip {
  keys: Record<number, Buffer> = { 0: zero, 1: zero, 2: zero, 3: zero, 4: zero };
  configured = false;
  ndef: Buffer | null = null;
  template?: ReturnType<typeof ndefTemplate>;
  reads = 0;
  writes: string[] = [];
  failOn?: string;                       // throw BEFORE the operation takes effect
  failAfter?: string;                    // take effect, then throw (the host loses the answer)
  presentedUid = UID;
  private maybe(op: string, apply: () => void) {
    if (this.failOn === op) throw new Error(`interrupted before ${op}`);
    apply();
    if (this.failAfter === op) throw new Error(`interrupted after ${op}`);
  }
  adapter(): ProvisionTag {
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the adapter object's methods need the fake chip, not themselves
    const chip = this;
    return {
      async version() { return { uid: chip.presentedUid, hardware: "04040830001105", software: "04040201011105", production: "11223344556677" }; },
      async reconnect() { /* no state */ },
      async readFileSettings() { return chip.configured ? Buffer.concat([Buffer.from("004000e0000100", "hex"), chip.template!.settings.subarray(3)]) : Buffer.from("0000e0ee000100", "hex"); },
      async writeNdef(data: Buffer) { chip.maybe("ndef-write", () => { chip.writes.push("ndef"); chip.ndef = Buffer.from(data); chip.template = ndefTemplateFromImage(data); }); },
      async readNdef() {
        if (!chip.configured) return chip.ndef!;
        chip.reads += 1;
        return dynamicNdef(ORIGIN_OF(chip), refOf(chip), UID, chip.reads + 1, { metaReadKey: chip.keys[2], fileReadKey: chip.keys[1] });
      },
      async authenticateFirst(number: number, key: Buffer) { if (!key.equals(chip.keys[number])) throw new Error("authentication failed"); },
      async changeKey(number: number, next: Buffer) { chip.maybe(`change-key-${number}`, () => { chip.writes.push(`key${number}`); chip.keys[number] = Buffer.from(next); }); },
      async changeFileSettings() { chip.maybe("change-settings", () => { chip.writes.push("settings"); chip.configured = true; }); },
    } as ProvisionTag;
  }
}
const ORIGIN_OF = (chip: FakeChip) => new URL(Buffer.from(chip.ndef!.subarray(7)).toString("ascii")).origin;
const refOf = (chip: FakeChip) => new URL(Buffer.from(chip.ndef!.subarray(7, chip.ndef!.readUInt16BE(0) + 2)).toString("ascii")).pathname.split("/")[2];
function ndefTemplateFromImage(data: Buffer) {
  const url = new URL(Buffer.from(data.subarray(7, data.readUInt16BE(0) + 2)).toString("ascii"));
  return ndefTemplate(url.origin, url.pathname.split("/")[2]);
}

let root = "";
let journal: EvidenceJournal;
beforeEach(async () => { await (await import("node:fs/promises")).mkdir("var", { recursive: true }); root = await mkdtemp(path.resolve("var/nfc-evidence-test-")); journal = new EvidenceJournal(root); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

const run = (chip: FakeChip, options: { execute?: boolean; confirmed?: boolean } = {}) => runProductionProvisioning({
  transport: { async transmit() { throw new Error("transport must not be used directly"); } }, tagFactory: () => chip.adapter(),
  journal, env, origin: ORIGIN, binding, execute: options.execute ?? true, confirm: async () => options.confirmed ?? true,
});
const resume = (chip: FakeChip, confirmed = true) => resumeProductionProvisioning({
  transport: { async transmit() { throw new Error("transport must not be used directly"); } }, tagFactory: () => chip.adapter(),
  journal, env, origin: ORIGIN, binding, confirm: async () => confirmed,
});

describe("production target guard", () => {
  it("accepts only the approved production origin with both masters, distinct, and no database or development keys", () => {
    const ok = assertProductionOperatorEnvironment(env, ORIGIN);
    expect(ok.verifyMaster).toHaveLength(32);
  });
  it.each([
    ["preview origin", { ...env, PRODUCTION_APPROVED_ORIGIN: PREVIEW_ORIGIN }, PREVIEW_ORIGIN, "PRODUCTION_ORIGIN_IS_NOT_PRODUCTION"],
    ["pages.dev origin", { ...env, PRODUCTION_APPROVED_ORIGIN: "https://x.pages.dev" }, "https://x.pages.dev", "PRODUCTION_ORIGIN_IS_NOT_PRODUCTION"],
    ["origin is not the approved one", env, "https://other.example-pilot.test", "ORIGIN_NOT_THE_APPROVED_PRODUCTION_ORIGIN"],
    ["http origin", { ...env, PRODUCTION_APPROVED_ORIGIN: "http://app.example-pilot.test" }, "http://app.example-pilot.test", "ORIGIN_NOT_A_BARE_HTTPS_ORIGIN"],
    ["origin with a path", env, `${ORIGIN}/login`, "ORIGIN_NOT_A_BARE_HTTPS_ORIGIN"],
    ["a database is reachable", { ...env, DATABASE_URL: "postgresql://u:p@db.railway.internal/x" }, ORIGIN, "DATABASE_MUST_NOT_BE_REACHABLE_FROM_THE_OPERATOR_TOOL"],
    ["development key file", { ...env, TAP_SYNTHETIC_KEY_FILE: "/tmp/k.json" }, ORIGIN, "DEVELOPMENT_SETTINGS_PRESENT"],
    ["device-test settings", { ...env, DEVICE_TEST_APPROVED_ORIGIN: PREVIEW_ORIGIN }, ORIGIN, "DEVELOPMENT_SETTINGS_PRESENT"],
    ["no admin master", { ...env, NFC_ADMIN_MASTER_KEY: undefined }, ORIGIN, "MASTER_INVALID"],
    ["same master twice", { ...env, NFC_ADMIN_MASTER_KEY: VERIFY_HEX }, ORIGIN, "MASTERS_NOT_DISTINCT"],
    ["placeholder master", { ...env, NFC_VERIFY_MASTER_KEY: "a".repeat(64) }, ORIGIN, "MASTER_INVALID"],
  ])("refuses: %s", async (_name, e, origin, code) => {
    expect(await refusalCode(() => assertProductionOperatorEnvironment(e, origin))).toBe(code);
  });
  it("preview URLs and production URLs are never interchangeable", async () => {
    expect(() => assertTagOrigin("preview", PREVIEW_ORIGIN, {})).not.toThrow();
    expect(await refusalCode(() => assertTagOrigin("preview", ORIGIN, env))).toBe("PREVIEW_ORIGIN_REQUIRED");
    expect(await refusalCode(() => assertTagOrigin("production", PREVIEW_ORIGIN, { PRODUCTION_APPROVED_ORIGIN: PREVIEW_ORIGIN }))).toBe("PRODUCTION_ORIGIN_IS_NOT_PRODUCTION");
  });
});

describe("dry run is the default and changes nothing", () => {
  it("inspects, reports what it would change, and writes nothing to the chip or the evidence journal", async () => {
    const chip = new FakeChip();
    const outcome = await run(chip, { execute: false });
    expect(outcome.mode).toBe("dry_run");
    if (outcome.mode !== "dry_run") return;
    expect(outcome.inspection).toMatchObject({ uid: UID, condition: "factory", evidence: "none" });
    expect(outcome.wouldChange.join(" ")).toMatch(/AES keys 1-4/);
    expect(chip.writes).toEqual([]);
    expect(await readdir(root)).toEqual([]);
    expect(classifyFileSettings(Buffer.from("0000e0ee000100", "hex"))).toBe("factory");
  });
  it("is blocked, not executed, for a chip that is not in the factory state", async () => {
    const chip = new FakeChip(); chip.configured = true; chip.template = ndefTemplate(ORIGIN, "abcdefghijklmnopqrstuvwx"); chip.ndef = chip.template.bytes;
    const outcome = await run(chip, { execute: false });
    expect(outcome).toMatchObject({ mode: "dry_run", blockedBy: expect.stringMatching(/factory/) });
    await expect(run(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
    expect(chip.writes).toEqual([]);
  });
  it("without the operator's typed confirmation nothing is written", async () => {
    const chip = new FakeChip();
    await expect(run(chip, { confirmed: false })).rejects.toThrow();
    expect(chip.writes).toEqual([]);
  });
});

describe("execution: derived keys, evidence and a registration bundle with no secrets", () => {
  it("provisions with the derived keys and produces a bundle the server can verify", async () => {
    const chip = new FakeChip();
    const outcome = await run(chip);
    if (outcome.mode !== "provisioned") throw new Error("expected provisioned");
    const { bundle } = outcome;
    expect(bundleSchema.parse(bundle)).toEqual(bundle);
    const keys = deriveTagKeys({ verifyMaster: parseMaster(VERIFY_HEX), adminMaster: parseMaster(ADMIN_HEX), ref: bundle.keyRef, uid: UID });
    expect(chip.keys[0].equals(keys.key0) && chip.keys[1].equals(keys.fileReadKey) && chip.keys[2].equals(keys.metaReadKey) && chip.keys[3].equals(keys.key3) && chip.keys[4].equals(keys.key4)).toBe(true);
    expect(chip.keys[0].equals(zero)).toBe(false);
    // the server, holding only the VERIFY master, accepts the bundle's proof
    const sample = new URL(bundle.sampleUrl);
    const serverKeys = await new DerivedTapKeyProvider(parseMaster(VERIFY_HEX)).getKeys(bundle.keyRef, { uid: bundle.uid });
    expect(verifySdm({ encrypted: sample.searchParams.get("e")!, mac: sample.searchParams.get("c")! }, serverKeys)).toEqual({ uid: UID, counter: bundle.secondCounter });
    expect(sample.origin).toBe(ORIGIN);
    expect(analyseEvidence(await journal.read(UID))).toEqual({ state: "complete" });
  });
  it("leaves no key material or master in the evidence journal or the bundle", async () => {
    const chip = new FakeChip();
    const outcome = await run(chip);
    if (outcome.mode !== "provisioned") throw new Error("expected provisioned");
    const text = (await readFile(path.join(root, `${UID}.jsonl`), "utf8")) + JSON.stringify(outcome.bundle);
    const keys = deriveTagKeys({ verifyMaster: parseMaster(VERIFY_HEX), adminMaster: parseMaster(ADMIN_HEX), ref: outcome.bundle.keyRef, uid: UID });
    for (const secret of [VERIFY_HEX, ADMIN_HEX, ...Object.values(keys).map(key => key.toString("hex"))]) expect(text).not.toContain(secret);
    expect(text).not.toMatch(/master|admin/i);
  });
  it("refuses to run again on a chip it already completed", async () => {
    const chip = new FakeChip();
    await run(chip);
    const before = chip.writes.length;
    expect(await run(chip, { execute: false })).toMatchObject({ mode: "dry_run", blockedBy: expect.stringMatching(/already provisioned/) });
    await expect(run(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
    expect(chip.writes.length).toBe(before);
  });
});

describe("interrupted provisioning is recorded and never blindly repeated", () => {
  it.each(["change-key-1", "change-key-2", "change-key-3", "change-key-4"])("an interruption at %s leaves an uncertain record, and the next run stops before touching the chip", async point => {
    const chip = new FakeChip(); chip.failAfter = point;
    await expect(run(chip)).rejects.toThrow();
    const verdict = analyseEvidence(await journal.read(UID));
    expect(verdict).toMatchObject({ state: "uncertain", openIntent: "changing_keys" });
    const writes = [...chip.writes];
    chip.failAfter = undefined;
    expect(await run(chip, { execute: false })).toMatchObject({ mode: "dry_run", blockedBy: expect.stringMatching(/interrupted earlier/) });
    await expect(run(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
    await expect(resume(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
    expect(chip.writes).toEqual(writes);
  });
  it("an interruption while changing the file settings is uncertain too", async () => {
    const chip = new FakeChip(); chip.failAfter = "change-settings";
    await expect(run(chip)).rejects.toThrow();
    expect(analyseEvidence(await journal.read(UID))).toMatchObject({ state: "uncertain", openIntent: "changing_settings" });
    chip.failAfter = undefined;
    await expect(run(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
  });
  it("an interruption while writing the static NDEF is safe to restart (the chip is still factory-keyed)", async () => {
    const chip = new FakeChip(); chip.failOn = "ndef-write";
    await expect(run(chip)).rejects.toThrow();
    expect(analyseEvidence(await journal.read(UID))).toMatchObject({ state: "restartable" });
    chip.failOn = undefined;
    const outcome = await run(chip);
    expect(outcome.mode).toBe("provisioned");
  });
});

describe("resume after the settings are configured (bounded key-0 probe)", () => {
  it("finishes when key 0 was NOT yet changed (factory key still works)", async () => {
    const chip = new FakeChip(); chip.failOn = "change-key-0";
    await expect(run(chip)).rejects.toThrow();
    expect(analyseEvidence(await journal.read(UID))).toMatchObject({ state: "resumable", openIntent: "changing_key0" });
    await expect(run(chip, { execute: false })).resolves.toMatchObject({ blockedBy: expect.stringMatching(/resume/) });
    await expect(run(chip)).rejects.toBeInstanceOf(ProvisionUncertain);   // a restart is refused: resume only
    chip.failOn = undefined;
    const outcome = await resume(chip);
    expect(outcome.mode).toBe("resumed");
    if (outcome.mode === "resumed") expect(outcome.bundle.uid).toBe(UID);
    expect(chip.keys[0].equals(zero)).toBe(false);
    expect(analyseEvidence(await journal.read(UID))).toEqual({ state: "complete" });
  });
  it("finishes when key 0 WAS changed but the answer was lost (derived key works)", async () => {
    const chip = new FakeChip(); chip.failAfter = "change-key-0";
    await expect(run(chip)).rejects.toThrow();
    const writesBefore = chip.writes.filter(w => w === "key0").length;
    const outcome = await resume(chip);
    expect(outcome.mode).toBe("resumed");
    expect(chip.writes.filter(w => w === "key0").length).toBe(writesBefore);   // key 0 is not changed a second time
  });
  it("stops when key 0 matches neither the derived nor the factory key", async () => {
    const chip = new FakeChip(); chip.failOn = "change-key-0";
    await expect(run(chip)).rejects.toThrow();
    chip.failOn = undefined; chip.keys[0] = Buffer.alloc(16, 9);
    await expect(resume(chip)).rejects.toThrow(/neither/);
    expect(chip.keys[0].equals(Buffer.alloc(16, 9))).toBe(true);
  });
  it("needs the operator's confirmation for the probe and refuses a different chip", async () => {
    const chip = new FakeChip(); chip.failOn = "change-key-0";
    await expect(run(chip)).rejects.toThrow();
    chip.failOn = undefined;
    await expect(resume(chip, false)).rejects.toThrow(/confirm/);
    chip.presentedUid = "04aaaaaaaaaaaa";
    await expect(resume(chip)).rejects.toBeInstanceOf(ProvisionUncertain);
  });
});

describe("read-only inspection", () => {
  it("never authenticates or writes", async () => {
    const chip = new FakeChip();
    const found = await inspectChip({ transport: { async transmit() { throw new Error("no"); } }, tagFactory: () => chip.adapter(), journal });
    expect(found).toMatchObject({ uid: UID, condition: "factory", evidence: "none" });
    expect(chip.writes).toEqual([]);
  });
});
