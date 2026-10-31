import sharp, { type Sharp } from "sharp";
import { DomainError } from "../loyalty";

export const MAX_LOGO_BYTES = 2_000_000;
// Against decompression bombs: a 12 MP phone photo and a 5000 x 5000 export pass. A PNG that size costs about 70 MB of
// transient memory while it shrinks (measured); owners only reach this, after the ownership check and the rate limit.
const MAX_LOGO_PIXELS = 25_000_000;
// Analysis runs on at most 2048 x 2048, the 16.8 MB RGBA budget logo.ts used, whatever the upload's size.
const WORK_MAX = 2048;
const STORED_MAX = 1280;
const WHITE = { r: 255, g: 255, b: 255 };
const INVALID = "Dieses Bild können wir nicht verwenden. Wähle ein PNG, JPG oder WebP bis 2 MB.";
const UNREADABLE = "Dieses Bild können wir nicht lesen. Speichere es neu als PNG und wähle es erneut.";
const TOO_SMALL = "Dieses Bild ist zu klein. Wähle eine größere Version deines Logos.";
class TooSmall extends Error {}

export type ProcessedLogo = {
  /** Apple's 160 x 50 pt slot at @1x, @2x and @3x; width and height are the @1x size. */
  wallet: { png1x: Buffer; png2x: Buffer; png3x: Buffer; width: number; height: number };
  /** Only for square or round marks: 29, 58 and 87 px on the brand colour. */
  icon?: [Buffer, Buffer, Buffer];
  /** Google: a square or round mark fills the 660 circle inside its 15 % safe margin; any other shape is the 1280 x 400 wide logo. */
  google: { square660: Buffer } | { wide: Buffer };
  /** box: a boxed logo's own background colour (#rrggbb), the disc Google's circle is filled with. */
  meta: { ratio: number; boxed: boolean; box?: string; contrast: number; upscaled: boolean; showName: boolean };
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
  try { return `data:image/png;base64,${(await trimmedLogo(bytes)).png.toString("base64")}`; }
  catch (error) { throw new DomainError("INVALID_LOGO", error instanceof TooSmall ? TOO_SMALL : UNREADABLE); }
}

/**
 * whiteCanvas: an opaque upload lost a white margin on at least three sides, so it is a logo on a white canvas (a JPG
 * wordmark, typically), not a photo with a light sky or a box with a light export line. The result keeps a 1 px white
 * edge then, so the stored PNG still says so when a pass is built from it.
 */
