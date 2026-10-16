import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The placeholder uses --color-ink-muted, whose contrast tokens.test.ts asserts; any transparency on top undoes that
// (at 85 % it fell to about 4.4:1), and browsers dim placeholders by default unless opacity is set to 1.
describe("field placeholder", () => {
  it("draws the muted ink at full strength", () => {
    const css = readFileSync(join(__dirname, "field.module.css"), "utf8");
    const rule = css.match(/\.input::placeholder\s*{([^}]*)}/)?.[1] ?? "";
    expect(rule).toMatch(/color:\s*var\(--color-ink-muted\)/);
    expect(rule).toMatch(/opacity:\s*1\s*(;|$)/);
  });
});
