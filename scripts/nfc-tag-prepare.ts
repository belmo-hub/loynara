import { createHash, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { EvidenceJournal } from "../src/lib/nfc-provision/evidence";
import { Ntag424, selectNdefApplication, type ApduTransport } from "../src/lib/nfc-provision/ntag";
import { NfcOperatorRefusal } from "../src/lib/nfc-provision/production";
import { inspectChip } from "../src/lib/nfc-provision/production-run";
import { syncDirectory } from "./nfc-operator-bundle";

/**
 * New factory tag, on the operator Mac with the reader: read-only inspection, one AuthenticateEV2First per slot 0-4 with
 * the factory transport credential, then the UID-bound current-key file for `nfc-operator.ts provision` and a
 * non-secret evidence form whose id is the provenance reference. No tag write, no key change, no database.
 */
const refuse = (code: string): never => { throw new NfcOperatorRefusal(code); };
const EXCLUSIVE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;
const SOURCE = "auth-only.mts";
const RECEIPT = "authentication-evidence.json";
// The reviewed TAG-01 transport-check files the TAG-02 controllers pinned (keys1_4_auth.py, 15 Oct 2026).
export const PINNED_SOURCE: Record<string, string> = {
  [SOURCE]: "f1febd321f28348f6ac3572ace5ed485e3e216badc41abb8b9c059a7c10264ae",
  [RECEIPT]: "e756dc81f23d04eea71b9fb239f22da074ff8c4b71a012a1f0c6099436876f57",
};

/** Same rules as keys1_4_auth.py: both hashes, the TAG-01 receipt, then exactly one 16-byte credential in the source. */
export async function factoryCredential(folder: string, pinned = PINNED_SOURCE): Promise<Buffer> {
  const raw: Record<string, Buffer> = {};
  try { for (const name of [SOURCE, RECEIPT]) raw[name] = await readFile(path.join(folder, name)); }
  catch { refuse("TAG01_SOURCE_OR_RECEIPT_CHANGED"); }
  if (![SOURCE, RECEIPT].every(name => createHash("sha256").update(raw[name]).digest("hex") === pinned[name])) refuse("TAG01_SOURCE_OR_RECEIPT_CHANGED");
  let receipt: { tag?: unknown; authentication_attempts?: unknown; keys?: Record<number, { result?: unknown; slot?: unknown } | undefined> } = {};
  try { receipt = JSON.parse(raw[RECEIPT].toString("utf8")); } catch { refuse("TAG01_RECEIPT_NOT_VERIFIED"); }
  if (receipt?.tag !== "TAG-01" || JSON.stringify(receipt.authentication_attempts) !== "[1,1,1,1,1]" || ![1, 2, 3, 4].every(slot => receipt.keys?.[slot]?.result === "PASS" && receipt.keys[slot]?.slot === slot)) refuse("TAG01_RECEIPT_NOT_VERIFIED");
  const matches = [...raw[SOURCE].toString("utf8").matchAll(/const\s+credential\s*=\s*Buffer\.alloc\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\);/g)];
  const fill = Number(matches[0]?.[2] ?? 0);
  if (matches.length !== 1 || Number(matches[0][1]) !== 16 || fill > 255) refuse("ORIGINAL_FACTORY_SOURCE_UNSUPPORTED");
  return Buffer.alloc(16, fill);
}

/** Create-exclusive, never through a symlink, exactly mode 600; the format `loadTransportKeyCustody` reads. */
export async function writeKeyFile(file: string, uid: string, key: Buffer): Promise<void> {
  const hex = key.toString("hex");
  const data = `${JSON.stringify({ uid, key0: hex, fileReadKey: hex, metaReadKey: hex, key3: hex, key4: hex })}\n`;
  const handle = await open(file, EXCLUSIVE, 0o600).catch(() => refuse("CURRENT_KEY_FILE_NOT_CREATED"));
  try { await handle.chmod(0o600); await handle.writeFile(data); await handle.sync(); }
  catch (error) { await handle.close(); await unlink(file).catch(() => undefined); throw error; }
  await handle.close();
  await syncDirectory(path.dirname(file));
}

const reason = (error: unknown) => error instanceof NfcOperatorRefusal ? error.code : error instanceof Error ? error.message : "stopped";

