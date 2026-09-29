import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { peerIdentity } from "./rate-limit";

const request = (ip?: string, extra: Record<string, string> = {}) => new Request("https://app.example.test/api/enroll", {
  headers: { ...(ip === undefined ? {} : { "cf-connecting-ip": ip }), ...extra },
});
beforeEach(() => {
  vi.stubEnv("TRUSTED_INGRESS", "cloudflare_tunnel");
  vi.stubEnv("TRUST_PROXY_CLIENT_IP", "false");
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-peer-test-key-only-32-characters");
});
afterEach(() => vi.unstubAllEnvs());

describe("explicit trusted ingress identity", () => {
  it("gives two valid visitors independent stable opaque identities", () => {
    const first = peerIdentity(request("192.0.2.1"));
    expect(first).not.toBe(peerIdentity(request("192.0.2.2")));
    expect(first).toBe(peerIdentity(request("192.0.2.1")));
    expect(first).toMatch(/^peer:[a-f0-9]{64}$/);
    expect(first).not.toContain("192.0.2.1");
  });
  it("ignores forwarded-for and real-ip when the trusted address exists", () => {
    expect(peerIdentity(request("192.0.2.1", { "x-forwarded-for": "192.0.2.99", "x-real-ip": "192.0.2.98" })))
      .toBe(peerIdentity(request("192.0.2.1")));
  });
  it.each([undefined, "", "invalid", "192.0.2.1,192.0.2.2", "192.0.2.1:443", "192.000.002.001", "[2001:db8::1]", "fe80::1%eth0"])("rejects missing/malformed trusted metadata (%s)", ip => {
    expect(() => peerIdentity(request(ip, { "x-forwarded-for": "192.0.2.1" }))).toThrow("Invalid ingress metadata");
  });
  it("normalizes IPv6 spelling and IPv4-mapped IPv6", () => {
    expect(peerIdentity(request("2001:0DB8:0000:0:0:0:0:1"))).toBe(peerIdentity(request("2001:db8::1")));
    expect(peerIdentity(request("::ffff:192.0.2.1"))).toBe(peerIdentity(request("192.0.2.1")));
    expect(peerIdentity(request("::ffff:c000:201"))).toBe(peerIdentity(request("192.0.2.1")));
  });
  it("does not trust any visitor header in local mode", () => {
    vi.stubEnv("TRUSTED_INGRESS", "local");
    expect(peerIdentity(request("192.0.2.1"))).toBe("untrusted-peer");
    expect(peerIdentity(request("192.0.2.2"))).toBe("untrusted-peer");
  });
  it.each(["true", "cloudflare", " cloudflare_tunnel", "CLOUDFLARE_TUNNEL"])("rejects unsupported ingress mode %s", mode => {
    vi.stubEnv("TRUSTED_INGRESS", mode);
    expect(() => peerIdentity(request("192.0.2.1"))).toThrow("Invalid ingress metadata");
  });
  it("refuses local fallback in the declared production environment", () => {
    vi.stubEnv("TRUSTED_INGRESS", "");
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect(() => peerIdentity(request("192.0.2.1"))).toThrow("Invalid ingress metadata");
  });
  it("rejects the old generic proxy-trust switch", () => {
    vi.stubEnv("TRUST_PROXY_CLIENT_IP", "true");
    expect(() => peerIdentity(request("192.0.2.1"))).toThrow("Invalid ingress metadata");
  });
});
