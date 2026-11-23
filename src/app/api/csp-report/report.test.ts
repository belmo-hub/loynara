import { describe, expect, it } from "vitest";
import { reportLines } from "./report";

const report = (body: Record<string, unknown>) => ({ type: "csp-violation", url: "https://app.example/card/card__secret-token", body });

describe("CSP report lines", () => {
  it("names the directive and the bundled script, never the page, the sample or a query", () => {
    const lines = reportLines([report({ documentURL: "https://app.example/card/card__secret-token", sourceFile: "https://app.example/_next/static/chunks/app-1.js?v=card__secret-token", lineNumber: 12, effectiveDirective: "require-trusted-types-for", disposition: "report", sample: "Element innerHTML|<b>Café Müller</b>" })]);
    expect(lines).toEqual(["CSP report require-trusted-types-for in /_next/static/chunks/app-1.js:12"]);
    expect(lines.join()).not.toMatch(/secret|Müller|innerHTML/);
  });
  it("names a page or extension source by its kind, and drops what is not a CSP report", () => {
    expect(reportLines([report({ sourceFile: "https://app.example/card/card__secret-token", effectiveDirective: "require-trusted-types-for", disposition: "report" })])).toEqual(["CSP report require-trusted-types-for in (page)"]);
    expect(reportLines([report({ sourceFile: "chrome-extension://abc/x.js", effectiveDirective: "require-trusted-types-for", disposition: "report" })])).toEqual(["CSP report require-trusted-types-for in (extension)"]);
    expect(reportLines([{ type: "deprecation", body: {} }, null, "x"])).toEqual([]);
    expect(reportLines({ not: "a list" })).toEqual([]);
  });
  it("reads the older report-uri format the same way", () => {
    expect(reportLines({ "csp-report": { "document-uri": "https://app.example/card/card__secret-token", "effective-directive": "require-trusted-types-for", disposition: "report", "source-file": "https://app.example/_next/static/chunks/a.js", "line-number": 3, "script-sample": "Café" } })).toEqual(["CSP report require-trusted-types-for in /_next/static/chunks/a.js:3"]);
  });
  it("keeps odd values out of the log", () => {
    expect(reportLines([report({ effectiveDirective: "x\nFAKE LOG LINE", disposition: "enforce; drop", sourceFile: 42 })])).toEqual(["CSP ? ? in ?"]);
  });
});
