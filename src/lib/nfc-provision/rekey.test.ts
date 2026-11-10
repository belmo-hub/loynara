import { describe, expect, it } from "vitest";
import { currentDerivedKeys, resetKeyedChipToFactorySettings, RekeyRefusal } from "./rekey";
import type { DevelopmentKeys } from "./ntag";

const uid = "042c3c9a2b1690";
const keys: DevelopmentKeys = { key0: Buffer.alloc(16, 1), fileReadKey: Buffer.alloc(16, 2), metaReadKey: Buffer.alloc(16, 3), key3: Buffer.alloc(16, 4), key4: Buffer.alloc(16, 5) };
const configured = Buffer.from("004000e0000100c1ff21410000640000640000", "hex");
const factory = Buffer.from("0000e0ee000100", "hex");

function fixture(opts: { settings?: Buffer; foreignUid?: boolean; confirmed?: boolean; authFails?: boolean; readback?: Buffer } = {}) {
  const events: string[] = [];
  let reads = 0;
  const tag = {
    async version() { events.push("version"); return { uid: opts.foreignUid ? "04aaaaaaaaaaaa" : uid, hardware: "", software: "", production: "" }; },
    async reconnect() { events.push("reconnect"); },
    async readFileSettings() { events.push("read-settings"); return ++reads === 1 ? (opts.settings ?? configured) : (opts.readback ?? factory); },
    async authenticateFirst(n: number, key: Buffer) { events.push(`auth-${n}`); if (opts.authFails || !key.equals(keys.key0)) throw new Error("authentication failed"); },
    async changeFileSettings(payload: Buffer) { events.push(`change-settings-${payload.toString("hex")}`); },
  };
  const run = () => resetKeyedChipToFactorySettings({ tag, expectedUid: uid, currentKeys: keys, confirm: async () => (opts.confirmed ?? true), onIntent: async () => { events.push("intent"); }, onDone: async () => { events.push("done"); } });
  return { run, events };
}

describe("reset of a configured chip to factory NDEF settings", () => {
  it("authenticates, journals the intent, changes only the file settings and verifies the readback", async () => {
    const f = fixture();
    await expect(f.run()).resolves.toEqual({ uid });
    expect(f.events.filter(e => e.startsWith("change-settings"))).toEqual(["change-settings-00e0ee"]);
    expect(f.events.indexOf("auth-0")).toBeLessThan(f.events.indexOf("intent"));
    expect(f.events.indexOf("intent")).toBeLessThan(f.events.indexOf("change-settings-00e0ee"));
    expect(f.events.at(-1)).toBe("done");
  });
  it.each([
    ["a different chip", { foreignUid: true }, "PRESENTED_TAG_IS_NOT_THE_EXPECTED_CHIP"],
    ["a factory chip", { settings: factory }, "CHIP_IS_NOT_IN_THE_CONFIGURED_STATE"],
    ["no confirmation", { confirmed: false }, "OPERATOR_DID_NOT_CONFIRM"],
    ["a readback that is not the factory state", { readback: configured }, "FACTORY_SETTINGS_READBACK_MISMATCH"],
  ])("refuses %s", async (_name, opts, code) => {
    const f = fixture(opts);
    const failure = await f.run().catch(error => error);
    expect(failure).toBeInstanceOf(RekeyRefusal);
    expect(failure.code).toBe(code);
    if (code !== "FACTORY_SETTINGS_READBACK_MISMATCH") expect(f.events.some(e => e.startsWith("change-settings"))).toBe(false);
  });
  it("changes nothing when the key is wrong", async () => {
    const f = fixture({ authFails: true });
    await expect(f.run()).rejects.toThrow("authentication failed");
    expect(f.events).not.toContain("intent");
    expect(f.events.some(e => e.startsWith("change-settings"))).toBe(false);
  });
});

describe("current keys of a configured chip", () => {
  const env = { NFC_VERIFY_MASTER_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff", NFC_ADMIN_MASTER_KEY: "ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100" };
  it("are derived from the masters, the key reference and the chip UID", () => {
    const a = currentDerivedKeys({ env, keyRef: "dv1_zL1ZR8giVJhT", uid });
    expect(a.key0).toHaveLength(16);
    expect(currentDerivedKeys({ env, keyRef: "dv1_zL1ZR8giVJhT", uid }).key0.equals(a.key0)).toBe(true);
    expect(currentDerivedKeys({ env, keyRef: "dv1_other", uid }).key0.equals(a.key0)).toBe(false);
  });
  it("refuse an invalid master", () => {
    expect(() => currentDerivedKeys({ env: { ...env, NFC_ADMIN_MASTER_KEY: "short" }, keyRef: "dv1_x", uid })).toThrow();
  });
});
