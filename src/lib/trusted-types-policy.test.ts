import { describe, expect, it } from "vitest";
import { TRUSTED_TYPES_POLICY } from "./trusted-types-policy";

type Rules = { createScriptURL: (value: string) => string | null; createScript: (value: string) => string | null };
function policy() {
  let rules!: Rules;
  const window = { trustedTypes: { defaultPolicy: null, createPolicy: (_name: string, given: Rules) => { rules = given; } } };
  new Function("window", "trustedTypes", "location", TRUSTED_TYPES_POLICY)(window, window.trustedTypes, { href: "https://app.example/card/x", origin: "https://app.example" });
  return rules;
}

describe("Trusted Types default policy", () => {
  it("passes Next's own chunk URLs and nothing else", () => {
    const rules = policy();
    expect(rules.createScriptURL("/_next/static/chunks/a.js")).toBe("/_next/static/chunks/a.js");
    // null is a reported violation; it never throws, which would break the page even in report-only mode.
    for (const url of ["https://evil.example/_next/static/a.js", "/api/qr", "/trusted.js", "data:text/javascript,1"]) expect(rules.createScriptURL(url)).toBeNull();
  });
  it("passes only zod's empty eval probe as a script string", () => {
    const rules = policy();
    expect(rules.createScript("(function anonymous(\n) {\n\n})")).toBe("(function anonymous(\n) {\n\n})");
    expect(rules.createScript("alert(1)")).toBeNull();
  });
});
