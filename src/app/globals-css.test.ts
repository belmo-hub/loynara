import { describe, expect, it } from "vitest";
import { classUsage } from "@/styles/css-usage";

// globals.css held 121 classes for the old landing, sign-in and state pages long after those pages moved to CSS
// modules. This keeps it from collecting dead rules again: every class rule left there must be referenced by code.
describe("globals.css", () => {
  it("has no class rule that no code references", () => {
    const unused = classUsage("src/app/globals.css", ["src", "e2e"], ["src/styles/css-usage.ts", "src/app/globals-css.test.ts"]).filter(item => item.references === 0);
    expect(unused).toEqual([]);
  });
});
