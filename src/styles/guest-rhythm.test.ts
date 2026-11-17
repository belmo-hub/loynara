import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The customer, sign-in and state screens' rhythm (Design, 12 Nov, rulings SP5, SP7, SP11 and sign 15). The rendered
// gaps are measured in e2e/guest-rhythm.spec.ts; these pin the rules they come from.
/** The rule that starts a line with exactly this selector (not a longer list that ends with it). */
const rule = (file: string, selector: string) => {
  const css = `\n${readFileSync(file, "utf8")}`, at = css.indexOf(`\n${selector} {`);
  return at < 0 ? "" : css.slice(at, css.indexOf("}", at));
};
const C = "src/components/customer";

describe("cards and panels are 16 inside", () => {
  it.each([[`${C}/panels.module.css`, ".panel"], [`${C}/join.module.css`, ".panel"], [`${C}/join.module.css`, ".hero"]])("%s %s", (file, selector) => {
    expect(rule(file, selector)).toMatch(/padding: var\(--space-4\);/);
  });
});

describe("state screens", () => {
  it("start 24 under the bar: 16 of their own on the shell's 8", () => {
    expect(rule(`${C}/customer-state.module.css`, ".state")).toMatch(/padding-top: var\(--space-4\)/);
  });
  it("put a title's lead 4 under it", () => {
    expect(rule(`${C}/customer-state.module.css`, ".title + .message")).toContain("calc(var(--space-1) - var(--space-2))");
    expect(rule("src/components/ui/system-state.module.css", ".state .title + .body")).toContain("calc(var(--space-1) - var(--space-4))");
  });
  it("draw the one error tile: 48 px, the medium radius, the danger tint", () => {
    const tile = rule("src/components/ui/system-state.module.css", ".icon");
    expect(tile).toMatch(/width: 48px; height: 48px; border-radius: var\(--radius-md\)/);
    expect(tile).toContain("var(--color-danger)");
  });
  it("leave the stand-alone owner page at the page's own top padding", () => {
    expect(rule("src/components/owner/owner.css", ".ow-page--alone")).not.toContain("padding-top");
  });
});

describe("forms", () => {
  it.each([`${C}/panels.module.css`, `${C}/join.module.css`, `${C}/states.module.css`])("%s: 16 between field groups, 24 above the button", file => {
    expect(rule(file, ".form")).toMatch(/gap: var\(--space-4\)/);
    expect(rule(file, ".form > button")).toMatch(/margin-top: var\(--space-2\)/);
  });
  it("sign-in: 24 between the sheet's blocks, 16 between fields, 24 above the button, the forgot link 8 under its field", () => {
    const auth = "src/components/auth/auth.module.css";
    expect(rule(auth, ".sheet")).toMatch(/gap: var\(--space-6\)/);
    expect(rule(auth, ".form")).toMatch(/gap: var\(--space-4\)/);
    expect(rule(auth, '.form > button[type="submit"]')).toMatch(/margin-top: var\(--space-2\)/);
    expect(rule(auth, ".forgot")).toContain("margin-top: calc(var(--space-2) - var(--space-4))");
  });
});
