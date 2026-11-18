import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyExceptions, cssFindings, sourceFindings, type Exception } from "./raw-values";

// DESIGN.md: nothing outside src/styles/tokens.css defines a colour, font size, weight, radius or layer. Before Phase 7 the
// dashboard had grown its own scale next to the tokens; this keeps any stylesheet, inline style or CSS string from doing
// that again. Each exception names the file, the kind, the exact rule or value and why. Dev-only previews (src/app/dev)
// and SVG artwork attributes (logos) are not checked.
// Spacing (SF-7, ENG-137) is checked on the owner screens: stylesheet values on the 4 px scale, and no raw spacing in
// inline styles at all. The customer, Kasse and ui modules follow in their area tickets (G, H).

const tokens = new Set([...readFileSync(join(__dirname, "tokens.css"), "utf8").matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));

// The wallet-pass mocks picture Apple's and Google's passes at a reduced scale, so they follow the platforms.
const WALLET_MOCK = [".ow-pass", ".ow-pass--google", ".ow-pass--apple .ow-pass-row:first-child .ow-pass-field b", ".ow-pass-title", ".ow-pass-field small",
  ".ow-pass-field b", ".ow-pass-primary b", ".ow-pass-logo", ".ow-pass-codewrap", ".ow-pass-code", ".ow-pass-alt", ".ow-pass-module", ".ow-pass-module small",
  ".ow-pass-issuer img", ".ow-pass-mark", ".ow-pass-initial", ".ow-pass-program", ".ow-pass-big small", ".ow-pass-big b"];
const QR_TICKET = "the QR ticket is white in both themes, so scanners always read dark on light; its text uses the light inks";
const STANDALONE = "a standalone HTML document outside the app (no tokens load there); it carries its own styles";
const OWNER_UI = /^src\/(?:components\/owner|app\/merchant)\//;
// Spacing that a later ticket owns: the form controls (ENG-139). The chip and the toast are on the scale since ENG-231;
// `summary` keeps its 10 px until the house fold replaces the native one (set D2, ENG-237): a flex summary loses its triangle.
const CONTROLS = [".owner-app summary", ".ow-radio-card input", '.ow-colorrow input[type="color"]', ".ow-seg button"];

