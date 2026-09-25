import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { verificationTokenForChallenge, verificationTokenHash } from "./contact-token";

const previous = process.env.BETTER_AUTH_SECRET;
afterEach(() => { if (previous === undefined) delete process.env.BETTER_AUTH_SECRET; else process.env.BETTER_AUTH_SECRET = previous; });

describe("contact verification token", () => {
  it("derives a stable, challenge-specific token and stores only its hash", () => {
    process.env.BETTER_AUTH_SECRET = "synthetic-test-secret-with-at-least-32-characters";
    const id = randomUUID();
    const token = verificationTokenForChallenge(id);
    expect(token).toMatch(/^v_[A-Za-z0-9_-]{43}$/);
    expect(verificationTokenForChallenge(id)).toBe(token);
    expect(verificationTokenForChallenge(randomUUID())).not.toBe(token);
    expect(verificationTokenHash(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(verificationTokenHash(token)).not.toContain(token);
  });

  it("rejects weak secrets and malformed tokens", () => {
    process.env.BETTER_AUTH_SECRET = "replace-with-at-least-32-random-characters";
    expect(() => verificationTokenForChallenge(randomUUID())).toThrow();
    process.env.BETTER_AUTH_SECRET = "synthetic-test-secret-with-at-least-32-characters";
    expect(() => verificationTokenForChallenge("not-a-uuid")).toThrow();
    expect(() => verificationTokenHash("short")).toThrow();
  });
});
