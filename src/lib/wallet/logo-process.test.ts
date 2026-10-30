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

  it("keeps a wide logo with its own box a rectangle", async () => {
    const logo = await processMerchantLogo(await wideOpaque(), TAPPI_RED);
    expect(await size(logo.wallet.png1x)).toEqual([150, 50]);
    expect(logo.meta).toMatchObject({ ratio: 3, boxed: true, showName: true });
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
    expect(await size(tiny.wallet.png3x)).toEqual([32, 32]);
    expect(tiny.meta.upscaled).toBe(true);
    const banner = await processMerchantLogo(await png(1600, 200, `<rect width="1600" height="200" fill="#123"/>`), TAPPI_RED);
    expect(await size(banner.wallet.png1x)).toEqual([160, 20]);
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

  it("rejects a renamed JPEG, an oversized file, a tiny image and garbage with INVALID_LOGO in German", async () => {
    const jpeg = await svg(300, 300, `<rect width="300" height="300" fill="#123"/>`).jpeg().toBuffer();
    const oversized = Buffer.concat([await png(32, 32, `<rect width="32" height="32"/>`), Buffer.alloc(2_000_001)]);
    for (const value of [dataUrl("image/png", jpeg), dataUrl("image/png", oversized), dataUrl("image/png", await png(15, 15, `<rect width="15" height="15"/>`)),
      "data:image/png;base64,ZmFrZQ==", dataUrl("image/png", Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.alloc(64)]))]) {
      await expect(checkedLogoUpload(value)).rejects.toMatchObject({ code: "INVALID_LOGO", message: expect.stringMatching(/^Dieses Bild (können wir nicht|ist zu klein)/) });
    }
  });
});