export async function prepareFactoryTag(input: { transport: ApduTransport; journal: EvidenceJournal; custodyDir: string; credentialSource: string; reader: string; pinned?: Record<string, string> }) {
  const folder = await lstat(input.custodyDir).catch(() => undefined);
  if (!folder?.isDirectory() || (folder.mode & 0o077) !== 0) refuse("CUSTODY_DIRECTORY_UNSAFE");
  const credential = await factoryCredential(input.credentialSource, input.pinned);
  try {
    const inspection = await inspectChip({ transport: input.transport, journal: input.journal });
    if (inspection.condition !== "factory") refuse("TAG_NOT_FACTORY");
    if (inspection.evidence !== "none") refuse("EVIDENCE_EXISTS");
    const { uid } = inspection;
    const keyFile = path.join(input.custodyDir, `${uid}.current-keys.json`);
    if (await lstat(keyFile).then(() => true, (error: NodeJS.ErrnoException) => error.code !== "ENOENT")) refuse("CURRENT_KEY_FILE_EXISTS");

    // The form is claimed before the first authentication, so a stopped or interrupted run is never repeated.
    await mkdir(input.journal.root, { recursive: true, mode: 0o700 });
    const formFile = path.join(input.journal.root, `${uid}.tag-prep.json`);
    const form = await open(formFile, EXCLUSIVE, 0o600).catch(() => refuse("EVIDENCE_EXISTS"));
    const provenanceRef = `LOY-${uid}-PREP-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${randomBytes(4).toString("hex")}`;
    const record = {
      form: "nfc-tag-prep-v1", provenanceRef, uid, reader: input.reader, startedAt: new Date().toISOString(), status: "authenticating",
      inspection: { hardware: inspection.version.hardware, software: inspection.version.software, production: inspection.version.production, fileSettings: inspection.fileSettings, condition: inspection.condition, evidence: inspection.evidence },
      credentialSourceSha256: input.pinned ?? PINNED_SOURCE, slots: [] as { slot: number; result: "PASS"; attempts: 1 }[],
    };
    const save = async (extra: Record<string, unknown> = {}) => {
      const data = Buffer.from(`${JSON.stringify({ ...record, ...extra }, null, 2)}\n`);
      await form.truncate(0); await form.write(data, 0, data.length, 0); await form.sync();
    };
    try {
      await save(); await syncDirectory(input.journal.root);
      const tag = new Ntag424(input.transport);
      for (let slot = 0; slot < 5; slot++) {
        await selectNdefApplication(input.transport);
        try { await tag.authenticateFirst(slot, credential); }
        catch (error) { refuse(`TRANSPORT_AUTHENTICATION_FAILED_SLOT_${slot} (${reason(error)}); no retry, quarantine the tag`); }
        record.slots.push({ slot, result: "PASS", attempts: 1 });
      }
      if ((await tag.version()).uid !== uid) refuse("TAG_CHANGED_DURING_PREPARATION");
      await writeKeyFile(keyFile, uid, credential);
      await save({
        status: "transport_keys_verified", finishedAt: new Date().toISOString(), currentKeyFile: { path: keyFile, mode: "600", madeBy: "scripts/nfc-tag-prepare.ts" },
        stillByHand: ["(b) Read_Sig in NXP TagInfo", "(c) supplier, order and statement for this UID", "decision: write or quarantine, and A-5"],
      });
      return { uid, keyFile, formFile, provenanceRef };
    } catch (error) {
      await save({ status: "stopped", finishedAt: new Date().toISOString(), stoppedReason: reason(error) }).catch(() => undefined);
      throw error;
    } finally { await form.close(); }
  } finally { credential.fill(0); }
}

type Reader = ApduTransport & { close(): Promise<void> };
async function openPcscReader(name: string): Promise<Reader> {
  const { PcscBridge } = await import("../src/lib/nfc-provision/pcsc");
  const bridge = new PcscBridge();
  try {
    if (!(await bridge.readers()).includes(name)) throw new Error("Selected reader is unavailable");
    await bridge.connect(name);
    return bridge;
  } catch (error) { await bridge.close(); throw error; }
}

export async function main(argv: string[], deps: { openReader?: (name: string) => Promise<Reader>; journal?: EvidenceJournal; pinned?: Record<string, string> } = {}): Promise<number> {
  try {
    if (process.env.DATABASE_URL) refuse("DATABASE_MUST_NOT_BE_REACHABLE_FROM_THE_OPERATOR_TOOL");
    const { values } = parseArgs({ args: argv, strict: true, options: { reader: { type: "string" }, "custody-dir": { type: "string" }, "credential-source": { type: "string" } } });
    const { reader, "custody-dir": custodyDir, "credential-source": credentialSource } = values;
    if (!reader || !custodyDir || !credentialSource) throw new Error("--reader, --custody-dir and --credential-source are required");
    const transport = await (deps.openReader ?? openPcscReader)(reader);
    try {
      const done = await prepareFactoryTag({ transport, journal: deps.journal ?? new EvidenceJournal(), custodyDir: path.resolve(custodyDir), credentialSource: path.resolve(credentialSource), reader, pinned: deps.pinned });
      console.log(`UID ${done.uid}: factory, no evidence; slots 0-4 authenticated with the factory transport credential, one attempt each.`);
      console.log(`Current-key file (mode 600): ${done.keyFile}. Key material was not printed.`);
      console.log(`Evidence form: ${done.formFile}`);
      console.log(`Provenance reference: ${done.provenanceRef}`);
      console.log("Still by hand (runbook 03-tags §4): (b) Read_Sig in TagInfo, (c) supplier statement for this UID, decision and A-5.");
    } finally { await transport.close(); }
    return 0;
  } catch (error) {
    console.error(`FAIL: ${reason(error)}`);
    return 1;
  }
}

if (process.argv[1]?.endsWith("nfc-tag-prepare.ts")) main(process.argv.slice(2)).then(code => { process.exitCode = code; });
