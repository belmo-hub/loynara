import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, secureTags, tapRequests } from "@/db/schema";
import { nfcFixture } from "./nfc-test-db";
import { DerivedTapKeyProvider, deriveVerificationKeys, parseMaster } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import * as secureTap from "./secure-tap";
import { enforceRateLimit } from "./rate-limit";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
const master = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const now = new Date("2026-10-09T10:00:00Z");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const f = await nfcFixture();
  const uid = `04${randomBytes(6).toString("hex")}`, keyRef = randomBytes(12).toString("base64url");
  const tag = await secureTap.provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1 });
  await secureTap.activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  const pending = await secureTap.processSecureTap({ tagRef: tag.publicRef, fields: sdmFor({ uid, counter: 1, keys: deriveVerificationKeys(master, keyRef, uid) }), cardToken: f.member.cardToken, keyProvider: new DerivedTapKeyProvider(master), now });
  return { ...f, tag, requestId: pending.requestId! };
}

async function status(input: { tagRef: string; requestId: string; cardToken?: string; now?: Date }) {
  return secureTap.secureTapStatus(input);
}

describe("card-bound NFC waiting status", () => {
  it("reads a full five-minute wait without booking or moving the tag counter", async () => {
    const f = await fixture();
    for (let tick = 0; tick < 75; tick++) {
      expect(await status({ tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken, now: new Date(now.getTime() + tick * 4000) })).toMatchObject({ state: "pending_staff", requestId: f.requestId, balance: 0 });
    }
    expect(await status({ tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken, now: new Date(now.getTime() + 300_000) })).toMatchObject({ state: "expired", balance: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    expect((await db.select().from(secureTags).where(eq(secureTags.id, f.tag.id)))[0].lastCounter).toBe(1);
    expect((await db.select().from(tapRequests).where(eq(tapRequests.id, f.requestId)))[0].status).toBe("pending_staff");
  });

  it("a second tag attaching to an existing wait supplies the request tag for strictly bound polling", async () => {
    const f = await fixture();
    const uid = `04${randomBytes(6).toString("hex")}`, keyRef = randomBytes(12).toString("base64url");
    const secondTag = await secureTap.provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1 });
    await secureTap.activateSecureTag({ actorUserId: f.userId, tagId: secondTag.id });
    const attached = await secureTap.processSecureTap({ tagRef: secondTag.publicRef, fields: sdmFor({ uid, counter: 1, keys: deriveVerificationKeys(master, keyRef, uid) }), cardToken: f.member.cardToken, keyProvider: new DerivedTapKeyProvider(master), now: new Date(now.getTime() + 1000) });
    expect(attached).toMatchObject({ state: "pending_staff", requestId: f.requestId, statusRef: f.tag.publicRef });
    await expect(status({ tagRef: f.tag.publicRef, requestId: attached.requestId!, cardToken: f.member.cardToken, now })).resolves.toMatchObject({ state: "pending_staff" });
    await expect(status({ tagRef: secondTag.publicRef, requestId: attached.requestId!, cardToken: f.member.cardToken, now })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(tapRequests)).toHaveLength(1);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("denies missing, foreign, closed-card, wrong-tag and unknown-request reads", async () => {
    const f = await fixture(), other = await fixture();
    for (const input of [
      { tagRef: f.tag.publicRef, requestId: f.requestId },
      { tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: other.member.cardToken },
      { tagRef: other.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken },
      { tagRef: f.tag.publicRef, requestId: randomUUID(), cardToken: f.member.cardToken },
    ]) await expect(status(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(memberships).set({ closedAt: now }).where(eq(memberships.id, f.member.id));
    await expect(status({ tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reports confirmation and cancellation from the exact bound request without creating another award", async () => {
    const f = await fixture(), other = await fixture();
    await secureTap.confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: f.requestId, now: new Date(now.getTime() + 10_000) });
    await secureTap.cancelTapRequest({ userId: other.userId, locationId: other.location.id, requestId: other.requestId });
    const result = await status({ tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken, now: new Date(now.getTime() + 600_000) });
    expect(result).toMatchObject({ state: "confirmed", balance: 1 });
    expect(result.cardLocator).toMatch(/^K-[A-Z2-9]{6}$/);
    expect(result).not.toHaveProperty("scanCode");
    expect(result).not.toHaveProperty("cardToken");
    expect(await status({ tagRef: other.tag.publicRef, requestId: other.requestId, cardToken: other.member.cardToken, now })).toMatchObject({ state: "cancelled", balance: 0 });
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("status HTTP reads ignore an exhausted crypto peer bucket and independently limit the bound request", async () => {
    const f = await fixture();
    await expect(status({ tagRef: f.tag.publicRef, requestId: f.requestId, cardToken: f.member.cardToken, now })).resolves.toMatchObject({ state: "pending_staff" });
    const { GET } = await import("@/app/api/tap/[ref]/status/[requestId]/route");
    // Fixture time is deliberately fixed; keep the HTTP request pending at the actual server clock.
    await db.update(tapRequests).set({ expiresAt: new Date(Date.now() + 300_000) }).where(eq(tapRequests.id, f.requestId));
    for (let i = 0; i < 120; i++) await enforceRateLimit({ scope: "tap_peer", identity: "untrusted-peer", max: 120, windowSeconds: 900 });
    await expect(enforceRateLimit({ scope: "tap_peer", identity: "untrusted-peer", max: 120, windowSeconds: 900 })).rejects.toMatchObject({ code: "RATE_LIMIT" });
    const url = `http://localhost/api/tap/${f.tag.publicRef}/status/${f.requestId}`;
    const request = () => new Request(url, { headers: { Cookie: `${secureTap.tapCookieName(f.program.id)}=${f.member.cardToken}` } });
    const context = { params: Promise.resolve({ ref: f.tag.publicRef, requestId: f.requestId }) };
    for (let i = 0; i < 76; i++) {
      const response = await GET(request(), context);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toMatchObject({ state: "pending_staff", balance: 0 });
    }
    expect((await GET(new Request(url), context)).status).toBe(404);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
    // Exhaust only the status scope; the response communicates backoff.
    await pool.query("update rate_limits set hits = 10000 where hits = 76 and reset_at > now() + interval '10 minutes'");
    const limited = await GET(request(), context);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
