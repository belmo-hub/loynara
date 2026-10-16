import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, locations, memberships, offlineAwardEvents, programs, staffRoles, tenants } from "@/db/schema";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";
import { respondError } from "./http";
import { award, DomainError } from "./loyalty";
import { prepareOfflineAward, syncOfflineAward } from "./offline-earning";

// Bookings wait for an owner's programme save (they share the programme row, the save locks it for update). A save that
// takes long must not stall the counter: a booking gives up after a short wait, books nothing and lets go of the card.
assertLocalTestDatabaseUrl();
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic cashier", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic bakery", slug: `busy-${userId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "cashier", locationId: location.id });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `busy-${randomUUID()}`, name: "Stamp card", type: "stamp", rulesText: "One stamp per visit" }).returning();
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  return { userId, location, program, member };
}

/** Holds the programme row the way a slow owner save does, for the duration of `work`. */
async function whileProgrammeLocked<T>(programId: string, work: () => Promise<T>): Promise<T> {
  const owner = await pool.connect();
  try {
    await owner.query("BEGIN");
    await owner.query("SELECT id FROM programs WHERE id = $1 FOR UPDATE", [programId]);
    return await work();
  } finally { await owner.query("ROLLBACK"); owner.release(); }
}

describe("a checkout during a slow programme save", () => {
  it("gives up after a short wait, books nothing and releases the card", async () => {
    const f = await fixture();
    const started = Date.now();
    const result = await whileProgrammeLocked(f.program.id, () => award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }).then(value => ({ value }), error => ({ error })));
    expect(result).toMatchObject({ error: { code: "PROGRAMME_BUSY" } });
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id))).toEqual([]);
    // The card is free again at once.
    await expect(pool.query("BEGIN; SELECT id FROM memberships WHERE id = '" + f.member.id + "' FOR UPDATE NOWAIT; ROLLBACK;")).resolves.toBeTruthy();
    const response = respondError((result as { error: DomainError }).error);
    expect(response.status).toBe(409);
  });

  it("leaves an offline award pending for the next sync instead of recording it as rejected", async () => {
    const f = await fixture();
    const deviceId = randomUUID();
    const lease = await prepareOfflineAward({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, deviceId });
    const event = { userId: f.userId, leaseId: lease.leaseId, deviceId, eventId: randomUUID(), eventAt: new Date(), award: { quantity: 1 } };
    await expect(whileProgrammeLocked(f.program.id, () => syncOfflineAward(event))).rejects.toMatchObject({ code: "PROGRAMME_BUSY" });
    expect(await db.select().from(offlineAwardEvents)).toEqual([]);
    expect(await syncOfflineAward(event)).toMatchObject({ status: "accepted", balance: 1 });
  });
});
