/**
 * One log line per CSP report (Reporting API, application/reports+json). Only what finds the sink: the directive, the
 * disposition and the script file. Never the page URL (a card page's path is the card's credential), never the sample
 * (it can hold a shop's or a guest's words), never a query string.
 */
export function reportLines(body: unknown): string[] {
  // report-uri sends one {"csp-report": {…}} with kebab-case names; the Reporting API a list of reports.
  const legacy = (body as { "csp-report"?: Record<string, unknown> } | null)?.["csp-report"];
  if (legacy && typeof legacy === "object") body = [{ type: "csp-violation", body: { disposition: legacy.disposition, effectiveDirective: legacy["effective-directive"], sourceFile: legacy["source-file"], lineNumber: legacy["line-number"] } }];
  if (!Array.isArray(body)) return [];
  return body.slice(0, 20).flatMap(report => {
    const r = (report as { type?: unknown; body?: Record<string, unknown> } | null);
    if (r?.type !== "csp-violation" || !r.body) return [];
    const word = (value: unknown) => typeof value === "string" && /^[a-z-]{1,40}$/.test(value) ? value : "?";
    const file = typeof r.body.sourceFile === "string" ? scriptFile(r.body.sourceFile) : "?";
    const line = Number.isInteger(r.body.lineNumber) ? `:${r.body.lineNumber}` : "";
    return [`CSP ${word(r.body.disposition)} ${word(r.body.effectiveDirective)} in ${file}${line}`];
  });
}

/** A bundled script keeps its path; anything else (the page itself, an inline script, an extension) is named by kind. */
function scriptFile(source: string) {
  try {
    const url = new URL(source);
    if (url.pathname.startsWith("/_next/static/") && /^[\w./-]{1,200}$/.test(url.pathname)) return url.pathname;
    return url.protocol === "chrome-extension:" || url.protocol === "moz-extension:" || url.protocol === "safari-web-extension:" ? "(extension)" : "(page)";
  } catch { return "(inline)"; }
}
