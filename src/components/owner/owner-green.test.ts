import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D-020: green marks the one next step per screen (Design, 30 Oct; audit SF-3). Every owner.css rule that paints with the
// action green or its soft tint is listed here with why; nav state, notices, selected rows and charts use the neutral fill
// and ink, so a new green use fails until Design agrees to it.
const ALLOWED: Record<string, string> = {
  ".ow-btn--primary": "the primary button, the one next step",
  ".ow-qsave .ow-btn--primary:hover": "the primary button keeps its colour on touch",
  ".ow-band": "the band, the one next step",
  ".ow-band small": "the band's sub-line, mixed from the band green",
  ".ow-check input[role=\"switch\"]:checked": "switch on-track: a state, not a next step (Head of Design ruling, 30 Oct)",
  ".ow-check input": "checkbox tick (accent-color)",
  ".ow-radio-card input": "radio dot (accent-color)",
  ".ow-prog-icon": "icon tiles, approved in the mocks",
  ".ow-link": "inline links (DESIGN.md)",
  ".ow-cardline-link": "inline link in the card preview",
  ".ow-cardline-shop i": "fallback swatch for the shop's colour in the card preview",
  ".ow-cardline-text u": "the customer's card line as the card shows it",
  ".ow-cardline-reward[data-new] b": "the new reward in the card preview",
  ".ow-qsum dl > div[data-new] dd": "the changed value in a review",
  ".ow-qcmp[data-new]": "the new version in a before/after review",
  ".ow-prog-row[data-saved]": "the row just saved, a short confirmation ring",
  ".ow-when[data-undo] > svg": "the undo icon on a take-back",
};

const css = readFileSync(join(process.cwd(), "src/components/owner/owner.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const green = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .filter(([, , body]) => /var\(--color-action(-soft)?\)/.test(body))
  .map(([, selector]) => selector.trim().replace(/\s+/g, " "));

describe("green in the owner app", () => {
  it("is used only by the listed rules", () => {
    expect(green.filter((selector) => !(selector in ALLOWED))).toEqual([]);
  });
  it("lists no rule that no longer uses it", () => {
    expect(Object.keys(ALLOWED).filter((selector) => !green.includes(selector))).toEqual([]);
  });
});
