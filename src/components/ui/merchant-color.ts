import { contrast, mix } from "./color";

const INK = "#17291F";
const WHITE = "#FFFFFF";
const BLACK = "#000000";
const STAMP = "#E9895F";
const FALLBACK = "#245D47";
const SURFACE = { light: "#FCFBF7", dark: "#16201B" } as const;

export type Theme = keyof typeof SURFACE;
export type MerchantPalette = {
  merchant: string;
  merchantInk: string;
  merchantDeep: string;
  merchantText: string;
  stampFill: string;
  stampInk: string;
  cssVars: Record<"--merchant" | "--merchant-ink" | "--merchant-deep" | "--merchant-text" | "--stamp-fill" | "--stamp-ink", string>;
};

/** Steps `hex` toward `target` in 4 % increments until `passes` holds (or the target is reached). */
function shiftUntil(hex: string, target: string, passes: (candidate: string) => boolean) {
  for (let step = 0; step <= 25; step++) {
    const candidate = step === 0 ? hex : mix(hex, target, step * 0.04);
    if (passes(candidate)) return candidate;
  }
  return target;
}

/**
 * Derives readable companions for a shop's brand colour (see DESIGN.md, "Merchant colour"): the card surface keeps
 * 4.5:1 for its text, the colour used as text passes on the page surface, and earned stamps stay distinguishable.
 */
export function merchantPalette(input: string, theme: Theme): MerchantPalette {
  const base = /^#[0-9a-f]{6}$/i.test(input.trim()) ? input.trim().toUpperCase() : FALLBACK;
  const merchantInk = contrast(WHITE, base) >= contrast(INK, base) ? WHITE : INK;
  const away = merchantInk === WHITE ? BLACK : WHITE;
  const merchant = shiftUntil(base, away, (c) => contrast(merchantInk, c) >= 4.5);
  const deepTarget = mix(merchant, BLACK, merchantInk === WHITE ? 0.3 : 0.14);
  const merchantDeep = contrast(merchantInk, deepTarget) >= 4.5 ? deepTarget : merchant;
  const surface = SURFACE[theme];
  const merchantText = shiftUntil(base, theme === "light" ? BLACK : WHITE, (c) => contrast(c, surface) >= 4.5);
  const coralWorks = contrast(STAMP, merchant) >= 3 && contrast(STAMP, merchantDeep) >= 3;
  const stampFill = coralWorks ? STAMP : merchantInk;
  const stampInk = coralWorks ? INK : merchant;
  return {
    merchant, merchantInk, merchantDeep, merchantText, stampFill, stampInk,
    cssVars: { "--merchant": merchant, "--merchant-ink": merchantInk, "--merchant-deep": merchantDeep, "--merchant-text": merchantText, "--stamp-fill": stampFill, "--stamp-ink": stampInk },
  };
}
