import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";

const programIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pngPrefix = "data:image/png;base64,";

export function decodeMerchantLogoPng(logoData: string | null | undefined): Buffer | null {
  if (!logoData?.startsWith(pngPrefix)) return null;
  const encoded = logoData.slice(pngPrefix.length);
  if (encoded.length > 2_666_668 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length > 2_000_000 || !validLogoPng(bytes)) return null;
  return bytes;
}

const MAX_LOGO_PIXELS_BYTES = 16_800_000;

/** Validate the complete image before sending an upload to Wallet. Never inflate beyond the decoded-image budget. */
function validLogoPng(bytes: Buffer): boolean {
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return false;
  let offset = 8, width = 0, height = 0, depth = 0, color = -1, interlace = 0;
  let palette = false, imageStarted = false, imageEnded = false, ended = false;
  const compressed: Buffer[] = [];
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString("latin1", offset + 4, offset + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || type[2] !== type[2].toUpperCase()) return false;
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) return false;
    if (offset === 8 && type !== "IHDR") return false;
    if (type === "IHDR") {
      if (offset !== 8 || length !== 13) return false;
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; color = data[9]; interlace = data[12];
      const legalDepths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] };
      if (!width || !height || width > 0x7fffffff || height > 0x7fffffff || !legalDepths[color]?.includes(depth)
        || data[10] !== 0 || data[11] !== 0 || interlace > 1) return false;
    } else if (type === "PLTE") {
      if (palette || imageStarted || color === 0 || color === 4 || !length || length % 3 || length > 768
        || (color === 3 && length / 3 > 2 ** depth)) return false;
      palette = true;
    } else if (type === "IDAT") {
      if (imageEnded || (color === 3 && !palette)) return false;
      imageStarted = true; compressed.push(data);
    } else if (type === "IEND") {
      if (length !== 0 || !imageStarted || offset + 12 !== bytes.length) return false;
      ended = true; break;
    } else {
      // Unknown critical chunks change decoding semantics. Ancillary metadata is harmless after checksum validation.
      if (type[0] === type[0].toUpperCase()) return false;
      if (imageStarted) imageEnded = true;
    }
    offset += length + 12;
  }
  if (!ended) return false;
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  // Adam7 consists of seven independently filtered reduced images; empty passes contain no scanlines.
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    return { height: w ? h : 0, stride: Math.ceil(w * channels[color] * depth / 8) + 1 };
  });
  const expected = rows.reduce((sum, row) => sum + row.height * row.stride, 0);
  if (!Number.isSafeInteger(expected) || expected < 1 || expected > MAX_LOGO_PIXELS_BYTES) return false;
  try {
    const input = Buffer.concat(compressed);
    // Node's info option exposes consumed input; otherwise inflate silently ignores trailing compressed garbage.
    const result = inflateSync(input, { maxOutputLength: expected, info: true }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    const pixels = result.buffer;
    if (pixels.length !== expected || result.engine.bytesWritten !== input.length) return false;
    let rowOffset = 0;
    for (const row of rows) for (let y = 0; y < row.height; y++, rowOffset += row.stride) if (pixels[rowOffset] > 4) return false;
    return true;
  } catch { return false; }
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** PNG pixel size from the IHDR chunk, which the PNG format requires to come first. */
export function pngDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 24 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

const APPLE_LOGO_MAX_BYTES = 512_000;

/**
 * The merchant logo for the Apple pass, or undefined so the pass falls back to the merchant name as logo text. Wallet
 * scales the image into a 160 x 50 pt area; very large or oddly shaped files are left out instead of bloating every pass
 * download. JPEG/WebP uploads are not converted: the Card Studio asks for a PNG.
 */
export function appleLogoFromData(logoData: string | null | undefined): { png: Buffer; width: number; height: number } | undefined {
  const png = decodeMerchantLogoPng(logoData);
  if (!png || png.length > APPLE_LOGO_MAX_BYTES) return undefined;
  const size = pngDimensions(png);
  if (!size || size.width < 16 || size.height < 16 || size.width > 2048 || size.height > 2048 || size.width / size.height > 8 || size.height / size.width > 4) return undefined;
  return { png, ...size };
}

export function approvedGoogleAssetOrigin(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.GOOGLE_WALLET_ASSET_ENABLED !== "true") return undefined;
  try {
    const origin = new URL(env.GOOGLE_WALLET_ASSET_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.origin !== env.GOOGLE_WALLET_ASSET_ORIGIN || origin.username || origin.password) return undefined;
    return origin.origin;
  } catch { return undefined; }
}

export function merchantGoogleLogoUrl(programId: string, logoData: string | null | undefined, env: Record<string, string | undefined> = process.env): string | undefined {
  const origin = approvedGoogleAssetOrigin(env);
  if (!origin || !programIdPattern.test(programId)) return undefined;
  const bytes = decodeMerchantLogoPng(logoData);
  if (!bytes) return undefined;
  const revision = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  return `${origin}/api/wallet/assets/google-logo/${programId}.png?v=${revision}`;
}