const EXCEPTIONS: Exception[] = [
  { file: "src/app/globals.css", kind: "colour", property: "background-color", value: "#0F1713", reason: "the page canvas follows the dark theme above any token scope (dark --color-bg); documented beside the rule" },
  { file: "src/app/global-error.tsx", kind: "colour", selectors: [":root"], reason: "global-error renders without the app's CSS, so it inlines the token values" },
  { file: "src/app/global-error.tsx", kind: "font size", reason: "global-error renders without the app's CSS, so it inlines the type scale" },
  { file: "src/app/global-error.tsx", kind: "radius", selectors: ["button"], value: "999px", reason: "global-error inlines --radius-pill" },
  { file: "src/app/global-error.tsx", kind: "weight", reason: "global-error renders without the app's CSS, so it writes its weights as numbers (set D2 moves them to the tokens' values)" },
  { file: "src/components/customer/customer-card.module.css", kind: "colour", selectors: [".ticket", ".locator span", ".locator small"], reason: QR_TICKET },
  { file: "src/components/customer/customer-card.module.css", kind: "colour", selectors: [".walletButton"], reason: "Add to Wallet buttons follow Apple's and Google's button artwork (black with white)" },
  { file: "src/components/owner/customers-view.module.css", kind: "radius", selectors: [".cards > :global(.ow-seg) button"], value: "10px", reason: "Kunden's switch segment sits 4 inside its radius-14 track (Design, 18 Nov, #283); not a house radius" },
  { file: "src/components/customer/mix-card.module.css", kind: "radius", selectors: [".mark"], value: "10px", reason: "the mix card's shop mark is drawn from the founder's picture (mix NOTES, Deviations); not a house radius" },
  { file: "src/components/customer/wallet-step.module.css", kind: "colour", selectors: [".lock", ".alert", ".from small", ".example"], reason: "ENG-130 lock-screen picture: dark in both themes like a phone's lock screen, „Beispiel“ at fixed full contrast (Legal)" },
  { file: "src/components/owner/owner.css", kind: "colour", selectors: [".ow-cardprev-ticket", ".ow-cardprev-number span"], reason: QR_TICKET },
  { file: "src/components/owner/owner.css", kind: "colour", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "font size", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "radius", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "weight", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "weight", selectors: [".ow-lock-time"], reason: "the lock-screen clock is drawn as the phone draws it, in a light 300" },
  { file: "src/components/owner/owner.css", kind: "spacing", selectors: [...WALLET_MOCK, ".ow-pass-field", ".ow-pass-row--sec", ".ow-pass-issuer", ".ow-cardprev-ticket", ".ow-logo-thumb"], reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "spacing", selectors: CONTROLS, reason: "form controls, ENG-139 (SF-8, SF-9)" },
  { file: "src/components/owner/owner.css", kind: "spacing", selectors: [".ow-days"], value: "calc(var(--space-1) - 1px)", reason: "seven 44 px day chips with 3 px gaps fill the panel's 326 px at 390 (Design decision 28)" },
  { file: "src/components/owner/card-screen.module.css", kind: "spacing", reason: "the mix inset: 20 from a panel's outer edge is 19 inside its 1 px border (mix NOTES › --m-in), and D's hanging correction starts 11 under its line" },
  { file: "src/components/owner/card-actions.tsx", kind: "spacing", property: "margin", value: "1px", reason: "QRCode.toDataURL's quiet zone in modules, not a style" },
  { file: "src/components/qr-scanner.module.css", kind: "colour", selectors: [".video"], value: "#0B1410", reason: "camera viewport behind the live video, darker than any surface" },
  { file: "src/components/qr-scanner.module.css", kind: "colour", selectors: [".sight"], value: "var(--sight-ink, rgba(255, 255, 255, .92))", reason: "sight brackets drawn over the live camera image (white unless the cashier shell tints them)" },
  { file: "src/components/ui/dialog.module.css", kind: "colour", selectors: [".dialog::backdrop"], value: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
  { file: "src/components/ui/sheet.module.css", kind: "colour", selectors: [".sheet::backdrop"], value: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
  ...(["colour", "font size", "weight"] as const).map(kind => ({ file: "src/lib/counter-sign.ts", kind, reason: `printable counter sign: ${STANDALONE}` })),
  ...(["colour", "font size", "radius"] as const).map(kind => ({ file: "src/lib/wallet/http.ts", kind, reason: `wallet hand-off page: ${STANDALONE}` })),
];

function files(root: string): string[] {
  return readdirSync(root).flatMap(entry => {
    const path = join(root, entry);
    if (path === join("src", "app", "dev")) return [];
    if (statSync(path).isDirectory()) return files(path);
    return [path];
  });
}

function repositoryFindings() {
  const sources = files("src").filter(path => !/\.test\.tsx?$/.test(path) && !path.endsWith("tokens.css") && !path.endsWith(join("styles", "raw-values.ts")));
  return [
    ...sources.filter(path => path.endsWith(".css")).flatMap(path => cssFindings(path, readFileSync(path, "utf8"), tokens)),
    ...sources.filter(path => /\.tsx?$/.test(path)).flatMap(path => sourceFindings(path, readFileSync(path, "utf8"), tokens)),
  ].filter(finding => finding.kind !== "spacing" || OWNER_UI.test(finding.file.split("\\").join("/")));
}

describe("raw design values in the repository", () => {
  const { rest, unused } = applyExceptions(repositoryFindings(), EXCEPTIONS);

  it("stylesheets, inline styles and CSS strings take colours, font sizes, weights, radii and layers from the tokens, spacing from the scale", () => {
    expect(rest.map(f => `${f.file} | ${f.selector} | ${f.property}: ${f.value} (${f.kind})`)).toEqual([]);
  });

  it("every exception still suppresses a real finding (text left in a comment does not count)", () => {
    expect(unused.map(e => `${e.file} ${e.kind} ${e.selectors?.join(", ") ?? ""} ${e.value ?? ""}`)).toEqual([]);
  });
});

// Each case comes from review: the guard must catch it.
describe("the checker", () => {
  const css = (text: string) => cssFindings("x.css", text, tokens).map(f => `${f.kind}: ${f.property}`);
  const tsx = (text: string) => sourceFindings("x.tsx", text, tokens).map(f => `${f.kind}: ${f.property}`);

  it("reads shorthands, corner radii and custom-property indirection", () => {
    expect(css(".a { font: 700 13px/1.5 sans-serif; }")).toEqual(["font size: font", "weight: font"]);
    expect(css(".a { border-top-left-radius: 7px; }")).toEqual(["radius: border-top-left-radius"]);
    expect(css(".a { --local-layer: 999; z-index: var(--local-layer); }")).toEqual(["layer: z-index"]);
    expect(css(".a { --local-size: 13px; font-size: var(--local-size); }")).toEqual(["font size: font-size"]);
    expect(css(".a { border-radius: calc(4px + var(--radius-sm)); box-shadow: inset 0 0 0 1px #123456; }")).toEqual(["radius: border-radius", "colour: box-shadow"]);
  });

  it("takes a weight only from the four tokens, in font-weight, the font shorthand and inline styles", () => {
    expect(css(".a { font-weight: 700; } .b { font-weight: bold; } .c { font-weight: var(--weight-mine); }")).toEqual(["weight: font-weight", "weight: font-weight", "weight: font-weight"]);
    expect(css(".a { font: 300 var(--text-16)/1 var(--font-sans); }")).toEqual(["weight: font"]);
    expect(css(".a { font: italic 700 var(--text-16)/1 var(--font-sans); }")).toEqual(["weight: font"]);
    expect(tsx("<p style={{ fontWeight: 600 }} />")).toEqual(["weight: font-weight"]);
    expect(css(".a { font-weight: var(--weight-label); } .b { font-weight: inherit; } .c { font: inherit; } .d { font: var(--weight-heavy) var(--text-16)/1 var(--font-sans); }")).toEqual([]);
    expect(tsx('<p style={{ fontWeight: "var(--weight-strong)" }} />')).toEqual([]);
  });

  it("accepts token values", () => {
    expect(css(".a { font: var(--weight-strong) var(--text-16)/1.2 var(--font-sans); border-radius: var(--radius-pill); z-index: calc(var(--z-sheet) - 1); color: var(--color-ink); font-size: 1.2em; }")).toEqual([]);
  });

  it("reads inline style objects, numeric and string, however they are spaced", () => {
    expect(tsx("<p style={{ fontSize: 14 }} />")).toEqual(["font size: font-size"]);
    expect(tsx("<p style={{ fontSize : 14 }} />")).toEqual(["font size: font-size"]);
    expect(tsx('<p style={{ fontSize: "14px" }} />')).toEqual(["font size: font-size"]);
    expect(tsx("<p style={{ zIndex: 3, borderRadius: 8, color: '#123456' }} />")).toEqual(["layer: z-index", "radius: border-radius", "colour: color"]);
    expect(tsx('<p style={{ fontSize: "var(--text-14)", zIndex: "var(--z-nav)" }} />')).toEqual([]);
  });

  it("flags spacing off the 4 px scale in stylesheets, and any raw spacing in an inline style", () => {
    expect(css(".a { padding: 14px var(--space-4); gap: 6px; margin: 0 2px 8px; }")).toEqual(["spacing: padding", "spacing: gap", "spacing: margin"]);
    expect(css(".a { padding: 12px 16px; gap: var(--space-3); margin-left: -6px; padding-left: calc(40px + var(--space-3)); }")).toEqual([]);
    expect(tsx("<p style={{ marginTop: 8, paddingBlock: '4px', gap: 12 }} />")).toEqual(["spacing: margin-top", "spacing: padding-block", "spacing: gap"]);
    expect(tsx('<p style={{ margin: 0, gap: "var(--space-2)", padding: "0 var(--space-4)" }} />')).toEqual([]);
  });

  it("reads an inline style that sits between two quoted attributes (review N-1)", () => {
    expect(tsx('<div className="a" style={{ marginTop: 8 }} id="b" />')).toEqual(["spacing: margin-top"]);
    expect(tsx('<p className="a" style={{ color: "#123456" }} id="b" />')).toEqual(["colour: color"]);
  });

  it("reads CSS written inside strings", () => {
    expect(tsx("const style = `.a { color: #123456; font-size: 13px; }`;")).toEqual(["colour: color", "font size: font-size"]);
  });

  it("ignores comments, so a value left only in a comment neither counts nor keeps an exception alive", () => {
    expect(css("/* .a { color: #123456; } */ .b { color: var(--color-ink); }")).toEqual([]);
    const exception: Exception = { file: "x.css", kind: "colour", value: "#17291F", reason: "test" };
    expect(applyExceptions(cssFindings("x.css", ".t { color: var(--color-on-stamp); /* #17291F */ }", tokens), [exception]).unused).toEqual([exception]);
  });

  it("matches exceptions by exact selector, not by a prefix", () => {
    const exception: Exception = { file: "x.css", kind: "colour", selectors: [".ow-pass"], reason: "test" };
    const { rest } = applyExceptions(cssFindings("x.css", ".ow-pass { color: #111; } .ow-password { color: #111; }", tokens), [exception]);
    expect(rest.map(f => f.selector)).toEqual([".ow-password"]);
  });
});
