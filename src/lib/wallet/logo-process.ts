import sharp, { type Sharp } from "sharp";
import { DomainError } from "../loyalty";

export const MAX_LOGO_BYTES = 2_000_000;
// The 16.8 MB decoded-image budget logo.ts used, counted in RGBA pixels: 2048 x 2048.
const MAX_LOGO_PIXELS = 4_200_000;
const STORED_MAX = 1280;
const INVALID = "Dieses Bild können wir nicht verwenden. Wähle ein PNG, JPG oder WebP bis 2 MB.";
const UNREADABLE = "Dieses Bild können wir nicht lesen. Speichere es neu als PNG und wähle es erneut.";
const TOO_SMALL = "Dieses Bild ist zu klein. Wähle eine größere Version deines Logos.";
class TooSmall extends Error {}

export type ProcessedLogo = {
  /** Apple's 160 x 50 pt slot at @1x, @2x and @3x; width and height are the @1x size. */
  wallet: { png1x: Buffer; png2x: Buffer; png3x: Buffer; width: number; height: number };
  /** Only for square or round marks: 29, 58 and 87 px on the brand colour. */
  icon?: [Buffer, Buffer, Buffer];
  meta: { ratio: number; boxed: boolean; contrast: number; upscaled: boolean; showName: boolean };
};

const MAGIC: Record<string, (bytes: Buffer) => boolean> = {
  "image/png": bytes => bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
  "image/jpeg": bytes => bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
  "image/webp": bytes => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP",
};

/** The bytes of a stored or uploaded logo data URL, when its type matches its contents. */
export function logoBytes(value: string | null | undefined): Buffer | null {
  const match = /^data:(image\/png|image\/jpeg|image\/webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value ?? "");
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  return bytes.length <= MAX_LOGO_BYTES && MAGIC[match[1]](bytes) ? bytes : null;
}

/**
 * The upload both save paths store: decoded, cut to its visible pixels and re-encoded as one PNG of at most 1280 px.
 * Every Wallet output is derived from it, so no raw upload ever reaches a pass. Errors are German for the owner.
 */
export async function checkedLogoUpload(value: string): Promise<string> {
  const bytes = logoBytes(value);
  if (!bytes) throw new DomainError("INVALID_LOGO", INVALID);
  try { return `data:image/png;base64,${(await trimmedLogo(bytes)).toString("base64")}`; }
  catch (error) { throw new DomainError("INVALID_LOGO", error instanceof TooSmall ? TOO_SMALL : UNREADABLE); }
}

async function trimmedLogo(bytes: Buffer): Promise<Buffer> {
  const input = () => sharp(bytes, { limitInputPixels: MAX_LOGO_PIXELS }).rotate();
  const { width = 0, height = 0 } = await input().metadata();
  if (width < 16 || height < 16) throw new TooSmall("Logo too small");
  const { isOpaque } = await input().stats();
  // Transparent margins go; on an opaque image only a white canvas does, so a logo's own coloured box stays whole.
  const trimmed = isOpaque ? await input().trim({ background: { r: 255, g: 255, b: 255 }, threshold: 15 }).png().toBuffer()
    : await input().extract(await visibleBox(input())).png().toBuffer();
  return sharp(trimmed).resize(STORED_MAX, STORED_MAX, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
}

/** The bounding box of the visible pixels; sharp's own trim compares colour too, and transparent pixels carry any colour. */
async function visibleBox(image: Sharp) {
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * 4 + 3] < 8) continue;
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < 0) throw new Error("Logo is empty");
  return { left, top, width: right - left + 1, height: bottom - top + 1 };
}

function linear(channel: number) { const c = channel / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
function luminance([r, g, b]: number[]) { return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b); }
function lab(rgb: number[]) {
  const [r, g, b] = rgb.map(linear);
  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const [x, y, z] = [(0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047, 0.2126 * r + 0.7152 * g + 0.0722 * b, (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883].map(f);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((value, i) => value - lab(b)[i]));
const hexRgb = (hex: string) => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));

/** Every Wallet output for one stored logo (any of the three upload types). Deterministic for the same bytes and colour. */
export async function processMerchantLogo(bytes: Buffer, brandColor: string): Promise<ProcessedLogo> {
  const source = await trimmedLogo(bytes);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const pixel = (x: number, y: number) => Array.from(data.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
  const corners = [pixel(0, 0), pixel(width - 1, 0), pixel(0, height - 1), pixel(width - 1, height - 1)];
  const boxed = corners.every(c => c[3] >= 250) && corners.every(c => corners.every(d => deltaE(c, d) < 5));
  // shortcut: mean luminance of the opaque pixels, which overrates a two-colour logo; per-region contrast if owners hit it.
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { sum += luminance([data[i], data[i + 1], data[i + 2]]); count++; }
  const [logoLum, brandLum] = [count ? sum / count : 0, luminance(hexRgb(brandColor))];
  const contrast = (Math.max(logoLum, brandLum) + 0.05) / (Math.min(logoLum, brandLum) + 0.05);
  const ratio = width / height;
  const fit = Math.min(160 / width, 50 / height);
  // Fit Apple's slot without padding, so Wallet draws it at full slot height or width; never more than 2x the source.
  const sizes = [1, 2, 3].map(scale => Math.min(fit * scale, 2)).map(s => [Math.max(1, Math.round(width * s)), Math.max(1, Math.round(height * s))]);
  const [png1x, png2x, png3x] = await Promise.all(sizes.map(([w, h]) => sharp(source).resize(w, h, { fit: "fill" }).png({ compressionLevel: 9 }).toBuffer()));
  const square = ratio >= 0.8 && ratio <= 1.25;
  const icon = square ? await Promise.all([29, 58, 87].map(async size => {
    const inner = Math.round(size * 0.8);
    const mark = await sharp(source).resize(inner, inner, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: brandColor } }).composite([{ input: mark, gravity: "center" }]).png().toBuffer();
  })) as [Buffer, Buffer, Buffer] : undefined;
  return {
    wallet: { png1x, png2x, png3x, width: sizes[0][0], height: sizes[0][1] },
    ...(icon ? { icon } : {}),
    meta: { ratio, boxed, contrast, upscaled: fit * 3 > 1, showName: ratio < 2.2 || boxed },
  };
}
