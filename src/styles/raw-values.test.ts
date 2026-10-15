import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyExceptions, cssFindings, sourceFindings, type Exception } from "./raw-values";

// DESIGN.md: nothing outside src/styles/tokens.css defines a colour, font size, radius or layer. Before Phase 7 the
// dashboard had grown its own scale next to the tokens; this keeps any stylesheet, inline style or CSS string from doing
// that again. Each exception names the file, the kind, the exact rule or value and why. Dev-only previews (src/app/dev)
// and SVG artwork attributes (logos) are not checked.

const tokens = new Set([...readFileSync(join(__dirname, "tokens.css"), "utf8").matchAll(/(--[\w-]+)\s*:/g)].map(match => match[1]));

// The wallet-pass mocks picture Apple's and Google's passes at a reduced scale, so they follow the platforms.
const WALLET_MOCK = [".ow-pass", ".ow-pass--google", ".ow-pass--apple .ow-pass-row:first-child .ow-pass-field b", ".ow-pass-title", ".ow-pass-field small",
  ".ow-pass-field b", ".ow-pass-primary b", ".ow-pass-logo", ".ow-pass-codewrap", ".ow-pass-code", ".ow-pass-alt", ".ow-pass-module", ".ow-pass-module small",
  ".ow-pass-issuer img", ".ow-pass-initial", ".ow-pass-program", ".ow-pass-big small", ".ow-pass-big b"];
const QR_TICKET = "the QR ticket is white in both themes, so scanners always read dark on light; its text uses the light inks";
const STANDALONE = "a standalone HTML document outside the app (no tokens load there); it carries its own styles";

const EXCEPTIONS: Exception[] = [
  { file: "src/app/globals.css", kind: "colour", property: "background-color", value: "#0F1713", reason: "the page canvas follows the dark theme above any token scope (dark --color-bg); documented beside the rule" },
  { file: "src/app/global-error.tsx", kind: "colour", selectors: [":root"], reason: "global-error renders without the app's CSS, so it inlines the token values" },
  { file: "src/app/global-error.tsx", kind: "font size", reason: "global-error renders without the app's CSS, so it inlines the type scale" },
  { file: "src/app/global-error.tsx", kind: "radius", selectors: ["button"], value: "999px", reason: "global-error inlines --radius-pill" },
  { file: "src/components/customer/customer-card.module.css", kind: "font size", selectors: [".goalLine"], value: "clamp(1.5rem, 6.6vw, var(--text-28))", reason: "the goal line shrinks on narrow phones so merchant, balance and QR fit 360 × 800" },
  { file: "src/components/customer/customer-card.module.css", kind: "colour", selectors: [".ticket", ".locator span", ".locator small", ".ticketNote"], reason: QR_TICKET },
  { file: "src/components/customer/customer-card.module.css", kind: "colour", selectors: [".readyTag"], reason: "the 'reward ready' tag sits on the merchant-coloured card: white with dark ink in both themes" },
  { file: "src/components/customer/customer-card.module.css", kind: "colour", selectors: [".walletButton"], reason: "Add to Wallet buttons follow Apple's and Google's button artwork (black with white)" },
  { file: "src/components/owner/owner.css", kind: "colour", selectors: [".ow-cardprev-ticket", ".ow-cardprev-number span"], reason: QR_TICKET },
  { file: "src/components/owner/owner.css", kind: "colour", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "font size", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/owner/owner.css", kind: "radius", selectors: WALLET_MOCK, reason: "wallet-pass mock (see WALLET_MOCK)" },
  { file: "src/components/qr-scanner.module.css", kind: "colour", selectors: [".video"], value: "#0B1410", reason: "camera viewport behind the live video, darker than any surface" },
  { file: "src/components/qr-scanner.module.css", kind: "colour", selectors: [".sight"], value: "rgba(255, 255, 255, .92)", reason: "sight brackets drawn over the live camera image" },
  { file: "src/components/ui/dialog.module.css", kind: "colour", selectors: [".dialog::backdrop"], value: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
  { file: "src/components/ui/sheet.module.css", kind: "colour", selectors: [".sheet::backdrop"], value: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
  ...(["colour", "font size"] as const).map(kind => ({ file: "src/lib/counter-sign.ts", kind, reason: `printable counter sign: ${STANDALONE}` })),
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
  ];
}

describe("raw design values in the repository", () => {
  const { rest, unused } = applyExceptions(repositoryFindings(), EXCEPTIONS);

  it("stylesheets, inline styles and CSS strings take colours, font sizes, radii and layers from the tokens", () => {
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
    expect(css(".a { font: 700 13px/1.5 sans-serif; }")).toEqual(["font size: font"]);
    expect(css(".a { border-top-left-radius: 7px; }")).toEqual(["radius: border-top-left-radius"]);
    expect(css(".a { --local-layer: 999; z-index: var(--local-layer); }")).toEqual(["layer: z-index"]);
    expect(css(".a { --local-size: 13px; font-size: var(--local-size); }")).toEqual(["font size: font-size"]);
    expect(css(".a { border-radius: calc(4px + var(--radius-sm)); box-shadow: inset 0 0 0 1px #123456; }")).toEqual(["radius: border-radius", "colour: box-shadow"]);
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
