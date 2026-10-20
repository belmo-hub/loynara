import { mkdir, open, readFile, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/**
 * Non-secret stage evidence for a physical tag. One append-only JSON-lines file per chip UID.
 * It records WHAT was about to happen ("intent") and WHAT completed ("stage"), never key material, so an
 * interrupted provisioning leaves an honest answer to "is it safe to run this again?".
 */
export type EvidenceEvent = { at: string; kind: "intent" | "stage" | "failure"; name: string; note?: Record<string, string> };
export type EvidenceVerdict =
  | { state: "none" }
  | { state: "complete" }
  | { state: "restartable"; lastStage?: string }
  | { state: "resumable"; lastStage: string; openIntent?: string }
  | { state: "uncertain"; lastStage?: string; openIntent?: string; reason: string };

const NEXT: Record<string, string[]> = {
  untouched: ["confirmed"], confirmed: ["keys_saved"], keys_saved: ["reserved_ref", "reserved"], reserved_ref: ["reserved"],
  reserved: ["writing_ndef"], writing_ndef: ["ndef_written"], ndef_written: ["changing_key1"],
  changing_key1: ["key1_changed"], key1_changed: ["changing_key2"], changing_key2: ["key2_changed"],
  key2_changed: ["changing_key3"], changing_key3: ["key3_changed"], key3_changed: ["changing_key4"],
  changing_key4: ["key4_changed"], key4_changed: ["keys_changed"], keys_changed: ["changing_settings"],
  changing_settings: ["settings_changed"], settings_changed: ["changing_key0"], changing_key0: ["key0_changed"],
  key0_changed: ["readback_verified"], readback_verified: ["readback_verified", "active"], active: [],
};
const INTENTS = new Set(Object.keys(NEXT).filter(name => name.startsWith("changing_") || name === "writing_ndef"));

/** Pure: reduce an event list to what the operator may do next. Anything it cannot prove safe is "uncertain". */
export function analyseEvidence(events: EvidenceEvent[]): EvidenceVerdict {
  if (events.length === 0) return { state: "none" };
  let open: string | undefined;
  let last: string | undefined;
  let cursor = "untouched";
  const binding: Record<string, string> = {};
  let prepared: boolean | undefined;
  const uncertain = (reason: string): EvidenceVerdict => ({ state: "uncertain", lastStage: last, openIntent: open, reason });
  for (const event of events) {
    if (!event || typeof event.at !== "string" || !Number.isFinite(Date.parse(event.at)) || typeof event.name !== "string" || !event.note || event.note.journalVersion !== "2") return uncertain("malformed or legacy evidence requires manual review");
    const present = (keys: string[]) => keys.every(key => typeof event.note![key] === "string" && event.note![key].length > 0);
    // A shop binding, or only a plate label (an unlinked plate), never both.
    const shop = present(["tenantId", "locationId", "programId", "cooldownSeconds"]);
    if (!present(["uid", "keyRef", "origin", "provenanceRef"]) || shop === present(["plateLabel"]) || !/^[a-f0-9]{14}$/.test(event.note.uid)) return uncertain("incomplete evidence identity or environment binding");
    const hasPlan = event.note.planFingerprint !== undefined;
    if (prepared !== undefined && prepared !== hasPlan) return uncertain("mixed prepared and legacy evidence");
    prepared = hasPlan;
    if (hasPlan && (!/^[a-f0-9]{64}$/.test(event.note.planFingerprint) || !["custodyId", "tagLabel", "environment", "slotFingerprints", "settingsHex", "policy"].every(k => typeof event.note![k] === "string" && event.note![k].length > 0))) return uncertain("incomplete prepared-plan identity");
    if (event.name === "reserved_ref" && !/^[A-Za-z0-9_-]{24}$/.test(event.note.publicRef ?? "")) return uncertain("invalid reserved reference");
    for (const [key, value] of Object.entries(event.note)) {
      if (typeof value !== "string") return uncertain("malformed evidence binding");
      if (["uid", "keyRef", "origin", "tenantId", "locationId", "programId", "cooldownSeconds", "plateLabel", "publicRef", "provenanceRef", "planFingerprint", "custodyId", "tagLabel", "environment", "slotFingerprints", "settingsHex", "policy", "tagId"].includes(key)) {
        if (binding[key] !== undefined && binding[key] !== value) return uncertain("mixed attempts or environment bindings");
        binding[key] = value;
      }
    }
    if (event.kind === "failure" && event.name === "provisioning_stopped") continue;
    if ((event.kind !== "intent" && event.kind !== "stage") || INTENTS.has(event.name) !== (event.kind === "intent") || !NEXT[cursor]?.includes(event.name)) return uncertain("out-of-order or unknown evidence transition");
    cursor = event.name;
    if (event.kind === "intent") open = event.name;
    else { open = undefined; last = event.name; }
  }
  if (open) return uncertain(`unacknowledged mutation: ${open}`);
  if (last === "active") return { state: "complete" };
  if (last === "settings_changed" || last === "key0_changed" || last === "readback_verified") return { state: "resumable", lastStage: last };
  if (["confirmed", "keys_saved", "reserved_ref", "reserved"].includes(last ?? "")) return { state: "restartable", lastStage: last };
  return uncertain("NDEF staged or keys partially rotated; explicit recovery required");
}

export class EvidenceJournal {
  readonly root: string;
  constructor(root = path.resolve("var/nfc-evidence")) {
    if (!root.startsWith(path.resolve("var") + path.sep)) throw new Error("NFC evidence must stay in ignored var/");
    this.root = root;
  }
  private file(uid: string) {
    if (!/^[a-f0-9]{14}$/.test(uid)) throw new Error("Invalid chip UID");
    return path.join(this.root, `${uid}.jsonl`);
  }
  private async ensureRoot(): Promise<void> {
    const created = await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (!created) return;
    const stop = path.dirname(created);
    for (let directory = this.root; ; directory = path.dirname(directory)) {
      const handle = await open(directory, constants.O_RDONLY);
      try { await handle.sync(); } finally { await handle.close(); }
      if (directory === stop) break;
    }
  }
  /** One operator attempt per UID. A stale lock requires review; it is never reclaimed automatically. */
  async withExclusive<T>(uid: string, action: () => Promise<T>): Promise<T> {
    await this.ensureRoot();
    const lock = `${this.file(uid)}.lock`;
    let handle;
    try { handle = await open(lock, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600); }
    catch { throw new Error("NFC evidence is locked by another or interrupted operator attempt; stop for review"); }
    try { await handle.sync(); return await action(); }
    finally { await handle.close(); await unlink(lock); }
  }
  async record(uid: string, event: Omit<EvidenceEvent, "at">): Promise<void> {
    if (event.note?.uid !== uid) throw new Error("Evidence chip identity does not match its journal");
    await this.ensureRoot();
    const file = await open(this.file(uid), constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try { await file.writeFile(`${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`); await file.sync(); }
    finally { await file.close(); }
    // Persist creation of the entry too, before a hardware command may follow the intent.
    const directory = await open(this.root, constants.O_RDONLY);
    try { await directory.sync(); } finally { await directory.close(); }
  }
  async read(uid: string): Promise<EvidenceEvent[]> {
    try { return (await readFile(this.file(uid), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as EvidenceEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async verdict(uid: string): Promise<EvidenceVerdict> { return analyseEvidence(await this.read(uid)); }
}
