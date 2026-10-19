import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { enforcePeerLimit, peerIdentity, RateLimitError } from "@/lib/rate-limit";

const business = vi.hoisted(() => ({ enroll: vi.fn(), getCard: vi.fn(), recover: vi.fn(), authPost: vi.fn(), authGet: vi.fn() }));
vi.mock("@/lib/product", () => ({ enroll: business.enroll, getCard: business.getCard }));
vi.mock("@/lib/card-recovery", () => ({ normalizeRecoveryEmail: (s: string) => s.toLowerCase(), requestCardRecovery: business.recover }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ POST: business.authPost, GET: business.authGet }) }));
import { POST as enroll } from "./enroll/route";
import { POST as recover } from "./recover/route";
import { GET as card } from "./card/[token]/route";
import { POST as signIn, GET as authGet } from "./auth/[...all]/route";
import { GET as health } from "./health/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const base = "https://app.example.test";
const touched = new Set<string>();
const key = (scope: string, identity: string) => {
  const hashed = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update(scope).update("\0").update(identity).digest("hex");
  touched.add(hashed); return hashed;
};
const req = (path: string, ip?: string, data?: object) => new Request(`${base}${path}`, {
  method: data ? "POST" : "GET", headers: { origin: base, "content-type": "application/json", ...(ip ? { "cf-connecting-ip": ip } : {}) },
  ...(data ? { body: JSON.stringify(data) } : {}),
});
const ips = () => {
  const id = randomUUID().replaceAll("-", "");
  const otherSubnet = ((parseInt(id.slice(4,8), 16) + 1) & 0xffff).toString(16);
  return [`2001:db8:${id.slice(0,4)}:${id.slice(4,8)}::1`, `2001:db8:${id.slice(0,4)}:${otherSubnet}::2`];
};
beforeEach(() => {
  vi.stubEnv("TRUSTED_INGRESS", "cloudflare_tunnel"); vi.stubEnv("TRUST_PROXY_CLIENT_IP", "false");
  vi.stubEnv("PUBLIC_BASE_URL", base); vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-ingress-integration-key-only");
  business.enroll.mockResolvedValue({ cardToken: `card_${"s".repeat(43)}`, programId: randomUUID() });
  business.getCard.mockResolvedValue({ balance: 1, programId: randomUUID() });
  business.recover.mockResolvedValue({ ok: true });
  business.authPost.mockImplementation(() => Response.json({ ok: true }));
  business.authGet.mockImplementation(() => Response.json({ session: null }));
});
afterEach(async () => {
  if (touched.size) await pool.query("delete from rate_limits where key_hash = any($1::text[])", [[...touched]]);
  touched.clear(); vi.clearAllMocks(); vi.unstubAllEnvs();
});
afterAll(() => pool.end());

