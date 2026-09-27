import { createHash, createHmac } from "node:crypto";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tokenPattern = /^v_[A-Za-z0-9_-]{43}$/;
const recoveryPattern = /^r_[A-Za-z0-9_-]{43}$/;

/** The worker can reconstruct a short-lived token without storing it in outbox JSON. */
export function verificationTokenForChallenge(challengeId: string): string {
  if (!uuidPattern.test(challengeId)) throw new Error("Invalid challenge ID");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-")) throw new Error("Verification secret unavailable");
  return `v_${createHmac("sha256", secret).update(`looplocal-email-verification-v1:${challengeId}`).digest("base64url")}`;
}

export function verificationTokenHash(token: string): string {
  if (!tokenPattern.test(token)) throw new Error("Invalid verification token");
  return createHash("sha256").update(token).digest("hex");
}

export function recoveryTokenForChallenge(challengeId: string): string {
  if (!uuidPattern.test(challengeId)) throw new Error("Invalid challenge ID");
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("replace-")) throw new Error("Recovery secret unavailable");
  return `r_${createHmac("sha256", secret).update(`looplocal-card-recovery-v1:${challengeId}`).digest("base64url")}`;
}

export function recoveryTokenHash(token: string): string {
  if (!recoveryPattern.test(token)) throw new Error("Invalid recovery token");
  return createHash("sha256").update(token).digest("hex");
}
