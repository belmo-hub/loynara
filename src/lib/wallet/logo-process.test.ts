import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { checkedLogoUpload, logoBytes, processMerchantLogo } from "./logo-process";

const TAPPI_RED = "#B3261E";
const WALDGRUEN = "#1F4D3A";
const svg = (width: number, height: number, body: string) => sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${body}</svg>`));
const png = (width: number, height: number, body: string) => svg(width, height, body).png().toBuffer();
const dataUrl = (type: string, bytes: Buffer) => `data:${type};base64,${bytes.toString("base64")}`;
const size = async (bytes: Buffer) => { const { width, height } = await sharp(bytes).metadata(); return [width, height]; };
const alphaAt = async (bytes: Buffer, x: number, y: number) => {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * 4 + 3];
};

// Fixtures from the audit spec: shapes only, so no font is needed to render them.
const squareOpaque = () => png(400, 400, `<rect width="400" height="400" fill="${TAPPI_RED}"/><rect x="80" y="160" width="240" height="80" fill="#fff"/>`);
const wideOpaque = () => png(600, 200, `<rect width="600" height="200" fill="#d00"/><rect x="40" y="70" width="520" height="60" fill="#fff"/>`);
const roundBadge = () => png(300, 300, `<circle cx="150" cy="150" r="120" fill="#123"/>`);
// A wordmark: three blocks with transparent gaps, 800 x 200 once trimmed.
const wordmark = (x: number, y: number) => `<g fill="#fff" transform="translate(${x} ${y})"><rect width="200" height="200"/><rect x="240" y="40" width="200" height="160"/><rect x="480" width="320" height="120"/></g>`;
const wideTransparent = () => png(840, 240, wordmark(20, 20));
const widePadded = () => png(1142, 286, wordmark(171, 43));
const darkWordmark = () => png(840, 240, wordmark(20, 20).replace('fill="#fff"', 'fill="#111"'));

describe("processMerchantLogo: every logo keeps its own shape (ENG-134)", () => {
  it("fits Apple's 160 x 50 slot at every density, touching an edge, without squaring a wide logo", async () => {
    const logo = await processMerchantLogo(await wideTransparent(), TAPPI_RED);
    expect(await size(logo.wallet.png1x)).toEqual([160, 40]);
    expect(await size(logo.wallet.png2x)).toEqual([320, 80]);
    expect(await size(logo.wallet.png3x)).toEqual([480, 120]);
    expect(logo.wallet).toMatchObject({ width: 160, height: 40 });
    expect(logo.meta).toMatchObject({ ratio: 4, boxed: false, showName: false, upscaled: false });
    expect(logo.icon).toBeUndefined();
    for (const out of [logo.wallet.png1x, logo.wallet.png2x, logo.wallet.png3x]) expect(out.length).toBeLessThanOrEqual(50_000);
  });

  it("trims transparent padding, so a padded logo comes out the size of the unpadded one", async () => {
    const [plain, padded] = await Promise.all([wideTransparent(), widePadded()].map(async bytes => processMerchantLogo(await bytes, TAPPI_RED)));
    expect(Math.abs(padded.wallet.width - plain.wallet.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(padded.wallet.height - plain.wallet.height)).toBeLessThanOrEqual(1);
  });

  it("keeps a square logo with its own box square, uncropped, with the name beside it and an icon set", async () => {
    const logo = await processMerchantLogo(await squareOpaque(), TAPPI_RED);
    expect(await size(logo.wallet.png1x)).toEqual([50, 50]);
    expect(await size(logo.wallet.png3x)).toEqual([150, 150]);
    expect(logo.meta).toMatchObject({ boxed: true, showName: true });
    expect(await alphaAt(logo.wallet.png1x, 0, 0)).toBe(255); // no radius added
    expect(await Promise.all(logo.icon!.map(size))).toEqual([[29, 29], [58, 58], [87, 87]]);
  });

  it("keeps a wide logo with its own box a rectangle, with a margin of its box colour (ENG-153)", async () => {
    const logo = await processMerchantLogo(await wideOpaque(), TAPPI_RED);
    expect(await size(logo.wallet.png1x)).toEqual([131, 50]); // 600 x 200 plus 24 px of box on every side
    expect(logo.meta).toMatchObject({ ratio: 3, boxed: true, box: "#dd0000", showName: true });
    expect(await alphaAt(logo.wallet.png1x, 0, 0)).toBe(255);
  });

  it("keeps a round badge round: trimmed to the circle, corners still transparent", async () => {
    const logo = await processMerchantLogo(await roundBadge(), TAPPI_RED);
    expect(logo.wallet.width).toBe(logo.wallet.height);
    expect(logo.wallet.height).toBe(50);
    expect(logo.meta.boxed).toBe(false);
    expect(await alphaAt(logo.wallet.png3x, 0, 0)).toBe(0);
    expect(logo.icon).toHaveLength(3);
  });

  it("flags a dark wordmark on a dark brand colour as low contrast", async () => {
    expect((await processMerchantLogo(await darkWordmark(), WALDGRUEN)).meta.contrast).toBeLessThan(3);
    expect((await processMerchantLogo(await darkWordmark(), "#F2C14E")).meta.contrast).toBeGreaterThanOrEqual(3);
  });

  it("reads JPEG and WebP, and turns a 2000 x 2000 PNG into small outputs", async () => {
    const square = svg(400, 400, `<rect width="400" height="400" fill="${TAPPI_RED}"/>`);
    for (const bytes of [await square.clone().jpeg().toBuffer(), await square.clone().webp().toBuffer()]) {
      expect(await size((await processMerchantLogo(bytes, TAPPI_RED)).wallet.png1x)).toEqual([50, 50]);
    }
    const big = await processMerchantLogo(await png(2000, 2000, `<circle cx="1000" cy="1000" r="990" fill="#123"/>`), TAPPI_RED);
    expect(big.wallet.png3x.length).toBeLessThanOrEqual(50_000);
  });

  it("keeps semi-transparent edges: only nearly invisible pixels count as margin", async () => {
    const soft = await png(400, 200, `<rect x="50" y="50" width="100" height="100" fill="#fff" fill-opacity="0.08"/><rect x="150" y="50" width="200" height="100" fill="#fff"/>`);
    const logo = await processMerchantLogo(soft, TAPPI_RED);
    expect(logo.meta.ratio).toBeCloseTo(3, 1); // 300 x 100, the faint block included
  });

  it("accepts a 16 px PNG, never upscaling past 2x, and fits an 8:1 banner by its width", async () => {
    const tiny = await processMerchantLogo(await png(16, 16, `<rect width="16" height="16" fill="#123"/>`), TAPPI_RED);
    expect(await size(tiny.wallet.png3x)).toEqual([40, 40]); // 16 px box plus its 2 px margin, at 2x
    expect(tiny.meta.upscaled).toBe(true);
    const banner = await processMerchantLogo(await png(1600, 200, `<rect width="1600" height="200" fill="#123"/>`), TAPPI_RED);
    expect(await size(banner.wallet.png1x)).toEqual([160, 24]);
  });
});

describe("processMerchantLogo: Google gets each logo in its own shape (ENG-153)", () => {
  const pixel = async (bytes: Buffer, x: number, y: number) => {
    const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
  };
  const square660 = (logo: Awaited<ReturnType<typeof processMerchantLogo>>) => "square660" in logo.google ? logo.google.square660 : undefined;
  const wide = (logo: Awaited<ReturnType<typeof processMerchantLogo>>) => "wide" in logo.google ? logo.google.wide : undefined;

  it("puts a transparent round mark on the brand colour inside the 15 % safe margin of a 660 square", async () => {
    const tile = square660(await processMerchantLogo(await roundBadge(), TAPPI_RED))!;
    expect(await size(tile)).toEqual([660, 660]);
    expect(await pixel(tile, 0, 0)).toEqual([0xB3, 0x26, 0x1E, 255]);
    expect(await pixel(tile, 98, 330)).toEqual([0xB3, 0x26, 0x1E, 255]); // margin: 99 px a side
    expect((await pixel(tile, 104, 330))[0]).toBeLessThan(40); // the badge reaches the margin: the full inner width
  });

  it("puts a boxed square logo on its own box colour, uncropped", async () => {
    const tile = square660(await processMerchantLogo(await squareOpaque(), WALDGRUEN))!;
    expect(await pixel(tile, 0, 0)).toEqual([0xB3, 0x26, 0x1E, 255]);
    expect(await pixel(tile, 330, 330)).toEqual([255, 255, 255, 255]);
  });

  it("gives a wide or in-between logo the 1280 x 400 wide logo: left-aligned, vertically centred on transparent, never a squeezed tile", async () => {
    for (const bytes of [await wideTransparent(), await png(300, 200, `<rect width="300" height="200" rx="40" fill="#fff"/>`)]) {
      const logo = await processMerchantLogo(bytes, TAPPI_RED);
      expect(square660(logo)).toBeUndefined();
      expect(await size(wide(logo)!)).toEqual([1280, 400]);
      expect((await pixel(wide(logo)!, 2, 200))[3]).toBe(255);
      expect((await pixel(wide(logo)!, 1279, 385))[3]).toBe(0);
    }
  });

  it("puts a tall mark in the circle, inside the safe square, so the name stays beside it", async () => {
    const logo = await processMerchantLogo(await png(100, 200, `<rect width="100" height="200" rx="20" fill="#fff"/>`), TAPPI_RED);
    expect(wide(logo)).toBeUndefined();
    const tile = square660(logo)!;
    expect(await pixel(tile, 330, 135)).toEqual([255, 255, 255, 255]); // 2x cap: 200 -> 400 px, centred from row 130
    expect(await pixel(tile, 330, 125)).toEqual([0xB3, 0x26, 0x1E, 255]);
  });

  it("never enlarges a small upload more than 2x, and flags it like Apple", async () => {
    const logo = await processMerchantLogo(await png(160, 40, `<rect width="160" height="40" rx="8" fill="#fff"/>`), TAPPI_RED);
    const banner = wide(logo)!;
    expect((await pixel(banner, 300, 200))[3]).toBe(255);
    expect((await pixel(banner, 330, 200))[3]).toBe(0); // 320 x 80, not 1280 wide
    expect((await pixel(banner, 100, 155))[3]).toBe(0); // centred: rows 160 to 239
    expect(logo.meta.upscaled).toBe(true);
    const small = await processMerchantLogo(await png(100, 100, `<circle cx="50" cy="50" r="50" fill="#fff"/>`), TAPPI_RED);
    expect(await pixel(square660(small)!, 330, 228)).toEqual([0xB3, 0x26, 0x1E, 255]); // 200 px, not 462
  });

  it("keeps a boxed wide logo's box, now with a margin", async () => {
    const banner = wide(await processMerchantLogo(await wideOpaque(), TAPPI_RED))!;
    expect(await pixel(banner, 0, 0)).toEqual([0xdd, 0, 0, 255]);
    expect(await pixel(banner, 30, 200)).toEqual([0xdd, 0, 0, 255]); // margin before the white bar starts
    expect((await pixel(banner, 1100, 200))[3]).toBe(0);
  });

  it("gives a black wordmark JPG on white back its white margin, for Apple and Google", async () => {
    const jpeg = await svg(400, 260, `<rect width="400" height="260" fill="#fff"/><g fill="#111"><rect x="30" y="50" width="100" height="160"/><rect x="150" y="30" width="100" height="200"/><rect x="270" y="50" width="100" height="160"/></g>`).jpeg({ quality: 95 }).toBuffer();
    const logo = await processMerchantLogo(jpeg, WALDGRUEN);
    expect(logo.meta).toMatchObject({ boxed: true, box: expect.stringMatching(/^#f[a-f0-9]f[a-f0-9]f[a-f0-9]$/) });
    const [width, height] = await size(logo.wallet.png3x);
    expect((await pixel(logo.wallet.png3x, 1, Math.round(height! / 2)))[0]).toBeGreaterThan(240); // white, not a glyph at the edge
    expect((await pixel(logo.wallet.png3x, width! - 2, Math.round(height! / 2)))[0]).toBeGreaterThan(240);
    expect((await pixel(wide(logo)!, 2, 200))[0]).toBeGreaterThan(240);
  });
});

describe("checkedLogoUpload: one check for both save paths", () => {
  it("stores a trimmed PNG for every accepted type", async () => {
    const jpeg = await svg(300, 300, `<rect width="300" height="300" fill="#123"/>`).jpeg().toBuffer();
    const stored = await checkedLogoUpload(dataUrl("image/jpeg", jpeg));
    expect(stored).toMatch(/^data:image\/png;base64,/);
    expect(await size(logoBytes(stored)!)).toEqual([300, 300]);
    expect(await size(logoBytes(await checkedLogoUpload(dataUrl("image/png", await widePadded()))!)!)).toEqual([800, 200]);
  });

  it("accepts large images and stores them at most 1280 px: 3000 x 3000 PNG, 4000 x 3000 JPEG, 5000 x 5000 PNG", async () => {
    const solid = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: TAPPI_RED } });
    for (const [type, bytes] of [["image/png", await solid(3000, 3000).png().toBuffer()], ["image/jpeg", await solid(4000, 3000).jpeg().toBuffer()], ["image/png", await solid(5000, 5000).png().toBuffer()]] as const) {
      const [width, height] = await size(logoBytes(await checkedLogoUpload(dataUrl(type, bytes)))!);
      expect(Math.max(width!, height!)).toBe(1280);
    }
  }, 30_000);

  it("refuses a valid PNG over the 25 MP decode cap, however small the file (ENG-153: the only decode guard on the public Google routes)", async () => {
    const bytes = await sharp({ create: { width: 5001, height: 5001, channels: 3, background: "#808080" } }).greyscale().png({ compressionLevel: 9 }).toBuffer();
    expect(bytes.length).toBeLessThan(100_000);
    await expect(processMerchantLogo(bytes, TAPPI_RED)).rejects.toThrow(/pixel limit/i);
    await expect(checkedLogoUpload(dataUrl("image/png", bytes))).rejects.toMatchObject({ code: "INVALID_LOGO" });
  }, 30_000);

  it("rejects a renamed JPEG, an oversized file, a tiny image and garbage with INVALID_LOGO in German", async () => {
    const jpeg = await svg(300, 300, `<rect width="300" height="300" fill="#123"/>`).jpeg().toBuffer();
    const oversized = Buffer.concat([await png(32, 32, `<rect width="32" height="32"/>`), Buffer.alloc(2_000_001)]);
    for (const value of [dataUrl("image/png", jpeg), dataUrl("image/png", oversized), dataUrl("image/png", await png(15, 15, `<rect width="15" height="15"/>`)),
      "data:image/png;base64,ZmFrZQ==", dataUrl("image/png", Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]))]) {
      await expect(checkedLogoUpload(value)).rejects.toMatchObject({ code: "INVALID_LOGO", message: expect.stringMatching(/^Dieses Bild (können wir nicht|ist zu klein)/) });
    }
  });
});
