import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// A closed dialog or a new screen parks focus on <main tabindex="-1">. That is not a stop a person tabs to, so no
// shell draws a ring around the whole page for it; every real control keeps its ring.
describe("focus parked on the page", () => {
  const globals = readFileSync("src/app/globals.css", "utf8");
  it("draws no outline around <main> in any shell", () => {
    expect(globals).toMatch(/(^|\n)main\[tabindex="-1"\]:focus\s*{\s*outline:\s*none;\s*}/);
  });
  it("leaves the ring on links, buttons and fields", () => {
    expect(globals).toMatch(/button:focus-visible[^{]*{\s*outline:\s*2px solid var\(--color-focus\)/);
  });
});
