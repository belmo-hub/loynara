import { afterEach, expect, it, vi } from "vitest";
import { getIP } from "@better-auth/core/utils/ip";

// Inspect the actual options passed by the app without opening an auth DB pool.
vi.mock("pg", () => ({ Pool: class {} }));
vi.mock("better-auth", () => ({ betterAuth: (options: object) => ({ options }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
it("the auth library uses only the explicitly selected Cloudflare source", async () => {
  vi.stubEnv("TRUSTED_INGRESS", "cloudflare_tunnel");
  const { auth } = await import("./auth");
  const headers = new Headers({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2", "x-real-ip": "192.0.2.3" });
  expect(getIP(headers, auth.options)).toBe("192.0.2.1");
});
it("the auth library does not trust visitor headers in local mode", async () => {
  vi.stubEnv("TRUSTED_INGRESS", "local");
  const { auth } = await import("./auth");
  expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([]);
  const headers = new Headers({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.2" });
  expect(getIP(headers, auth.options)).not.toBe("192.0.2.1");
  expect(getIP(headers, auth.options)).not.toBe("192.0.2.2");
});

it("keeps synthetic production-style previews on the shared no-trusted-IP fallback", async () => {
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("TRUSTED_INGRESS", "local");
  const { auth } = await import("./auth");
  const a = new Headers({ "cf-connecting-ip": "192.0.2.1", "x-forwarded-for": "192.0.2.1" });
  const b = new Headers({ "cf-connecting-ip": "192.0.2.2", "x-forwarded-for": "192.0.2.2" });
  expect(auth.options.advanced?.ipAddress?.ipAddressHeaders).toEqual([]);
  // Test runtimes may return the library's localhost fallback; production returns
  // null and its limiter uses one per-path bucket. Neither trusts these headers.
  expect(getIP(a, auth.options)).toBe(getIP(b, auth.options));
});
