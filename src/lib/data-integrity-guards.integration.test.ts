import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db, pool } from "@/db";
import { locations, memberships, programs, rewards, rewardVersions, staffRoles, tenants } from "@/db/schema";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

// The application already writes only valid rows. These checks are about the database itself refusing invalid ones,
// whatever writes them: an import, a maintenance query or a future bug.
assertLocalTestDatabaseUrl();
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic bakery", slug: `guards-${userId}` }).returning();
  const [location] = await db.insert(locations).values({ tenantId: tenant.id, name: "Counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "owner" });
  const [program] = await db.insert(programs).values({ tenantId: tenant.id, locationId: location.id, slug: `guards-${randomUUID()}`, name: "Stamp card", type: "stamp", rulesText: "One stamp per visit" }).returning();
  const [member] = await db.insert(memberships).values({ tenantId: tenant.id, programId: program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  const [reward] = await db.insert(rewards).values({ tenantId: tenant.id, programId: program.id }).returning();
  const [version] = await db.insert(rewardVersions).values({ tenantId: tenant.id, rewardId: reward.id, version: 1, title: "Coffee", cost: 5 }).returning();
  const ledger = (kind: string, delta: number, reversalOfId: string | null = null) => pool.query<{ id: string }>(
    `INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id)
     VALUES ($1, $2, $3, $4, $5, 'staff_online', $6, $7, $8, $9) RETURNING id`,
    [tenant.id, location.id, member.id, delta, kind, userId, randomUUID(), `guard-${randomUUID()}`, reversalOfId]);
  return { userId, tenant, location, program, member, version, ledger };
}

describe("database guards on loyalty history", () => {
  it("refuses ledger rows whose sign or reversal link contradicts their kind", async () => {
    const f = await fixture();
    const award = (await f.ledger("award", 3)).rows[0];
    await expect(f.ledger("award", -7)).rejects.toThrow(/ledger_kind_sign_valid/);
    await expect(f.ledger("redeem", 5)).rejects.toThrow(/ledger_kind_sign_valid/);
    await expect(f.ledger("award", 2, award.id)).rejects.toThrow(/ledger_reversal_link_valid/);
    await expect(f.ledger("reversal", -3)).rejects.toThrow(/ledger_reversal_link_valid/);
    await expect(f.ledger("reversal", -3, award.id)).resolves.toBeTruthy();
  });

  it("keeps reward versions and redemptions append-only, with a positive cost", async () => {
    const f = await fixture();
    await expect(pool.query("UPDATE reward_versions SET title = 'Cake', cost = 1 WHERE id = $1", [f.version.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM reward_versions WHERE id = $1", [f.version.id])).rejects.toThrow(/append-only/);
    const debit = (await f.ledger("redeem", -5)).rows[0];
    const redemption = (values: { cost: number }) => pool.query(
      "INSERT INTO redemptions (tenant_id, membership_id, ledger_entry_id, reward_version_id, reward_title, cost) VALUES ($1, $2, $3, $4, 'Coffee', $5)",
      [f.tenant.id, f.member.id, debit.id, f.version.id, values.cost]);
    await expect(redemption({ cost: -999 })).rejects.toThrow(/redemption_cost_positive/);
    await redemption({ cost: 5 });
    await expect(pool.query("UPDATE redemptions SET cost = 1 WHERE ledger_entry_id = $1", [debit.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM redemptions WHERE ledger_entry_id = $1", [debit.id])).rejects.toThrow(/append-only/);
  });

  it("refuses half-set coordinates and an inactivity automation without its day count", async () => {
    const f = await fixture();
    await expect(pool.query("UPDATE locations SET latitude = 51, longitude = NULL WHERE id = $1", [f.location.id])).rejects.toThrow(/location_coordinates_valid/);
    await expect(pool.query("UPDATE locations SET latitude = NULL, longitude = 9 WHERE id = $1", [f.location.id])).rejects.toThrow(/location_coordinates_valid/);
    await pool.query("UPDATE locations SET latitude = 51.3, longitude = 9.5 WHERE id = $1", [f.location.id]);
    const rule = (days: number | null) => pool.query(
      "INSERT INTO automation_rules (tenant_id, program_id, created_by_user_id, trigger_kind, subject, body, inactivity_days) VALUES ($1, $2, $3, 'inactive', 'We miss you', 'Come back', $4)",
      [f.tenant.id, f.program.id, f.userId, days]);
    await expect(rule(null)).rejects.toThrow(/automation_rule_inactivity_valid/);
    await rule(30);
  });

  it("dates a consent event when it is written, not when its transaction began", async () => {
    const f = await fixture();
    const client = await pool.connect();
    try {
      // A transaction that waited (for the card lock, say) before writing must not sort before rows committed meanwhile.
      await client.query("BEGIN");
      await client.query("SELECT pg_sleep(0.05)");
      const { rows: [row] } = await client.query<{ late: boolean }>(
        "INSERT INTO consent_events (tenant_id, membership_id, channel, purpose, granted, notice_version, source) VALUES ($1, $2, 'email', 'marketing', false, '2026-09', 'email_unsubscribe') RETURNING created_at > now() + interval '40 milliseconds' AS late",
        [f.tenant.id, f.member.id]);
      expect(row.late).toBe(true);
    } finally { await client.query("ROLLBACK"); client.release(); }
  });
});
