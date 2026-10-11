/** Synthetic fixture/probe for production-encrypted-backup.test.py; never a production seed. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "../src/db";
import { createMerchant, enroll, getCard } from "../src/lib/product";
import { award, redeem } from "../src/lib/loyalty";

async function main() {
  const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(target.hostname, "127.0.0.1");
  assert.equal(target.port, "55433");
  assert.match(target.pathname, /^\/loynara_(?:backup|restore)_108_[a-f0-9]+$/);
  assert.equal((await pool.query("SHOW data_directory")).rows[0].data_directory, "/private/tmp/loynara-goal-133-pg");
  if (process.argv[2] === "seed") {
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n, 0);
    await pool.query(readFileSync("drizzle/auth.sql", "utf8"));
    await migrate(db, { migrationsFolder: "drizzle" });
    for (let index = 0; index < 2; index++) {
      const userId = randomUUID();
      await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic recovery owner", `${userId}@example.test`]);
      const merchant = await createMerchant({ userId, businessName: `Recovery merchant ${index}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `Recovery programme ${index}`, programType: "points", earningMode: "manual", rulesText: "Synthetic local recovery accounting", rewardTitle: "Recovery reward", rewardCost: 3 });
      const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: `synthetic-customer-${index}@example.test` });
      await award({ userId, locationId: merchant.locationId, membershipId: member.id, quantity: 5, idempotencyKey: `recovery-award-${index}`, requestId: randomUUID(), source: "synthetic_seed" });
      const rewardVersionId = (await pool.query("SELECT id FROM reward_versions WHERE tenant_id=$1", [merchant.tenantId])).rows[0].id;
      await redeem({ userId, locationId: merchant.locationId, membershipId: member.id, rewardVersionId, idempotencyKey: `recovery-redeem-${index}`, requestId: randomUUID() });
      // Historical synthetic provider projection/job state: no provider issuance or worker dispatch.
      await pool.query("INSERT INTO wallet_passes (tenant_id,membership_id,provider,provider_object_id,status) VALUES ($1,$2,'google',$3,'active')", [merchant.tenantId, member.id, `synthetic-recovery-${index}`]);
      await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload,status,attempts,claim_token,next_attempt_at) VALUES ($1,'wallet.refresh',$2,'processing',1,$3,now()+interval '1 hour')", [merchant.tenantId, JSON.stringify({ membershipId: member.id }), randomUUID()]);
    }
  } else assert.equal(process.argv[2], "probe");
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n, 25);
  const rows = (await pool.query("SELECT card_token,balance FROM memberships ORDER BY id")).rows;
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.balance, 2);
    assert.equal((await getCard(row.card_token)).balance, 2);
  }
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM memberships m WHERE balance <> coalesce((SELECT sum(delta) FROM ledger_entries l WHERE l.membership_id=m.id AND l.tenant_id=m.tenant_id),0)")).rows[0].n, 0);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM wallet_passes WHERE status='active' AND provider_object_id LIKE 'synthetic-recovery-%'")).rows[0].n, 2);
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE status='processing' AND attempts=1 AND claim_token IS NOT NULL")).rows[0].n, 2);
  console.log("Synthetic application recovery probe PASS: 2 tenants/cards, balances/ledger/rewards/Wallet identities/claim tokens, 25 migrations");
}
void main().finally(() => pool.end());
