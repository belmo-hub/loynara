/**
 * The Trusted Types default policy (web audit finding 9; report-only, next.config.ts). Inlined at the top of <head> by
 * app/layout.tsx, so the parser runs it before any Next.js code. Next's chunk loader sets script URLs under
 * /_next/static/ on this origin: those pass. zod's eval check runs `Function("")` in a try, which the CSP (no
 * 'unsafe-eval') refuses anyway: only that empty function passes. Every other script URL, script string and HTML string
 * is reported to /api/csp-report, so the app's real sinks show up there before anything is enforced.
 * Never throw here: an exception from the default policy reaches the page's code even in report-only mode, while
 * returning nothing is just a violation (reported, and allowed while report-only).
 */
export const TRUSTED_TYPES_POLICY = `if (window.trustedTypes && !trustedTypes.defaultPolicy) trustedTypes.createPolicy("default", {
  createScriptURL: function (value) { var url; try { url = new URL(value, location.href); } catch (e) { return null; } if (url.origin === location.origin && url.pathname.indexOf("/_next/static/") === 0) return value; return null; },
  createScript: function (value) { if (value === "(function anonymous(\\n) {\\n\\n})") return value; return null; }
});`;
