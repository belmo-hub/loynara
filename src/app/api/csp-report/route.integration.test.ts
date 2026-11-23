import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { POST } from "./route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Route tests require looplocal_test");

const report = JSON.stringify([{ type: "csp-violation", body: { effectiveDirective: "require-trusted-types-for", disposition: "report", sourceFile: "http://localhost:3000/_next/static/chunks/a.js", lineNumber: 1 } }]);
let peer = 0;
const ip = () => `198.51.100.${(peer += 1) % 250 + 1}`;
function post(body: BodyInit, headers: Record<string, string> = {}, from = ip()) {
  return POST(new Request("http://localhost:3000/api/csp-report", { method: "POST", headers: { "content-type": "application/reports+json", "cf-connecting-ip": from, ...headers }, body, duplex: "half" } as RequestInit));
}
/** A streamed body of `total` bytes with no Content-Length; counts what the route pulled. */
function stream(total: number) {
  const pulled = { bytes: 0 };
  const chunk = new TextEncoder().encode("x".repeat(4096));
  const body = new ReadableStream<Uint8Array>({ pull(controller) { if (pulled.bytes >= total) return controller.close(); pulled.bytes += chunk.byteLength; controller.enqueue(chunk); } });
  return { body, pulled };
}

const previous = process.env.TRUSTED_INGRESS;
let warn: ReturnType<typeof vi.spyOn>;
beforeEach(async () => { process.env.TRUSTED_INGRESS = "cloudflare_tunnel"; await pool.query("TRUNCATE rate_limits"); warn = vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { warn.mockRestore(); });
afterAll(async () => { if (previous === undefined) delete process.env.TRUSTED_INGRESS; else process.env.TRUSTED_INGRESS = previous; await pool.end(); });

// Review of #350 (C10–C12): the unauthenticated endpoint logs only what it can read cheaply and always answers 204.
describe("/api/csp-report", () => {
  it("logs a report, then stops logging one network after 60 in 15 minutes (C10)", async () => {
    const from = ip();
    for (let i = 0; i < 60; i += 1) expect((await post(report, {}, from)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(60);
    expect((await post(report, {}, from)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(60);
    expect((await post(report)).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(61);
  });

  it("stops reading a body past 16 KB, with no Content-Length or a false one (C11)", async () => {
    const unannounced = stream(64 * 1024 * 1024);
    expect((await post(unannounced.body)).status).toBe(204);
    expect(unannounced.pulled.bytes).toBeLessThan(64 * 1024);
    const understated = stream(64 * 1024 * 1024);
    expect((await post(understated.body, { "content-length": "100" })).status).toBe(204);
    expect(understated.pulled.bytes).toBeLessThan(64 * 1024);
    expect((await post("x", { "content-length": String(64 * 1024 * 1024) })).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
  });

  it("reads only the two report content types (C12)", async () => {
    expect((await post(report, { "content-type": "text/plain" })).status).toBe(204);
    expect((await post(report, { "content-type": "application/json" })).status).toBe(204);
    expect(warn).not.toHaveBeenCalled();
    expect((await post(JSON.stringify({ "csp-report": { "effective-directive": "require-trusted-types-for", disposition: "report" } }), { "content-type": "application/csp-report" })).status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
