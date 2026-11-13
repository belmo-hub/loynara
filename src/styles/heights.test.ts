import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// One field height and one primary height per area (Design, 12 Nov, ruling SP6 and call 6; DESIGN.md "Heights per
// area"). The rendered heights are measured in e2e/owner-rhythm.spec.ts and e2e/guest-rhythm.spec.ts.
const read = (file: string) => readFileSync(file, "utf8");
const owner = read("src/components/owner/owner.css");

describe("owner: fields and the button that ends a form are 52", () => {
  it("the field rule carries the height once", () => {
    expect(owner).toMatch(/\n\.ow-input, \.ow-select, \.ow-textarea \{ width: 100%; min-height: 52px;/);
    expect(owner).not.toMatch(/\.ow-(qpanel|search|qmoney) \.ow-input \{[^}]*min-height/);
  });
  it("a form's submit and the save bar's buttons take it", () => {
    expect(owner).toContain('form .ow-btn--primary[type="submit"]:not(.ow-btn--sm), .ow-savebar .ow-btn { min-height: 52px; }');
  });
  it("the colour picker is as high as the hex field beside it", () => {
    expect(owner).toContain('.ow-colorrow input[type="color"] { width: 56px; height: 52px;');
  });
  it("the pinned save bar keeps room for two wrapped 52 px buttons", () => {
    expect(owner).toContain("padding-bottom: calc(var(--space-12) + var(--ow-tabbar) + 136px); }");
    expect(owner).toContain("scroll-margin-bottom: calc(var(--ow-tabbar) + 184px); }");
  });
  it("the sidebar's location select stays 48", () => {
    expect(owner).toMatch(/\n\.ow-loc \.ow-select \{ min-height: 48px;/);
  });
  it("the owner's error and missing page end in a 52 px button", () => {
    expect(owner).toContain(".owner-app .ow-state-btn { min-height: 52px; }");
    expect(read("src/app/merchant/error.tsx").match(/ow-state-btn/g)).toHaveLength(2);
    expect(read("src/app/merchant/not-found.tsx")).toContain('buttonClassName({}, "ow-state-btn")');
  });
});

describe("customer and sign-in: the primary is the 48 px default", () => {
  it.each(["src/components/join-client.tsx", "src/components/tap-client.tsx", "src/components/invite-client.tsx", "src/app/login/login-form.tsx", "src/app/register/page.tsx", "src/app/error.tsx", "src/app/not-found.tsx"])("%s has no large button", file => {
    expect(read(file)).not.toMatch(/size(=|: )"(lg|xl)"/);
  });
  it("global-error copies the same 48 and 16", () => {
    expect(read("src/app/global-error.tsx")).toContain("min-height: 48px; padding: 0 24px; border-radius: 999px; font: 720 1rem/1");
  });
});

describe("the Kasse: fields are as high as its actions", () => {
  it("every field in the shell takes the Kasse target; its error page keeps the large button", () => {
    expect(read("src/components/ui/cashier-shell.module.css")).toContain('.shell input:not([type="checkbox"], [type="radio"]) { min-height: var(--target-cashier); }');
    expect(read("src/app/cashier/error.tsx").match(/size="lg"/g)).toHaveLength(2);
  });
});

describe("the customer's card", () => {
  it("the confirmation that closes the card is 48; its inline actions stay small", () => {
    const card = read("src/components/customer/customer-card.tsx");
    expect(read("src/components/customer/customer-card.module.css")).toContain(".closeConfirm button { min-height: 48px; }");
    expect(card).toContain('<Button variant="quiet" size="sm" className={styles.refreshButton}');
  });
});

describe("around the button", () => {
  it("the join sentence that names the button sits 8 above it", () => {
    expect(read("src/components/customer/join.module.css")).toContain(".form > .notice + button { margin-top: calc(var(--space-2) - var(--space-4)); }");
  });
  it("a wrapped label on a full-width button starts at its icon", () => {
    expect(read("src/components/ui/button.module.css")).toContain(".block .icon + .label { text-align: start; }");
  });
});

// Overlays and toasts (ruling SP10, calls 8 and 9; DESIGN.md "Overlays" and "Toasts"): one family.
describe("sheets, dialogs and toasts", () => {
  const sheet = read("src/components/ui/sheet.module.css"), dialog = read("src/components/ui/dialog.module.css"), toast = read("src/components/ui/toast.module.css");
  it("a sheet's title sits 8 under the handle and 12 above the text; the close adds no height", () => {
    expect(sheet).toContain(".header { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-3) var(--space-3) var(--space-5); }");
    expect(sheet).toContain("margin-block: calc(var(--target) / -2);");
    expect(sheet).toContain('.sheet:is([data-side="end"], [data-side="auto"]) .header { padding-top: var(--space-5); }');
  });
  it("a pinned footer's line stands 12 under the content", () => {
    expect(sheet).toMatch(/\n\.content \{[^}]*padding: 0 var\(--space-5\) var\(--space-3\); \}/);
  });
  it("both dialogs are 20 inside, with the actions 24 under the text and 48 high", () => {
    expect(dialog).toContain(".body { display: grid; gap: var(--space-3); padding: var(--space-5); }");
    expect(dialog).toMatch(/\n\.actions \{[^}]*margin-top: var\(--space-3\); \}/);
    expect(owner).toMatch(/\n\.ow-dialog \{[^}]*border-radius: var\(--radius-xl\); padding: var\(--space-5\);/);
    expect(owner).toMatch(/\n\.ow-dialog-actions \{[^}]*margin-top: var\(--space-3\); \}\n\.ow-dialog-actions \.ow-btn \{ min-height: 48px; \}/);
    expect(owner).toContain("@media (max-width: 479px) { .ow-dialog-actions > * { flex: 1 1 100%; } }");
  });
  it("both toasts are 48 high with the overlay radius: a pill on one line, clear ends when the text wraps", () => {
    expect(owner).toMatch(/\n\.ow-toast \{[^}]*min-height: 48px; padding: var\(--space-2\) var\(--space-4\); border-radius: var\(--radius-xl\);/);
    expect(toast).toMatch(/min-height: 48px; padding: var\(--space-2\) calc\(\(48px - var\(--target\)\) \/ 2\) var\(--space-2\) var\(--space-4\);\n  border-radius: var\(--radius-xl\);/);
  });
  it("in a customer sheet the actions stand 24 under the last text", () => {
    expect(read("src/components/customer/customer-card.module.css")).toContain(".sheetBody > :is(.walletButtons, button) { margin-top: var(--space-3); }");
  });
});

// ENG-245 (WCAG 2.4.11): the rendered Tab order is walked in e2e/owner-rhythm.spec.ts.
describe("the sticky save bar on desktop", () => {
  it("ends the page's scrollport above itself while it is up, by the height the bar reports", () => {
    expect(owner).toContain("@media (min-width: 1024px) { html:has(.ow-savebar:not([data-idle])) { scroll-padding-bottom: calc(var(--ow-savebar-h, 77px) + var(--space-4)); } }");
    const bar = read("src/components/owner/owner-ui.tsx");
    expect(bar).toContain('root.style.setProperty("--ow-savebar-h", `${el.offsetHeight}px`)');
    expect(bar).toContain('root.style.removeProperty("--ow-savebar-h")');
  });
});
