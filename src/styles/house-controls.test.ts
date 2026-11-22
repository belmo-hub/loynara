import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design's rulings of 12 Nov, set D2 (ENG-237), the customer and shared part. These pin the rules. Rendered: the
// birthday panel in e2e/guest-rhythm.spec.ts. Not in a browser test yet: forced colours, and the first-tap join
// page's link (that page is behind a switch CI leaves off).
const read = (file: string) => readFileSync(file, "utf8");
const card = read("src/components/customer/customer-card.module.css");
const CLAMP = "display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden;";

describe("no native controls on the card (45a)", () => {
  it("the birthday's day and month are house selects in two columns, with no inline style", () => {
    const panel = read("src/components/card-birthday.tsx");
    expect(panel).toMatch(/<Select id="birthday-day" label="Tag"/);
    expect(panel).toMatch(/<Select id="birthday-month" label="Monat"/);
    expect(panel).not.toMatch(/<select|style=\{\{/);
    expect(read("src/components/customer/panels.module.css")).toContain(".dayMonth { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); align-items: start; gap: var(--space-3); }");
  });
});

describe("the shop colour's contrast and long names", () => {
  const face = read("src/components/customer/card-face.module.css");
  it("the level tag is outlined, not tinted (45b)", () => {
    expect(face).toMatch(/\n\.levelTag \{[^}]*background: none; box-shadow: inset 0 0 0 1px color-mix\(in oklab, var\(--merchant-ink\), transparent 50%\);/);
  });
  it("the shop's name is cut at two lines on the house card and in the Kasse's header (31)", () => {
    expect(face).toContain(`.business strong { ${CLAMP}`);
    expect(read("src/components/ui/cashier-shell.module.css")).toContain(`.location { ${CLAMP}`);
  });
});

describe("forced colours (35)", () => {
  it("filled buttons stay filled, in every area", () => {
    expect(read("src/components/ui/button.module.css")).toContain(".primary, .danger, .go { forced-color-adjust: none; background: ButtonText; color: ButtonFace; border-color: ButtonText; }");
    expect(read("src/components/owner/owner.css")).toContain(".ow-btn--primary, .ow-btn--danger, .ow-qsave .ow-btn--danger:not(:disabled), .ow-band { forced-color-adjust: none; background: ButtonText; color: ButtonFace; border-color: ButtonText; }");
  });
  it("hover and busy keep the system fill, and the focus ring is the system's", () => {
    const button = read("src/components/ui/button.module.css"), ownerCss = read("src/components/owner/owner.css");
    expect(button).toContain('.primary:hover:not(:disabled), .danger:hover:not(:disabled), .go:hover:not(:disabled), .primary[aria-busy="true"], .danger[aria-busy="true"], .go[aria-busy="true"] { background: ButtonText; color: ButtonFace; }');
    expect(button).toContain(".primary:focus-visible, .danger:focus-visible, .go:focus-visible { outline-color: Highlight; }");
    // After the busy rules it overrides, so the cascade needs no extra weight.
    expect(button.indexOf("@media (forced-colors: active)")).toBeGreaterThan(button.indexOf('.go[aria-busy="true"] { background: var(--color-success)'));
    expect(ownerCss).toContain(".ow-btn--primary:hover:not(:disabled), .ow-btn--danger:hover:not(:disabled), .ow-qsave .ow-btn--primary:hover, a.ow-band:hover, button.ow-band:hover { background: ButtonText; color: ButtonFace; }");
    // The area's own ring rule outranks a button's, so the forced block names the same controls.
    expect(ownerCss).toContain(".owner-app :is(a, button, input, select, textarea, summary, [tabindex]):focus-visible { outline-color: Highlight; }");
    // The band's children stay opted out with it: handed back to the system, their text vanishes into its backplate.
    expect(ownerCss).toContain(".ow-band :is(.ow-band-icon, small) { background: none; color: ButtonFace; }");
    expect(ownerCss).not.toMatch(/\.ow-band[^{]*\{[^}]*forced-color-adjust: auto/);
    // A disabled button in a save bar stays disabled when hovered: its rule follows the hover rule.
    const disabled = ".ow-btn--primary:disabled, .ow-btn--danger:disabled, .ow-qsave .ow-btn--primary:disabled { background: Canvas; color: GrayText; border-color: GrayText; }";
    expect(ownerCss).toContain(disabled);
    expect(ownerCss.indexOf(disabled)).toBeGreaterThan(ownerCss.indexOf(".ow-qsave .ow-btn--primary:hover, a.ow-band:hover"));
  });
  it("the level tag keeps an edge", () => {
    expect(read("src/components/customer/card-face.module.css")).toContain(".levelTag { border: 1px solid CanvasText; padding-inline: calc(var(--space-3) - 1px); }");
  });
  it("the guest card's ticket and band keep an edge", () => {
    expect(card).toContain("@media (forced-colors: active) { .object > section, .band { border: 1px solid CanvasText; } }");
  });
  it("the Kasse's status strip keeps an edge and its dot", () => {
    expect(read("src/components/ui/cashier-shell.module.css")).toContain("@media (forced-colors: active) { .status { border: 1px solid CanvasText; } .dot { forced-color-adjust: none; background: CanvasText; } }");
  });
});

describe("the way back on the first-tap join page (37)", () => {
  it("stays in its line and reaches a 44 px hit area", () => {
    expect(read("src/components/customer/first-page.module.css")).toContain(".blocks .recover a { position: relative; display: inline; min-height: 0; white-space: nowrap; }");
    expect(read("src/components/customer/first-page.module.css")).toContain('.blocks .recover a::after { content: ""; position: absolute; inset: calc((var(--target) - 1lh) / -2) 0; }');
  });
});
