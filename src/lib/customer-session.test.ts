import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tapCardToken, tapCookieHeader } from "./secure-tap";
const program = "11111111-1111-4111-8111-111111111111";
const token = `card_${"A".repeat(43)}`;
const request = (pair: string) => new Request("https://example.test/api/tap/test", { headers: { cookie: pair } });
beforeEach(() => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-customer-session-key-at-least-32");
  vi.stubEnv("PUBLIC_BASE_URL", "https://example.test");
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it("enforces the remembered device's 90-day expiry on the server even if a client replays the cookie", () => {
  const now = Date.now();
  const pair = tapCookieHeader(program, token, "https://example.test").split(";")[0];
  expect(tapCardToken(request(pair), program)).toBe(token);
  vi.spyOn(Date, "now").mockReturnValue(now + 91 * 86400_000);
  expect(tapCardToken(request(pair), program)).toBeUndefined();
});
it("binds the credential to the programme and rejects modified cookies", () => {
  const header = tapCookieHeader(program, token, "https://example.test");
  expect(header).toContain("; Secure"); expect(header).toContain("; HttpOnly");
  expect(header).toContain("Max-Age=7776000");
  const pair = header.split(";")[0];
  expect(tapCardToken(request(pair.replace(/.$/, "!")), program)).toBeUndefined();
  expect(tapCardToken(request(pair.replace(program.replaceAll("-", ""), "22222222222242228222222222222222")), "22222222-2222-4222-8222-222222222222")).toBeUndefined();
});

it("preserves a current legacy card credential only during the fixed migration window", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-09T12:00:00Z"));
  const pair = `loynara_member_${program.replaceAll("-", "")}=${token}`;
  expect(tapCardToken(request(pair), program)).toBe(token);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2027-01-07T00:00:00Z"));
  expect(tapCardToken(request(pair), program)).toBeUndefined();
});