async function hits(scope: string, identity: string) {
  const rows = await pool.query("select hits from rate_limits where key_hash=$1", [key(scope, identity)]);
  return rows.rows[0]?.hits;
}
describe("trusted ingress through application handlers (isolated PostgreSQL)", () => {
  it("persists independent peers and keeps atomic limits for the same peer", async () => {
    const [a,b] = ips().map(ip => req("/", ip));
    const scope = "test_ingress_atomic";
    key(scope, peerIdentity(a)); key(scope, peerIdentity(b));
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => enforcePeerLimit(a, scope, 2, 60)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected" && r.reason instanceof RateLimitError)).toHaveLength(2);
    await expect(enforcePeerLimit(b, scope, 2, 60)).resolves.toBeUndefined();
    expect(await hits(scope, peerIdentity(a))).toBe(4);
    expect(await hits(scope, peerIdentity(b))).toBe(1);
  });
  it("shares one /64 database bucket across concurrent host addresses", async () => {
    const addresses = ["2001:db8:1234:5678::1", "2001:db8:1234:5678::abcd", "2001:db8:1234:9999::1"];
    const [a, b, c] = addresses.map(ip => req("/", ip));
    const scope = "test_ingress_prefix";
    const keys = addresses.map(ip => key(scope, peerIdentity(req("/", ip))));
    await pool.query("delete from rate_limits where key_hash = any($1::text[])", [keys]);
    const results = await Promise.allSettled([a,b,a,b].map(request => enforcePeerLimit(request, scope, 2, 60)));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(2);
    expect(results.filter(r => r.status === "rejected" && r.reason instanceof RateLimitError)).toHaveLength(2);
    expect(await hits(scope, peerIdentity(a))).toBe(4);
    expect(await hits(scope, peerIdentity(b))).toBe(4);
    await expect(enforcePeerLimit(c, scope, 2, 60)).resolves.toBeUndefined();
    expect(await hits(scope, peerIdentity(c))).toBe(1);
  });
  it("enrollment separates peers while retaining the shared programme limit", async () => {
    const slug = `synthetic-${randomUUID()}`;
    const requests = ips().map(ip => req("/api/enroll", ip, { slug, acceptedTerms: true }));
    for (const request of requests) {
      key("enroll_peer", peerIdentity(request));
      expect((await enroll(request)).status).toBe(201);
      expect(await hits("enroll_peer", peerIdentity(request))).toBe(1);
    }
    expect(await hits("enroll_program", slug)).toBe(2);
  });
  it("sign-in, card and recovery retain peer and card/destination limits", async () => {
    const token = `synthetic-${randomUUID()}`, email = `${randomUUID()}@example.test`;
    for (const ip of ips()) {
      // The route refuses a sign-in it cannot attribute to an account, so send a well-formed one.
      const sign = req("/api/auth/sign-in/email", ip, { email, password: "synthetic-ingress-password" });
      const read = req(`/api/card/${token}`, ip);
      const recovery = req("/api/recover", ip, { email });
      for (const [scope, request] of [["auth_signin_peer", sign], ["card_read_peer", read], ["recovery_request_peer", recovery]] as const) key(scope, peerIdentity(request));
      expect((await signIn(sign)).status).toBe(200);
      expect((await card(read, { params: Promise.resolve({ token }) })).status).toBe(200);
      expect((await recover(recovery)).status).toBe(200);
      expect(await hits("auth_signin_peer", peerIdentity(sign))).toBe(1);
      expect(await hits("card_read_peer", peerIdentity(read))).toBe(1);
      expect(await hits("recovery_request_peer", peerIdentity(recovery))).toBe(1);
    }
    expect(await hits("card_read_token", token)).toBe(2);
    expect(await hits("recovery_request_destination", email)).toBe(2);
  });
  const cardRead = (ip: string, token: string, mark?: string) => {
    const request = req(`/api/card/${token}`, ip);
    if (mark) request.headers.set("x-loynara-card-read", mark);
    key("card_read_token", token); key("card_read_peer", peerIdentity(request)); key("card_poll_peer", peerIdentity(request));
    return card(request, { params: Promise.resolve({ token }) }).then(response => response.status);
  };
  it("counts the open card's timed re-reads in their own capped per-network scope, apart from page loads", async () => {
    const [ip] = ips(), peer = peerIdentity(req("/", ip)), fresh = () => `synthetic-${randomUUID()}`;
    for (let i = 0; i < 210; i++) expect(await cardRead(ip, fresh(), "poll")).toBe(200);
    expect(await cardRead(ip, fresh(), "poll")).toBe(429);
    // Polling used up its own scope and none of the one that page loads, returns, the button and the tap page share.
    expect(await hits("card_read_peer", peer)).toBeUndefined();
    for (let i = 0; i < 240; i++) expect(await cardRead(ip, fresh())).toBe(200);
    expect(await cardRead(ip, fresh())).toBe(429);
    // Any other value is an ordinary read.
    expect(await cardRead(ip, fresh(), "auto")).toBe(429);
    expect(await hits("card_read_peer", peer)).toBe(242);
    expect(await hits("card_poll_peer", peer)).toBe(211);
  });
  it("keeps one per-card limit for timed re-reads and ordinary reads together", async () => {
    const [ip] = ips(), token = `synthetic-${randomUUID()}`;
    for (let i = 0; i < 45; i++) { expect(await cardRead(ip, token, "poll")).toBe(200); expect(await cardRead(ip, token)).toBe(200); }
    expect(await cardRead(ip, token, "poll")).toBe(429);
    expect(await cardRead(ip, token)).toBe(429);
    expect(await hits("card_read_token", token)).toBe(92);
  });
  it("fails closed before business actions and keeps internal health independent", async () => {
    const responses = [await enroll(req("/api/enroll", undefined, {})), await signIn(req("/api/auth/sign-in/email", undefined, {})),
      await authGet(req("/api/auth/get-session")), await recover(req("/api/recover", undefined, {})),
      await card(req("/api/card/synthetic"), { params: Promise.resolve({ token: "synthetic" }) })];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "Service unavailable" });
    }
    for (const fn of Object.values(business)) expect(fn).not.toHaveBeenCalled();
    const response = await health();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok", database: "reachable" });
  });
});
