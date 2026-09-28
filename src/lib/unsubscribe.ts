import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentEvents, membershipContacts, memberships } from "@/db/schema";
import { DomainError } from "./loyalty";
import { promotionalEmailMode } from "./transactional-email";

const tokenContents = z.object({ version: z.literal(1), tenantId: z.uuid(), membershipId: z.uuid(), emailHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const invalid = () => new DomainError("INVALID_UNSUBSCRIBE", "Dieser Abmeldelink ist ungültig.");

function key() {
  const secret = process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET || process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Unsubscribe secret unavailable");
  return createHash("sha256").update("loynara-unsubscribe-v1:\0").update(secret).digest();
}

function scopedEmailHash(email: string) {
  return createHmac("sha256", key()).update(email.trim().toLowerCase()).digest("hex");
}

/** Authenticated, opaque link payload. It contains no browser-card bearer credential. */
export function createUnsubscribeToken(input: { tenantId: string; membershipId: string; email: string }) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const value = tokenContents.parse({ version: 1, tenantId: input.tenantId, membershipId: input.membershipId, emailHash: scopedEmailHash(input.email) });
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url");
}

function parseToken(token: string) {
  if (!/^[A-Za-z0-9_-]{50,500}$/.test(token)) throw invalid();
  try {
    const raw = Buffer.from(token, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return tokenContents.parse(JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")));
  } catch { throw invalid(); }
}

export async function unsubscribeMarketing(token: string) {
  const value = parseToken(token);
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships)
      .where(and(eq(memberships.tenantId, value.tenantId), eq(memberships.id, value.membershipId))).for("update").limit(1);
    if (!member || member.closedAt) return { status: "complete" as const };
    const [contact] = await tx.select({ email: membershipContacts.email }).from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, value.tenantId), eq(membershipContacts.membershipId, value.membershipId))).limit(1);
    if (!contact?.email || scopedEmailHash(contact.email) !== value.emailHash) return { status: "complete" as const };
    const [latest] = await tx.select({ granted: consentEvents.granted }).from(consentEvents)
      .where(and(eq(consentEvents.tenantId, value.tenantId), eq(consentEvents.membershipId, value.membershipId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
      .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
    if (latest?.granted !== false) await tx.insert(consentEvents).values({ tenantId: value.tenantId, membershipId: value.membershipId, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "email_unsubscribe" });
    return { status: "complete" as const };
  });
}

export function unsubscribeUrl(input: { tenantId: string; membershipId: string; email: string }) {
  const base = new URL((promotionalEmailMode() === "mailgun_eu" ? process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN : process.env.PUBLIC_BASE_URL) ?? "");
  const url = new URL("/unsubscribe", base);
  url.hash = `token=${createUnsubscribeToken(input)}`;
  return url.toString();
}
