import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// DESIGN.md: nothing outside src/styles/tokens.css defines a colour, font size, radius or layer. Before Phase 7 the
// dashboard had grown its own scale next to the tokens; this keeps any stylesheet or inline style from doing that again.
// An exception names the file, the exact text it allows and why. Dev-only preview pages (src/app/dev) are not checked.

const RULES: Array<[string, RegExp]> = [
  ["colour", /#[0-9a-fA-F]{3,8}\b|\brgba?\([^)]*\)|\bhsla?\([^)]*\)/g],
  ["font size", /font-size:[^;}]*?\d(px|rem)\b[^;}]*/g], // em sizes scale a token-sized parent
  ["radius", /border-radius:[^;}]*?\b[1-9]\d*(\.\d+)?px[^;}]*/g],
  ["layer", /z-index:\s*-?\d+/g],
];

const ALLOWED: Array<{ file: string; text: string; reason: string }> = [
  { file: "src/app/globals.css", text: "#0F1713", reason: "the page canvas follows the dark theme above any token scope; documented beside the rule" },
  { file: "src/components/customer/customer-card.module.css", text: "#FFFFFF", reason: "the QR ticket is white in both themes, so the scanner always sees dark on light" },
  { file: "src/components/customer/customer-card.module.css", text: "#17291F", reason: "light ink on the always-white QR ticket" },
  { file: "src/components/customer/customer-card.module.css", text: "#58645C", reason: "light muted ink on the always-white QR ticket" },
  { file: "src/components/customer/customer-card.module.css", text: "#143D2E", reason: "light ink on the always-white QR ticket" },
  { file: "src/components/customer/customer-card.module.css", text: "#111111", reason: "QR modules on the white ticket" },
  { file: "src/components/customer/customer-card.module.css", text: "clamp(1.5rem, 6.6vw, var(--text-28))", reason: "the goal line shrinks on narrow phones so merchant, balance and QR fit 360 × 800" },
  { file: "src/components/owner/owner.css", text: "#FFFFFF", reason: "the card preview's QR ticket, white in both themes like the guest card" },
  { file: "src/components/owner/owner.css", text: "#17291F", reason: "light ink on the card preview's white QR ticket" },
  { file: "src/components/owner/owner.css", text: "#58645C", reason: "light muted ink on the card preview's white QR ticket" },
  { file: "src/components/owner/owner.css", text: ".ow-pass", reason: "wallet-pass mocks picture the Apple and Google passes, so they follow the platforms" },
  { file: "src/components/qr-scanner.module.css", text: "#0B1410", reason: "camera viewport behind the live video, darker than any surface" },
  { file: "src/components/qr-scanner.module.css", text: "rgba(255, 255, 255, .92)", reason: "sight brackets drawn over the live camera image" },
  { file: "src/components/ui/dialog.module.css", text: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
  { file: "src/components/ui/sheet.module.css", text: "rgba(15, 23, 19, .48)", reason: "::backdrop does not inherit custom properties in older Safari; same value as --color-scrim" },
];

function files(root: string, pattern: RegExp): string[] {
  return readdirSync(root).flatMap(entry => {
    const path = join(root, entry);
    if (path === join("src", "app", "dev")) return [];
    if (statSync(path).isDirectory()) return files(path, pattern);
    return pattern.test(entry) ? [path] : [];
  });
}

/** Every rule hit in a stylesheet, with the whole declaration block so an exception can match a selector. */
function cssFindings(path: string): string[] {
  const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  if (path.endsWith("tokens.css")) return [];
  const blocks = css.split("}");
  return blocks.flatMap(block => RULES.flatMap(([kind, rule]) => [...block.matchAll(rule)].map(match => ({ kind, match: match[0], block }))))
    .filter(({ match, block }) => !ALLOWED.some(allow => allow.file === path && (match.includes(allow.text) || block.trimStart().startsWith(allow.text))))
    .map(({ kind, match, block }) => `${path}: ${kind} "${match}" in ${block.trim().split("{")[0].trim().slice(0, 60)}`);
}

describe("raw design values", () => {
  it("stylesheets take colours, font sizes, radii and layers from the tokens", () => {
    expect(files("src", /\.css$/).flatMap(cssFindings)).toEqual([]);
  });

  it("inline styles take font sizes from the tokens", () => {
    const findings = files("src", /\.tsx$/).flatMap(path => [...readFileSync(path, "utf8").matchAll(/fontSize:\s*-?\d/g)].map(() => path));
    expect(findings).toEqual([]);
  });

  it("every exception is still needed", () => {
    const stale = ALLOWED.filter(allow => !readFileSync(allow.file, "utf8").includes(allow.text));
    expect(stale).toEqual([]);
  });
});
