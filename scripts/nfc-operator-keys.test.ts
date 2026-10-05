import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadTransportKeyCustody } from "./nfc-operator-keys";

const folder = mkdtempSync(path.join(os.tmpdir(), "nfc-custody-test-"));
afterAll(() => rmSync(folder, { recursive: true, force: true }));
const fixture = {
  uid: "04de5f1eacc040", key0: "10".repeat(16), fileReadKey: "20".repeat(16), metaReadKey: "30".repeat(16), key3: "40".repeat(16), key4: "50".repeat(16),
};
let serial = 0;
function save(value: unknown, mode = 0o600) {
  const file = path.join(folder, `${serial++}.json`);
  writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value), { mode });
  chmodSync(file, mode);
  return file;
}

describe("explicit transport-key custody", () => {
  it("loads all explicit AES slots and binds them to the custody UID", async () => {
    const loaded = await loadTransportKeyCustody(save(fixture));
    expect(loaded.expectedUid).toBe("04de5f1eacc040");
    expect(loaded.currentKeys.key0).toEqual(Buffer.alloc(16, 0x10));
    expect(loaded.currentKeys.fileReadKey).toEqual(Buffer.alloc(16, 0x20));
    expect(loaded.currentKeys.metaReadKey).toEqual(Buffer.alloc(16, 0x30));
    expect(loaded.currentKeys.key3).toEqual(Buffer.alloc(16, 0x40));
    expect(loaded.currentKeys.key4).toEqual(Buffer.alloc(16, 0x50));
  });
  it.each([{ ...fixture, key0: undefined }, { ...fixture, key0: "xyz" }, { ...fixture, key3: "60".repeat(32) }, { ...fixture, uid: undefined }, { ...fixture, uid: "other-card" }, "not-json"])("refuses incomplete/malformed custody without echoing credentials %j", async value => {
    const error = await loadTransportKeyCustody(save(value)).then(() => "UNEXPECTED_SUCCESS", e => String(e));
    expect(error).toMatch(/TRANSPORT_KEYS_INVALID/);
    for (const secret of [fixture.key0, fixture.fileReadKey, fixture.metaReadKey, fixture.key3, fixture.key4]) expect(error).not.toContain(secret);
  });
  it("refuses key files readable by other users", async () => {
    await expect(loadTransportKeyCustody(save(fixture, 0o644))).rejects.toThrow(/TRANSPORT_KEYS_INVALID/);
  });
  it("refuses symlink custody", async () => {
    const link = path.join(folder, "symlink.json");
    symlinkSync(save(fixture), link);
    await expect(loadTransportKeyCustody(link)).rejects.toThrow(/TRANSPORT_KEYS_INVALID/);
  });
  it("sanitizes file errors without exposing the custody path", async () => {
    const missing = path.join(folder, "private-sensitive-name.json");
    const error = await loadTransportKeyCustody(missing).then(() => "UNEXPECTED_SUCCESS", e => String(e));
    expect(error).toMatch(/TRANSPORT_KEYS_INVALID/);
    expect(error).not.toContain(missing);
  });
});
