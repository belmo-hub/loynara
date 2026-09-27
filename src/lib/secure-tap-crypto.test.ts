import { describe, expect, it } from "vitest";
import { verifySdm } from "./secure-tap-crypto";

// NXP AN12196 Rev 2.0, Tables 2 and 4: encrypted PICC data and truncated MAC.
const vector = { encrypted: "EF963FF7828658A599F3041510671E88", mac: "94EED9EE65337086" };
const zero = Buffer.alloc(16);

describe("NTAG 424 DNA SDM, encrypted PICC data and empty MAC input", () => {
  it("accepts the NXP vector and decodes its seven-byte UID and little-endian counter", () => {
    expect(verifySdm(vector, { metaReadKey: zero, fileReadKey: zero })).toEqual({ uid: "04de5f1eacc040", counter: 61 });
  });
  it("rejects altered MAC, encrypted data, key and malformed fields", () => {
    for (const attempt of [
      { ...vector, mac: "94EED9EE65337087" },
      { ...vector, encrypted: "EF963FF7828658A599F3041510671E89" },
      { ...vector, encrypted: "ABC" },
      { ...vector, mac: "foo" },
    ]) expect(() => verifySdm(attempt, { metaReadKey: zero, fileReadKey: zero })).toThrow();
    expect(() => verifySdm(vector, { metaReadKey: Buffer.alloc(16, 1), fileReadKey: zero })).toThrow();
    expect(() => verifySdm(vector, { metaReadKey: zero, fileReadKey: Buffer.alloc(16, 1) })).toThrow();
  });
});
