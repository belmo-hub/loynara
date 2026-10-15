import { afterEach, describe, expect, it, vi } from "vitest";

type Rule = { source: string; headers: { key: string; value: string }[] };
async function rulesFor(nodeEnv: string): Promise<Rule[]> {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", nodeEnv);
  const config = (await import("../next.config")).default;
  return (await config.headers!()) as Rule[];
}
// Headers that apply to an ordinary page: every rule except the per-route ones, plus the CSP rule that excludes the wallet path.
const global = (rules: Rule[]) => Object.fromEntries(rules.filter(rule => rule.source === "/:path*" || rule.headers.some(h => h.key === "Content-Security-Policy")).flatMap(rule => rule.headers.map(h => [h.key, h.value])));
const directives = (policy: string) => Object.fromEntries(policy.split("; ").map(part => { const [name, ...values] = part.split(" "); return [name, values]; }));

afterEach(() => { vi.unstubAllEnvs(); });

describe("production security headers", () => {
  it("sends a CSP that locks every fetch type to this origin and forbids plugins, framing and base-tag tricks", async () => {
    const policy = directives((global(await rulesFor("production")))["Content-Security-Policy"]);
    expect(policy["default-src"]).toEqual(["'self'"]);
    expect(policy["object-src"]).toEqual(["'none'"]);
    expect(policy["frame-src"]).toEqual(["'none'"]);
    expect(policy["frame-ancestors"]).toEqual(["'none'"]);
    expect(policy["base-uri"]).toEqual(["'self'"]);
    expect(policy["form-action"]).toEqual(["'self'"]);
    expect(policy["connect-src"]).toEqual(["'self'"]);
    expect(policy["worker-src"]).toEqual(["'self'"]);
    expect(policy["font-src"]).toEqual(["'self'"]);
    expect(policy["img-src"]).toEqual(["'self'", "data:", "blob:"]);
  });

  it("allows only same-origin and inline script, never eval, remote hosts or wildcards in production", async () => {
    const header = global(await rulesFor("production"))["Content-Security-Policy"];
    const policy = directives(header);
    expect(policy["script-src"]).toEqual(["'self'", "'unsafe-inline'"]);
    expect(header).not.toContain("unsafe-eval");
    expect(header).not.toMatch(/https?:|\*|ws:|wss:/);
  });

  it("adds eval and websocket sources only for next dev", async () => {
    const policy = directives(global(await rulesFor("development"))["Content-Security-Policy"]);
    expect(policy["script-src"]).toContain("'unsafe-eval'");
    expect(policy["connect-src"]).toEqual(["'self'", "ws:", "wss:"]);
  });

  it("sends HSTS for a year without preload, plus nosniff and DENY framing", async () => {
    const headers = global(await rulesFor("production"));
    const hsts = headers["Strict-Transport-Security"];
    expect(Number(/max-age=(\d+)/.exec(hsts)![1])).toBeGreaterThanOrEqual(31536000);
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).not.toContain("preload");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
  });

  it("leaves the Apple wallet download path out of the global CSP so its own stricter nonce policy is not replaced", async () => {
    const rules = await rulesFor("production");
    const cspRule = rules.find(rule => rule.headers.some(h => h.key === "Content-Security-Policy"))!;
    expect(cspRule.source).toContain("(?!api/wallet/apple/download/)");
    expect(rules.filter(rule => rule.headers.some(h => h.key === "Content-Security-Policy"))).toHaveLength(1);
    const universal = rules.find(rule => rule.source === "/:path*")!;
    expect(universal.headers.map(h => h.key)).toEqual(expect.arrayContaining(["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy"]));
  });

  it("keeps the existing referrer policy and per-route bearer-link cache and robots headers", async () => {
    const rules = await rulesFor("production");
    expect(global(rules)["Referrer-Policy"]).toBe("no-referrer");
    for (const source of ["/card/:token", "/invite/:token", "/tap/:ref"]) {
      const headers = Object.fromEntries(rules.find(rule => rule.source === source)!.headers.map(h => [h.key, h.value]));
      expect(headers["Cache-Control"]).toBe("no-store");
      expect(headers["X-Robots-Tag"]).toBe("noindex, nofollow");
    }
  });

  it("does not advertise the framework and version in an X-Powered-By header", async () => {
    vi.resetModules();
    const config = (await import("../next.config")).default;
    expect(config.poweredByHeader).toBe(false);
  });
});
