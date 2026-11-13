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
    expect(read("src/app/global-error.tsx")).toContain("min-height: 48px; padding: 0 24px; border-radius: 999px; font: 700 1rem/1");
  });
});

describe("the Kasse: fields are as high as its actions", () => {
  it("every field in the shell takes the Kasse target; its error page keeps the large button", () => {
    expect(read("src/components/ui/cashier-shell.module.css")).toContain('.shell input:not([type="checkbox"], [type="radio"]) { min-height: var(--target-cashier); }');
    expect(read("src/app/cashier/error.tsx").match(/size="lg"/g)).toHaveLength(2);
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
