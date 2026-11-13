import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Design's rulings of 12 Nov, set D2 (ENG-237), the owner's part: no native controls (owner spec rule 4), one fold
// (decision 12), and the stepper's number (call 10).
const read = (file: string) => readFileSync(file, "utf8");
const owner = read("src/components/owner/owner.css");
const setup = read("src/components/owner/program-setup.tsx");

describe("one fold in the owner area (2b)", () => {
  it("every summary has the house chevron and no browser triangle", () => {
    expect(owner).toContain(".owner-app summary { display: flex; align-items: center; gap: var(--space-2); min-height: var(--target); list-style: none; cursor: pointer; }");
    expect(owner).toContain(".owner-app summary::-webkit-details-marker { display: none; }");
    expect(owner).toMatch(/\n\.owner-app summary::after \{ content: ""; flex: none; width: 7px; height: 7px;/);
    expect(owner).toContain(".owner-app details[open] > summary::after { translate: 0 2px; rotate: -135deg; }");
    expect(owner).not.toContain("summary::marker");
  });
  it("a panel's fold opens like „Mehr dazu“ and leaves room for its fields' focus rings", () => {
    expect(owner).toContain(":is(.ow-more, .ow-qpanel)[open]::details-content { grid-template-rows: 1fr; }");
    expect(owner).toContain(".ow-qpanel > summary ~ * { min-height: 0; overflow: hidden; padding: var(--space-1); margin: calc(var(--space-1) * -1); }");
  });
});

describe("the house file button (2a)", () => {
  it.each([["setup step 4", setup, "su-logo"], ["CSV-Vorschau", read("src/app/merchant/customers/import/page.tsx"), "im-file"]])("%s hides the browser's file field inside the button", (_name, source, id) => {
    expect(source).toMatch(new RegExp(`<label htmlFor="${id}" className="ow-btn ow-btn--secondary ow-filebtn">`));
    expect(source).toMatch(new RegExp(`<input id="${id}" className="ow-sr" type="file"`));
    expect(source).not.toMatch(/className="ow-input" type="file"/);
  });
  it("setup shows the chosen logo on the shop's colour and can remove it", () => {
    expect(setup).toContain('className="ow-logo-thumb" src={f.logoData}');
    expect(setup).toContain(">Logo entfernen</button>");
  });
});

describe("the stepper's number (34, 37, call 10)", () => {
  it("is a 44 px target; a typed value wears the field's edge and grows with its digits", () => {
    expect(owner).toMatch(/\n\.ow-number-value input \{ width: calc\(var\(--ow-number-chars\) \* 1ch \+ var\(--space-2\)\); min-width: var\(--target\);/);
    expect(owner).toMatch(/\n\.ow-number\[data-typed\] \.ow-number-value input \{ width: calc\(var\(--ow-number-chars\) \* 1ch \+ var\(--space-5\)\); min-width: max\(var\(--target\), calc\(3ch \+ var\(--space-5\)\)\);/);
  });
  it("the earning rate is typed, in the programme's rules and in setup", () => {
    expect(read("src/components/owner/owner-ui.tsx")).toContain("data-typed={typed || undefined}");
    expect(read("src/components/owner/program-rules.tsx")).toContain('<NumberStepper id="earning-rate" typed ');
    expect(setup).toContain('<NumberStepper id="su-rate" typed ');
  });
});
