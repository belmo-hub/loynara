import { createCipheriv } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { provisionPhysicalTag, type ProvisionRepository, type ProvisionTag } from "./flow";
import { ndefTemplate, type DevelopmentKeys } from "./ntag";

const zero = Buffer.alloc(16);
const keys: DevelopmentKeys = { key0: zero, fileReadKey: zero, metaReadKey: zero, key3: zero, key4: zero };
const uid = "04de5f1eacc040";
const ref = "abcdefghijklmnopqrstuvwx";
const origin = "https://preview.getloynara.com";
const template = ndefTemplate(origin, ref);
function syntheticNdef(counter: number) {
  const ctr = Buffer.from([counter & 255, counter >> 8, counter >> 16]);
  const picc = Buffer.concat([Buffer.from([0xc7]), Buffer.from(uid, "hex"), ctr, Buffer.alloc(5)]);
  const cipher = createCipheriv("aes-128-ecb", zero, null); cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(picc), cipher.final()]).toString("hex");
  const cmac = (key: Buffer, data: Buffer) => Buffer.from(execFileSync("openssl", ["mac", "-macopt", "cipher:aes-128-cbc", "-macopt", `hexkey:${key.toString("hex")}`, "CMAC"], { input: data }).toString().trim(), "hex");
  const session = cmac(zero, Buffer.concat([Buffer.from("3cc300010080", "hex"), Buffer.from(uid, "hex"), ctr]));
  const full = cmac(session, Buffer.alloc(0));
  const mac = Buffer.from(Array.from({ length: 8 }, (_, i) => full[i * 2 + 1])).toString("hex");
  const ndef = Buffer.from(template.bytes);
  ndef.write(encrypted, template.piccOffset, "ascii");
  ndef.write(mac, template.macOffset, "ascii");
  return ndef;
}
function fixture(failAt?: string, confirmed = true) {
  const events: string[] = [];
  let settingsRead = 0;
  let ndefRead = 0;
  const tag: ProvisionTag = {
    async version() { events.push("version"); if (failAt === "version") throw Error("wrong tag"); return { uid, hardware: "04040830001105", software: "04040201011105", production: "11223344556677" }; },
    async reconnect() { events.push("reconnect"); },
    async readFileSettings() { events.push("settings-read"); return ++settingsRead === 1 ? Buffer.from("0000e0ee000100", "hex") : Buffer.concat([Buffer.from("004000e0000100", "hex"), template.settings.subarray(3)]); },
    async writeNdef() { events.push("ndef-write"); if (failAt === "ndef-write") throw Error("write failed"); },
    async readNdef() { events.push("ndef-read"); return ++ndefRead === 1 ? template.bytes : syntheticNdef(ndefRead); },
    async authenticateFirst(_number, key) { events.push("authenticate"); if (failAt === "authenticate" || (failAt === "new-key-auth" && !key.equals(zero))) throw Error("authentication failed"); },
    async changeKey(number) { events.push(`change-key-${number}`); if (failAt === `change-key-${number}`) throw Error("key change failed"); },
    async changeFileSettings() { events.push("change-settings"); if (failAt === "change-settings") throw Error("file settings failed"); },
  };
  const repository: ProvisionRepository = {
    async checkTarget() { events.push("target"); return { tenantId: "tenant", locationId: "location", programId: "programme", mode: "automatic_fixed", cooldownSeconds: 60 }; },
    async reserve() { events.push("reserve"); return { id: "tag-id", publicRef: ref }; },
    async verifyMapping() { events.push("verify-mapping"); if (failAt === "mapping") throw Error("wrong mapping"); },
    async activate() { events.push("activate"); },
    async fail() { events.push("revoke-pending"); },
  };
  const store = { async save() { events.push("save-keys"); } };
  const run = () => provisionPhysicalTag({
    transport: { async transmit() { throw Error("mock tag used"); } }, repository, keyStore: store,
    actorUserId: "owner", programId: "programme", origin, keyRef: "dev_fixture",
    async confirm() { events.push("confirm"); return confirmed; },
    tagFactory: () => tag, keyFactory: () => failAt === "new-key-auth" ? { ...keys, key0: Buffer.alloc(16, 1) } : keys,
  });
  return { run, events, repository, store };
}

describe("operator provisioning sequence with mocked PC/SC tag", () => {
  it("changes keys only after confirmation and pending DB reservation, then activates after dynamic readback", async () => {
    const f = fixture();
    const result = await f.run();
    expect(result).toMatchObject({ stage: "active", uid, firstCounter: 2, secondCounter: 3 });
    expect(f.events.indexOf("confirm")).toBeLessThan(f.events.indexOf("save-keys"));
    expect(f.events.indexOf("reserve")).toBeLessThan(f.events.indexOf("change-key-1"));
    expect(f.events.indexOf("change-key-0")).toBeGreaterThan(f.events.indexOf("change-settings"));
    expect(f.events.indexOf("verify-mapping")).toBeLessThan(f.events.indexOf("activate"));
    expect(f.events.at(-1)).toBe("activate");
  });
  it("never reserves or writes on refused confirmation or mismatched tag", async () => {
    for (const [failure, confirmed] of [[undefined, false], ["version", true]] as const) {
      const f = fixture(failure, confirmed);
      await expect(f.run()).rejects.toThrow();
      expect(f.events).not.toContain("reserve");
      expect(f.events).not.toContain("ndef-write");
    }
  });
  it.each(["authenticate", "change-key-1", "ndef-write", "change-settings", "new-key-auth", "mapping"])("keeps failed %s provisioning inactive", async failure => {
    const f = fixture(failure);
    await expect(f.run()).rejects.toThrow();
    expect(f.events).toContain("reserve");
    expect(f.events).toContain("revoke-pending");
    expect(f.events).not.toContain("activate");
  });
  it("does not expose generated key bytes in operator messages", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try { await fixture("change-key-1").run().catch(() => undefined); expect(spy).not.toHaveBeenCalled(); }
    finally { spy.mockRestore(); }
  });
});