async function trimmedLogo(bytes: Buffer): Promise<{ png: Buffer; whiteCanvas: boolean }> {
  const { width = 0, height = 0 } = await sharp(bytes, { limitInputPixels: MAX_LOGO_PIXELS }).metadata();
  if (width < 16 || height < 16) throw new TooSmall("Logo too small");
  const { data: work, info } = await sharp(bytes, { limitInputPixels: MAX_LOGO_PIXELS }).rotate()
    .resize(WORK_MAX, WORK_MAX, { fit: "inside", withoutEnlargement: true }).png().toBuffer({ resolveWithObject: true });
  const input = () => sharp(work);
  const { isOpaque } = await input().stats();
  // Transparent margins go; on an opaque image only a white canvas does, so a logo's own coloured box stays whole.
  const trimmed = isOpaque ? await input().trim({ background: WHITE, threshold: 15 }).png().toBuffer({ resolveWithObject: true })
    : await input().extract(await visibleBox(input())).png().toBuffer({ resolveWithObject: true });
  const [left, top] = [-(trimmed.info.trimOffsetLeft ?? 0), -(trimmed.info.trimOffsetTop ?? 0)];
  const sides = [left, top, info.width - left - trimmed.info.width, info.height - top - trimmed.info.height].filter(cut => cut > 0).length;
  const whiteCanvas = isOpaque && sides >= 3;
  const encode = async (max: number, palette = false) => {
    const resized = await sharp(trimmed.data).resize(max, max, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return (whiteCanvas ? sharp(resized).extend({ top: 1, bottom: 1, left: 1, right: 1, background: WHITE }) : sharp(resized))
      .png({ compressionLevel: 9, palette }).toBuffer();
  };
  // Every read refuses more than MAX_LOGO_BYTES, so the stored PNG must fit: a photo-like logo steps down in size, and
  // in the end to 256 colours at 640 px, rather than being saved and then silently left off every pass.
  for (const max of [STORED_MAX, 960, 640]) {
    const png = await encode(max);
    if (png.length <= MAX_LOGO_BYTES) return { png, whiteCanvas };
  }
  return { png: await encode(640, true), whiteCanvas };
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
  const { png: trimmed, whiteCanvas } = await trimmedLogo(bytes);
  const { data, info } = await sharp(trimmed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixel = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4));
  const [lastX, lastY] = [info.width - 1, info.height - 1];
  const corners = [pixel(0, 0), pixel(lastX, 0), pixel(0, lastY), pixel(lastX, lastY)];
  const hex = (rgb: number[]) => `#${rgb.slice(0, 3).map(c => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  // A logo on a white canvas is boxed in white even where a glyph reaches a corner; any other logo is boxed only when its
  // four corners are one opaque colour (its own square or frame).
  const box = whiteCanvas ? "#ffffff"
    : corners.every(c => c[3] >= 250) && corners.every(c => corners.every(d => deltaE(c, d) < 5)) ? hex(corners[0]) : undefined;
  const boxed = Boolean(box);
  // shortcut: mean luminance of the opaque pixels, which overrates a two-colour logo; per-region contrast if owners hit it.
  let sum = 0, count = 0;
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] > 128) { sum += luminance([data[i], data[i + 1], data[i + 2]]); count++; }
  const [logoLum, brandLum] = [count ? sum / count : 0, luminance(hexRgb(brandColor))];
  const contrast = (Math.max(logoLum, brandLum) + 0.05) / (Math.min(logoLum, brandLum) + 0.05);
  const ratio = info.width / info.height;
  // The white canvas was trimmed to the glyphs: give it back a margin. A logo's own box or frame keeps its own edge.
  const pad = whiteCanvas ? Math.round(info.height * 0.12) : 0;
  const source = pad ? await sharp(trimmed).extend({ top: pad, bottom: pad, left: pad, right: pad, background: WHITE }).png().toBuffer() : trimmed;
  const [width, height] = [info.width + 2 * pad, info.height + 2 * pad];
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
  // Google masks programLogo into a circle: any mark not wider than 1.25 sits in the 462 safe square (660 less the 15 %
  // margin each side), where even a 1:2 mark's corners stay inside the circle. Wider logos go to the 16:5 wide logo instead.
  const wide = ratio > 1.25;
  const needed = wide ? Math.min(1280 / width, 400 / height) : Math.min(462 / width, 462 / height);
  const scale = Math.min(needed, 2); // like Apple: never more than 2x, so a small upload stays sharp
  const mark = await sharp(source).resize(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)), { fit: "fill" }).png().toBuffer();
  const markHeight = Math.max(1, Math.round(height * scale));
  const google = wide
    ? { wide: await sharp({ create: { width: 1280, height: 400, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: mark, left: 0, top: Math.round((400 - markHeight) / 2) }]).png({ compressionLevel: 9 }).toBuffer() }
    : { square660: await sharp({ create: { width: 660, height: 660, channels: 4, background: box ?? brandColor } })
      .composite([{ input: mark, gravity: "center" }]).png({ compressionLevel: 9 }).toBuffer() };
  return {
    wallet: { png1x, png2x, png3x, width: sizes[0][0], height: sizes[0][1] },
    ...(icon ? { icon } : {}),
    google,
    meta: { ratio, boxed, ...(box ? { box } : {}), contrast, upscaled: fit * 3 > 1 || (wide && needed > 3), showName: ratio < 2.2 || boxed },
  };
}
