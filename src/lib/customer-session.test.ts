import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { tapCardToken, tapCookieHeader } from "./secure-tap";
import { issueCustomerSession, readCustomerSession } from "./customer-session";
import { createHmac } from "node:crypto";
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


it.each([[1, true], [30, true], [60, true], [85, true], [95, false]])("fixed policy recognizes day %s: %s, regardless of recorded stamps", (day, recognized) => {
  const started = Date.parse("2026-10-09T12:00:00Z");
  const clock = vi.spyOn(Date, "now").mockReturnValue(started);
  const pair = tapCookieHeader(program, token, "https://example.test").split(";")[0];
  clock.mockReturnValue(started + Number(day) * 86400_000);
  expect(Boolean(tapCardToken(request(pair), program))).toBe(recognized);
});

// These boundaries catch resetting authentication time or ignoring the activity time.
it("allows activity renewal beyond day 90 but rejects exactly 90 inactive days", () => {
  const start = 1791547200;
  const clock = vi.spyOn(Date, "now").mockReturnValue((start + 80 * 86400) * 1000);
  const value = issueCustomerSession(program, token, false, start, start + 80 * 86400);
  clock.mockReturnValue((start + 150 * 86400) * 1000);
  expect(readCustomerSession(value, program)?.token).toBe(token);
  clock.mockReturnValue((start + 170 * 86400) * 1000 - 1000);
  expect(readCustomerSession(value, program)?.token).toBe(token);
  clock.mockReturnValue((start + 170 * 86400) * 1000);
  expect(readCustomerSession(value, program)).toBeUndefined();
});
it("enforces the absolute day-365 boundary despite recent activity", () => {
  const start = 1791547200;
  const clock = vi.spyOn(Date, "now").mockReturnValue((start + 350 * 86400) * 1000);
  const value = issueCustomerSession(program, token, true, start, start + 350 * 86400);
  clock.mockReturnValue((start + 365 * 86400) * 1000 - 1000);
  expect(readCustomerSession(value, program)?.shared).toBe(true);
  clock.mockReturnValue((start + 365 * 86400) * 1000);
  expect(readCustomerSession(value, program)).toBeUndefined();
});
it("preserves a v1 credential's original issuance and fixed deadline during compatibility", () => {
  const issued = 1791547200;
  const payload = Buffer.from(JSON.stringify({token,issued,shared:true})).toString("base64url");
  const signature = createHmac("sha256", "synthetic-customer-session-key-at-least-32").update("loynara-customer-session-v1\0").update(program).update("\0").update(payload).digest("base64url");
  const clock = vi.spyOn(Date,"now").mockReturnValue((issued+89*86400)*1000);
  expect(readCustomerSession(`v1.${payload}.${signature}`,program)).toMatchObject({token,issued,active:issued,shared:true});
  clock.mockReturnValue((issued+90*86400)*1000);
  expect(readCustomerSession(`v1.${payload}.${signature}`,program)).toBeUndefined();
});
it("refuses future or backwards activity and refuses automatic issuance beyond absolute lifetime", () => {
  const now = 1791547200;
  vi.spyOn(Date,"now").mockReturnValue(now*1000);
  expect(()=>issueCustomerSession(program,token,false,now,now+1)).toThrow();
  expect(()=>issueCustomerSession(program,token,false,now,now-1)).toThrow();
  expect(()=>issueCustomerSession(program,token,false,now-365*86400,now)).toThrow();
});
