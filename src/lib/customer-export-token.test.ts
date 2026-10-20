import { afterEach, expect, it, vi } from "vitest";
import { exportBinding, exportProofHash, exportProofToken } from "./customer-export-token";
import { verificationTokenForChallenge } from "./contact-token";
afterEach(() => vi.unstubAllEnvs());
it("separates fresh export proof from verification, card binding and address binding without storing credentials", () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-export-proof-secret-at-least-32-characters");
  const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const token = exportProofToken(id);
  expect(token).toMatch(/^e_[A-Za-z0-9_-]{43}$/);
  expect(token.slice(2)).not.toBe(verificationTokenForChallenge(id).slice(2));
  expect(exportProofHash(token)).toMatch(/^[a-f0-9]{64}$/);
  expect(exportBinding("email", "shared@example.test")).not.toBe(exportBinding("card", "shared@example.test"));
  expect(exportBinding("email", " SHARED@example.test ")).toBe(exportBinding("email", "shared@example.test"));
  expect(() => exportProofHash(verificationTokenForChallenge(id))).toThrow();
  expect(() => exportProofToken("invalid")).toThrow();
});
it("refuses proof generation without a safe runtime secret", () => {
  vi.stubEnv("BETTER_AUTH_SECRET", "");
  expect(() => exportProofToken("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow();
});
