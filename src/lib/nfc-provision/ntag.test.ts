import { describe, expect, it } from "vitest";
import { Ntag424, changeKeyPayload, getVersion, ndefTemplate, protectedCommand, type ApduTransport } from "./ntag";

describe("NXP NTAG 424 DNA operator APDUs", () => {
  it("matches official AN12196 Rev 2.0 Table 18 ChangeFileSettings vector", () => {
    const actual = protectedCommand({
      ins: 0x5f, header: Buffer.from("02", "hex"), plain: Buffer.from("4000e0c1f121200000430000430000", "hex"),
      enc: Buffer.from("1309c877509e5a215007ff0ed19ca564", "hex"), mac: Buffer.from("4c6626f5e72ea694202139295c7a7fc7", "hex"), ti: Buffer.from("9d00c4df", "hex"), counter: 1,
    });
    expect(actual.toString("hex")).toBe("905f0000190261b6d97903566e84c3ae5274467e89ead799b7c1a0ef7a0400");
  });
  it("matches official AN12196 Table 25 key-change CRC and layout", () => {
    const payload = changeKeyPayload(2, Buffer.from("f3847d627727ed3bc9c4cc050489b966", "hex"));
    expect(payload.toString("hex"))
      .toBe("f3847d627727ed3bc9c4cc050489b96601789dfadc");
    expect(protectedCommand({ ins: 0xc4, header: Buffer.from([2]), plain: payload,
      enc: Buffer.from("4cf3cb41a22583a61e89b158d252fc53", "hex"), mac: Buffer.from("5529860b2fc5fb6154b7f28361d30bf9", "hex"), ti: Buffer.from("7614281a", "hex"), counter: 2,
    }).toString("hex")).toBe("90c4000029022cf362b7bf4311ff3be1daa295e8c68de09050560d19b9e16c2393ae9cd1fac75d0ce20bcd1d06e600");
  });
  it("runs official AN12196 Table 14 EV2 challenge sequence", async () => {
    const sent: string[] = [];
    const replies = [
      "a04c124213c186f22399d33ac2a3021591af",
      "3fa64db5446d1f34cd6ea311167f5e4985b89690c04a05f17fa7ab2f081206639100",
    ];
    const tag = new Ntag424({ async transmit(data) { sent.push(data.toString("hex")); return Buffer.from(replies.shift()!, "hex"); } }, () => Buffer.from("13c5db8a5930439fc3def9a4c675360f", "hex"));
    await tag.authenticateFirst(0, Buffer.alloc(16));
    expect(sent).toEqual([
      "9071000002000000",
      "90af00002035c3e05a752e0144bac0de51c1f22c56b34408a23d8aea266cab947ea8e0118d00",
    ]);
  });
  it("selects the NDEF application and validates all three GetVersion frames", async () => {
    const sent: string[] = [];
    const replies = ["9000", "0404083000110591af", "0404020101110591af", "04de5f1eacc040112233445566779100"];
    const transport: ApduTransport = { async transmit(data) { sent.push(data.toString("hex")); return Buffer.from(replies.shift()!, "hex"); } };
    const version = await getVersion(transport);
    expect(version.uid).toBe("04de5f1eacc040");
    expect(sent).toEqual(["00a4040c07d276000085010100", "9060000000", "90af000000", "90af000000"]);
  });
  it("rejects another product and preserves full URL and offset layout", async () => {
    const replies = ["9000", "0403083000110591af", "0404020101110591af", "04de5f1eacc040112233445566779100"];
    await expect(getVersion({ async transmit() { return Buffer.from(replies.shift()!, "hex"); } })).rejects.toThrow("not a supported");
    const template = ndefTemplate("https://preview.getloynara.com", "abcdefghijklmnopqrstuvwx");
    expect(template.bytes.subarray(template.piccOffset, template.piccOffset + 32).toString()).toBe("0".repeat(32));
    expect(template.bytes.subarray(template.macOffset, template.macOffset + 16).toString()).toBe("0".repeat(16));
    expect(template.settings.subarray(0, 6).toString("hex")).toBe("4000e0c1ff21");
    expect(template.bytes.length).toBeLessThanOrEqual(256);
    expect(template.url).toContain("/tap/abcdefghijklmnopqrstuvwx?e=");
  });
  it("writes NDEF with a zero length until the final committed header", async () => {
    const image = ndefTemplate("https://preview.getloynara.com", "abcdefghijklmnopqrstuvwx").bytes;
    const writes: Buffer[] = [];
    const tag = new Ntag424({ async transmit(data) { writes.push(data); return Buffer.from("9100", "hex"); } });
    await tag.writeNdef(image);
    expect(writes.length).toBeGreaterThanOrEqual(3);
    expect(writes[0].subarray(5, 12).toString("hex")).toBe("02000000020000");
    expect(writes.at(-1)!.subarray(5, 12).toString("hex")).toBe("02000000020000");
    expect(writes[0].subarray(12, 14).toString("hex")).toBe("0000");
    expect(writes.at(-1)!.subarray(12, 14).equals(image.subarray(0, 2))).toBe(true);
  });
});
