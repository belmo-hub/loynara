import { createHash } from "node:crypto";

const programIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pngPrefix = "data:image/png;base64,";

export function decodeMerchantLogoPng(logoData: string | null | undefined): Buffer | null {
  if (!logoData?.startsWith(pngPrefix)) return null;
  const encoded = logoData.slice(pngPrefix.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.length < 24 || bytes.length > 2_000_000 || !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return null;
  return bytes;
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
