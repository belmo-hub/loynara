import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyseEvidence, EvidenceJournal, type EvidenceEvent } from "./evidence";

const note = { journalVersion: "2", uid: "04000000000001", keyRef: "dev_cpu_fixture", origin: "https://preview.getloynara.com", tenantId: "tenant", locationId: "location", programId: "programme", cooldownSeconds: "60", provenanceRef: "cpu-fixture-custody" };
const names = ["confirmed", "keys_saved", "reserved", "writing_ndef", "ndef_written", "changing_key1", "key1_changed", "changing_key2", "key2_changed", "changing_key3", "key3_changed", "changing_key4", "key4_changed", "keys_changed", "changing_settings", "settings_changed", "changing_key0", "key0_changed", "readback_verified", "active"];
const history = (last: string) => names.slice(0, names.indexOf(last) + 1).map((name): EvidenceEvent => ({ at: "2026-10-05T00:00:00Z", kind: name.startsWith("changing_") || name === "writing_ndef" ? "intent" : "stage", name, note }));

describe("durable NFC evidence state transitions", () => {
  it("distinguishes untouched, host preparation, configured, rotated and complete", () => {
    expect(analyseEvidence([])).toEqual({ state: "none" });
    expect(analyseEvidence(history("reserved"))).toMatchObject({ state: "restartable", lastStage: "reserved" });
    for (const lastStage of ["settings_changed", "key0_changed", "readback_verified"]) expect(analyseEvidence(history(lastStage))).toMatchObject({ state: "resumable", lastStage });
    expect(analyseEvidence(history("active"))).toEqual({ state: "complete" });
  });
  it.each(["writing_ndef", "changing_key1", "changing_key2", "changing_key3", "changing_key4", "changing_settings", "changing_key0"])("quarantines lost acknowledgments for %s", openIntent => {
    expect(analyseEvidence(history(openIntent))).toMatchObject({ state: "uncertain", openIntent });
    expect(analyseEvidence([...history(openIntent), { at: "2026-10-05T00:00:01Z", kind: "stage", name: "active", note }])).toMatchObject({ state: "uncertain" });
  });
  it.each(["ndef_written", "key1_changed", "key2_changed", "key3_changed", "key4_changed", "keys_changed"])("records %s without allowing restart or automatic partial-key recovery", lastStage => {
    expect(analyseEvidence(history(lastStage))).toMatchObject({ state: "uncertain", lastStage });
  });
  it("rejects mixed attempts, incomplete identity, unknown events and legacy evidence", () => {
    const events = history("settings_changed");
    expect(analyseEvidence([...events, { ...events.at(-1)!, note: { ...note, keyRef: "different" } }])).toMatchObject({ state: "uncertain", reason: expect.stringMatching(/mixed/) });
    expect(analyseEvidence(events.map(event => ({ ...event, note: { journalVersion: "2" } })))).toMatchObject({ state: "uncertain" });
    expect(analyseEvidence([...events, { ...events.at(-1)!, kind: "failure", name: "unknown" }])).toMatchObject({ state: "uncertain" });
    expect(analyseEvidence(events.map(event => ({ ...event, note: undefined })))).toMatchObject({ state: "uncertain" });
  });
  it("a failure report cannot erase an outstanding mutation", () => {
    const events = history("changing_key0");
    expect(analyseEvidence([...events, { at: "2026-10-05T00:00:01Z", kind: "failure", name: "provisioning_stopped", note }])).toMatchObject({ state: "uncertain", openIntent: "changing_key0" });
  });
  it("serializes attempts for the same UID and refuses a concurrent operator", async () => {
    await mkdir("var", { recursive: true });
    const root = await mkdtemp(path.resolve("var/nfc-journal-test-"));
    try {
      const journal = new EvidenceJournal(path.join(root, "new", "journal"));
      await journal.withExclusive("04000000000001", async () => {
        await expect(journal.withExclusive("04000000000001", async () => undefined)).rejects.toThrow(/locked/);
        await journal.record("04000000000001", { kind: "stage", name: "confirmed", note });
      });
      expect(await journal.verdict("04000000000001")).toMatchObject({ state: "restartable" });
      await journal.withExclusive("04000000000001", async () => undefined);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
