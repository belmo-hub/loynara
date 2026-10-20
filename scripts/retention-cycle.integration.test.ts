import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "../src/db";
import { createMerchant, enroll } from "../src/lib/product";
import { award } from "../src/lib/loyalty";
import { closeCard } from "../src/lib/card-lifecycle";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "./test-database-guard";
import { runRetentionCycle, type ErasureCandidate } from "./retention-job";
import { retentionWork } from "./retention-prune";

assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query('TRUNCATE tenants, "user", apple_devices, deletion_receipts, card_recovery_challenges, rate_limits CASCADE'); });
afterAll(() => pool.end());

// The archive half of a purge (erasure_manifest.py) is covered by erasure-manifest.test.py; this stands in for it with
// the same maintenance transaction the Python session runs: prepare, then purge, then commit.
async function purgeAsMaintenance(candidate: ErasureCandidate) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN"); await client.query("SET LOCAL ROLE loynara_maintenance");
    const prepared = (await client.query("SELECT public.loynara_prepare_erasure($1,$2,$3,$4) AS ok", [candidate.scope, candidate.tenant_id, candidate.membership_id, candidate.cutoff])).rows[0].ok;
    if (prepared) await client.query(`SELECT public.${candidate.scope === "member" ? "loynara_purge_member" : "loynara_purge_tenant"}($1,$2)`, [candidate.membership_id ?? candidate.tenant_id, candidate.cutoff]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
const overdueCards = async () => (await pool.query("SELECT overdue_cards FROM public.loynara_retention_health()")).rows[0].overdue_cards as number;

it("the scheduled cycle erases an overdue closed card, clears the overdue alert, keeps open cards and is idempotent", async () => {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic owner\',$2,false)', [userId, `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Synthetic retention", city: "Berlin", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic loyalty", programType: "stamp", rulesText: "Synthetic terms", rewardTitle: "Synthetic reward", rewardCost: 5 });
  const [closed, open] = [await enroll({ slug: merchant.programSlug, acceptedTerms: true }), await enroll({ slug: merchant.programSlug, acceptedTerms: true })];
  for (const card of [closed, open]) await award({ userId, locationId: merchant.locationId, membershipId: card.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
  await closeCard(closed.cardToken);
  await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '25 hours' WHERE id=$1", [closed.id]);
  expect(await overdueCards()).toBe(1);

  const maintenance = new Client({ connectionString: process.env.DATABASE_URL });
  await maintenance.connect();
  try {
    const erased: string[] = [];
    const work = retentionWork(maintenance, async candidate => { erased.push(candidate.membership_id!); await purgeAsMaintenance(candidate); });
    expect(await runRetentionCycle(work)).toEqual({ skipped: false, closed: 0, flagged: 0, erased: 1 });
    expect(erased).toEqual([closed.id]);
    expect((await pool.query("SELECT id FROM memberships WHERE id=$1", [closed.id])).rows).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1", [closed.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [open.id])).rows).toEqual([{ balance: 3 }]);
    expect(await overdueCards()).toBe(0);
    // A second run (the next five-minute tick) finds nothing and changes nothing.
    await maintenance.query("RESET ROLE");
    expect(await runRetentionCycle(work)).toEqual({ skipped: false, closed: 0, flagged: 0, erased: 0 });
    expect(erased).toHaveLength(1);
    // A candidate erased by an overlapping purge is a no-op, not an error.
    await purgeAsMaintenance({ scope: "member", tenant_id: merchant.tenantId, membership_id: closed.id, cutoff: new Date() });
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [open.id])).rows).toEqual([{ balance: 3 }]);
  } finally { await maintenance.end(); }
});
