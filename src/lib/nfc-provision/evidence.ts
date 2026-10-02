import { appendFile, mkdir, readFile } from "node:fs/promises";
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

const KEY_CHANGING = new Set(["changing_keys", "changing_settings"]);

/** Pure: reduce an event list to what the operator may do next. Anything it cannot prove safe is "uncertain". */
export function analyseEvidence(events: EvidenceEvent[]): EvidenceVerdict {
  if (events.length === 0) return { state: "none" };
  let open: string | undefined;
  let last: string | undefined;
  let keyChangeStarted = false;
  for (const event of events) {
    if (event.kind === "intent") { open = event.name; if (KEY_CHANGING.has(event.name)) keyChangeStarted = true; }
    else if (event.kind === "stage") { open = undefined; last = event.name; }
  }
  if (last === "active") return { state: "complete" };
  if (open === "changing_key0" || (last === "settings_changed" && !open)) return { state: "resumable", lastStage: last ?? "settings_changed", openIntent: open };
  if (open && KEY_CHANGING.has(open)) return { state: "uncertain", lastStage: last, openIntent: open, reason: `interrupted while ${open.replace("_", " ")}` };
  if (last === "keys_changed") return { state: "uncertain", lastStage: last, reason: "keys were changed but the file settings were not" };
  if (keyChangeStarted) return { state: "uncertain", lastStage: last, openIntent: open, reason: "a key change was started earlier" };
  return { state: "restartable", lastStage: last };
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
  async record(uid: string, event: Omit<EvidenceEvent, "at">): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    await appendFile(this.file(uid), `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, { mode: 0o600 });
  }
  async read(uid: string): Promise<EvidenceEvent[]> {
    try { return (await readFile(this.file(uid), "utf8")).split("\n").filter(Boolean).map(line => JSON.parse(line) as EvidenceEvent); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  }
  async verdict(uid: string): Promise<EvidenceVerdict> { return analyseEvidence(await this.read(uid)); }
}
