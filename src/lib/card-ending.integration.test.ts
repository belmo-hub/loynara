import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { capLevelUntil, createMerchant, enroll, getCard } from "./product";

// A confirmed programme end caps what the card shows (Head of Product, 24 Oct 2026): nothing dated after the last day.

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

const NOV_10 = new Date("2026-11-10T10:00:00Z");

async function shop() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const m = await createMerchant({ userId: owner, businessName: "Synthetic Barber", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", rulesText: "Ein Punkt pro Euro.", rewardTitle: "Bartpflege", rewardCost: 500 });
  // Levels from the first visit, a monthly challenge, and points expiry after 24 months.
  await pool.query(`UPDATE programs SET levels_enabled = true, level_silver_visits = 3, level_gold_visits = 5, challenge_visits = 3, challenge_bonus = 20,
    points_expiry_months = 24, points_expiry_since = '2024-01-01T00:00:00Z' WHERE id = $1`, [m.programId]);
  const card = await enroll({ slug: m.programSlug, acceptedTerms: true });
  const book = (delta: number, at: Date | string) => pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
    VALUES ($1,$2,$3,$4,'award','staff_online',$5,$6,$7,$8)`, [m.tenantId, m.locationId, card.id, delta, owner, randomUUID(), randomUUID(), at]);
  await book(40, "2024-11-24T10:00:00Z");  // expires 24.11.2026
  await book(50, "2024-12-24T10:00:00Z");  // expires 24.12.2026
  await book(1, new Date());               // today's visit: Bronze until about 90 days from now
  await pool.query("UPDATE memberships SET balance = 91 WHERE id = $1", [card.id]);
  const end = (date: string, confirmed = true) => pool.query("UPDATE programs SET cancellation_end_date = $2, cancellation_confirmed_at = $3, cancellation_requested_at = now() WHERE id = $1", [m.programId, date, confirmed ? new Date() : null]);
  return { token: card.cardToken, end };
}

describe("a card whose programme has a confirmed end date", () => {
  it("before the operator confirms, nothing changes: no end date, and every later date still shows", async () => {
    const s = await shop();
    await s.end("2026-11-30", false);
    const card = await getCard(s.token, NOV_10);
    expect(card.endsOn).toBeUndefined();
    expect(card.challenge).toBeDefined();
    // Today's point expires in two years; it shows too.
    expect(card.pointsExpiry?.batches.slice(0, 2)).toEqual(["40 Punkte am 24.11.2026", "50 Punkte am 24.12.2026"]);
    expect(card.pointsExpiry?.batches).toHaveLength(3);
    expect(Number(card.level?.until?.slice(6))).toBeGreaterThanOrEqual(2027);
  });

  it("shows the end date, hides expiry batches after it, and caps the level's date at it", async () => {
    const s = await shop();
    await s.end("2026-11-30");
    const card = await getCard(s.token, NOV_10);
    expect(card.endsOn).toBe("2026-11-30");
    expect(card.pointsExpiry?.batches).toEqual(["40 Punkte am 24.11.2026"]);
    expect(card.pointsExpiry?.notice).toBe("Deine 40 Punkte verfallen am 24.11.2026.");
    expect(card.level?.until).toBe("30.11.2026");
  });

  it("month boundary: a challenge shows when its month ends on the end date, not when the programme ends earlier in the month", async () => {
    const s = await shop();
    await s.end("2026-11-30");
    expect((await getCard(s.token, NOV_10)).challenge).toBeDefined();
    await s.end("2026-11-29");
    expect((await getCard(s.token, NOV_10)).challenge).toBeUndefined();
  });

  it("drops the expiry notice when its batch falls after the end", async () => {
    const s = await shop();
    await s.end("2026-11-20");
    const card = await getCard(s.token, NOV_10);
    expect(card.pointsExpiry?.batches).toEqual([]);
    expect(card.pointsExpiry?.notice).toBeUndefined();
    expect(card.pointsExpiry?.rule).toBeDefined();
  });
});

describe("capLevelUntil", () => {
  it("keeps a date on or before the end, caps a later one, and leaves cards without an end alone", () => {
    expect(capLevelUntil({ until: "30.11.2026" }, "2026-11-30")).toEqual({ until: "30.11.2026" });
    expect(capLevelUntil({ until: "01.12.2026" }, "2026-11-30")).toEqual({ until: "30.11.2026" });
    expect(capLevelUntil({ until: "15.01.2027" }, undefined)).toEqual({ until: "15.01.2027" });
    expect(capLevelUntil(undefined, "2026-11-30")).toBeUndefined();
  });
});
