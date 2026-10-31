import { createHash } from "node:crypto";
import { logoBytes, processMerchantLogo, type ProcessedLogo } from "./logo-process";
import { initialOf } from "./initial";
import { initialLogo } from "./logo-initial";
import type { AppleLogo } from "./types";

const programIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Processing is deterministic, so each process keeps the last 64 results instead of redoing them for every pass download. */
function remembered<T>(cache: Map<string, Promise<T>>, key: string, make: () => Promise<T>): Promise<T> {
  let result = cache.get(key);
  if (!result) {
    result = make();
    cache.set(key, result);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return result;
}

const processed = new Map<string, Promise<ProcessedLogo | null>>();
const initials = new Map<string, Promise<Buffer>>();

function processedLogo(logoData: string | null | undefined, brandColor: string): Promise<ProcessedLogo | null> {
  const bytes = logoBytes(logoData);
  if (!bytes) return Promise.resolve(null);
  return remembered(processed, `${createHash("sha256").update(bytes).digest("hex")}:${brandColor.toLowerCase()}`, () => processMerchantLogo(bytes, brandColor).catch(() => null));
}

const faint = (logo: ProcessedLogo) => !logo.meta.boxed && logo.meta.contrast < 3;

/**
 * The merchant logo for the Apple pass, or undefined so the pass shows the merchant name as logo text instead: no logo,
 * an unreadable one, or one too faint on the brand colour (a boxed logo carries its own background).
 */
export async function appleLogoFromData(logoData: string | null | undefined, brandColor: string): Promise<AppleLogo | undefined> {
  const logo = await processedLogo(logoData, brandColor);
  if (!logo || faint(logo)) return undefined;
  return { ...logo.wallet, ...(logo.icon ? { icon: logo.icon } : {}), showName: logo.meta.showName };
}

/** What the pass does with the saved logo, so the studio preview can show the same. */
export async function walletLogoView(logoData: string | null | undefined, brandColor: string): Promise<{ showName: boolean; faint: boolean; upscaled: boolean; box?: string } | null> {
  const logo = await processedLogo(logoData, brandColor);
  return logo && { showName: logo.meta.showName || faint(logo), faint: faint(logo), upscaled: logo.meta.upscaled, ...(logo.meta.box ? { box: logo.meta.box } : {}) };
}

export function approvedGoogleAssetOrigin(env: Record<string, string | undefined> = process.env): string | undefined {
  if (env.GOOGLE_WALLET_ASSET_ENABLED !== "true") return undefined;
  try {
    const origin = new URL(env.GOOGLE_WALLET_ASSET_ORIGIN ?? "");
    if (origin.protocol !== "https:" || origin.origin !== env.GOOGLE_WALLET_ASSET_ORIGIN || origin.username || origin.password) return undefined;
    return origin.origin;
  } catch { return undefined; }
}

/**
 * The PNG Google fetches for a programme. Square: a mark up to 1.25 wide in the circle, otherwise the shop's initial (also
 * with no logo, or a faint one), so a wordmark is never squeezed into it; none when the name has nothing to draw. Wide: the
 * wide logo, only for a logo wider than 1.25.
 */
export async function googleLogoAsset(kind: "square" | "wide", logoData: string | null | undefined, brandColor: string, merchantName: string): Promise<Buffer | undefined> {
  const logo = await processedLogo(logoData, brandColor);
  const shown = logo && !faint(logo) ? logo.google : undefined;
  if (kind === "wide") return shown && "wide" in shown ? shown.wide : undefined;
  if (shown && "square660" in shown) return shown.square660;
  const initial = initialOf(merchantName);
  return initial ? remembered(initials, `${initial}:${brandColor.toLowerCase()}`, () => initialLogo(initial, brandColor)) : undefined;
}

/** Versioned asset URLs for the Google class, each with a hash of its own PNG; none without an approved HTTPS asset origin. */
export async function merchantGoogleLogoUrls(programId: string, logoData: string | null | undefined, brandColor: string, merchantName: string, env: Record<string, string | undefined> = process.env): Promise<{ googleLogoUrl?: string; googleWideLogoUrl?: string }> {
  const origin = approvedGoogleAssetOrigin(env);
  if (!origin || !programIdPattern.test(programId)) return {};
  const url = async (kind: "square" | "wide", route: string) => {
    const bytes = await googleLogoAsset(kind, logoData, brandColor, merchantName);
    return bytes && `${origin}/api/wallet/assets/${route}/${programId}.png?v=${createHash("sha256").update(bytes).digest("hex").slice(0, 16)}`;
  };
  const [googleLogoUrl, googleWideLogoUrl] = await Promise.all([url("square", "google-logo"), url("wide", "google-wide-logo")]);
  return { ...(googleLogoUrl ? { googleLogoUrl } : {}), ...(googleWideLogoUrl ? { googleWideLogoUrl } : {}) };
}
