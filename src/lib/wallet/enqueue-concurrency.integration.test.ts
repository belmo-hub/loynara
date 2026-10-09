import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { createMerchant, enroll } from "@/lib/product";
import { claimOutboxJob } from "@/lib/outbox";
import { enqueueWalletProgramRefresh, enqueueWalletRefresh } from "./enqueue";
import { credentialHash } from "./data";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Queue fixture", `${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Queue Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  // A pre-existing Google projection isolates enqueue behavior from issuance setup.
  await pool.query("INSERT INTO wallet_passes (tenant_id,membership_id,provider,provider_object_id,credential_hash,status) VALUES ($1,$2,'google',$3,$4,'created')", [merchant.tenantId, member.id, `3388000000023201754.historical_${randomUUID()}`, credentialHash(member.scanCode)]);
  return { merchant, member };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

/** The second insert either finishes without uniqueness (the defect) or waits for the uncommitted conflicting row. */
async function settledOrQueueLocked(operation: Promise<unknown>) {
  let settled = false;
  operation.finally(() => { settled = true; }).catch(() => {});
  const deadline = Date.now() + 5000;
  while (!settled) {
    const result = await pool.query<{ waiting: boolean }>("SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND cardinality(pg_blocking_pids(pid)) > 0 AND query ILIKE '%outbox_jobs%') AS waiting");
    if (result.rows[0].waiting) return;
    if (Date.now() >= deadline) throw new Error("Concurrent Wallet enqueue neither completed nor waited for its conflicting job");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  await operation;
}

const pending = async (tenantId: string, membershipId: string) => pool.query<{ count: number }>("SELECT count(*)::int AS count FROM outbox_jobs WHERE tenant_id = $1 AND kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'membershipId' = $2", [tenantId, membershipId]).then(result => result.rows[0].count);

describe("Wallet pending refresh coalescing under independent transactions", () => {
  it("retains a covering job discovered through an uncommitted insert conflict until the waiting change commits", async () => {
    const { merchant, member } = await fixture();
    const inserted = deferred();
    const releaseFirst = deferred();
    const first = db.transaction(async tx => {
      await enqueueWalletProgramRefresh(tx, merchant.tenantId, merchant.programId);
      inserted.resolve();
      await releaseFirst.promise;
    });
    await inserted.promise;
    const queued = deferred();
    const releaseSecond = deferred();
    const second = db.transaction(async tx => {
      await tx.execute(sql`UPDATE memberships SET balance = 2 WHERE id = ${member.id}::uuid`);
      await enqueueWalletRefresh(tx, merchant.tenantId, member.id);
      queued.resolve();
      await releaseSecond.promise;
    });
    try { await settledOrQueueLocked(second); } finally { releaseFirst.resolve(); }
    await first;
    await queued.promise;
    try {
      expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toBeNull();
    } finally { releaseSecond.resolve(); await second; }
    expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toMatchObject({ payload: { membershipId: member.id } });
  });

  for (const kind of ["membership", "programme"] as const) {
    it(`keeps the covering pending job unclaimable until its ${kind} change commits`, async () => {
      const { merchant, member } = await fixture();
      await db.transaction(tx => enqueueWalletRefresh(tx, merchant.tenantId, member.id));
      const queued = deferred();
      const release = deferred();
      const changing = db.transaction(async tx => {
        await tx.execute(sql`UPDATE memberships SET balance = 2 WHERE id = ${member.id}::uuid`);
        if (kind === "membership") await enqueueWalletRefresh(tx, merchant.tenantId, member.id);
        else await enqueueWalletProgramRefresh(tx, merchant.tenantId, merchant.programId);
        queued.resolve();
        await release.promise;
      });
      await queued.promise;
      try {
        // Otherwise a worker can refresh the old balance and finish before the new balance becomes visible.
        expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toBeNull();
      } finally { release.resolve(); await changing; }
      expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toMatchObject({ payload: { membershipId: member.id } });
      expect((await pool.query("SELECT balance FROM memberships WHERE id = $1", [member.id])).rows[0].balance).toBe(2);
    });
  }

  for (const firstKind of ["membership", "programme"] as const) {
    it(`coalesces a concurrent ${firstKind} refresh and programme refresh into one pending job`, async () => {
      const { merchant, member } = await fixture();
      const inserted = deferred();
      const release = deferred();
      const first = db.transaction(async tx => {
        if (firstKind === "membership") await enqueueWalletRefresh(tx, merchant.tenantId, member.id);
        else await enqueueWalletProgramRefresh(tx, merchant.tenantId, merchant.programId);
        inserted.resolve();
        await release.promise;
      });
      await inserted.promise;
      const second = db.transaction(tx => enqueueWalletProgramRefresh(tx, merchant.tenantId, merchant.programId));
      try { await settledOrQueueLocked(second); } finally { release.resolve(); }
      await Promise.all([first, second]);
      expect(await pending(merchant.tenantId, member.id)).toBe(1);
    });
  }

  it("replaying both enqueue paths is idempotent; a claimed job permits a fresh change", async () => {
    const { merchant, member } = await fixture();
    for (let repeat = 0; repeat < 2; repeat++) {
      await db.transaction(async tx => {
        await enqueueWalletRefresh(tx, merchant.tenantId, member.id);
        await enqueueWalletProgramRefresh(tx, merchant.tenantId, merchant.programId);
      });
    }
    expect(await pending(merchant.tenantId, member.id)).toBe(1);
    await pool.query("UPDATE outbox_jobs SET status = 'processing' WHERE tenant_id = $1 AND kind = 'wallet.refresh'", [merchant.tenantId]);
    await db.transaction(tx => enqueueWalletRefresh(tx, merchant.tenantId, member.id));
    expect(await pending(merchant.tenantId, member.id)).toBe(1);
  });

  for (const kind of ["membership", "programme"] as const) {
  it(`a pending row belonging to another tenant cannot suppress this card's ${kind} refresh`, async () => {
    const first = await fixture();
    const other = await fixture();
    // Outbox payloads have no membership foreign key; tenant scoping must also constrain the coalescing lookup.
    await pool.query("INSERT INTO outbox_jobs (tenant_id, kind, payload) VALUES ($1, 'wallet.refresh', jsonb_build_object('membershipId', $2::text))", [other.merchant.tenantId, first.member.id]);
    await db.transaction(tx => kind === "membership"
      ? enqueueWalletRefresh(tx, first.merchant.tenantId, first.member.id)
      : enqueueWalletProgramRefresh(tx, first.merchant.tenantId, first.merchant.programId));
    expect(await pending(first.merchant.tenantId, first.member.id)).toBe(1);
    await db.transaction(tx => enqueueWalletProgramRefresh(tx, other.merchant.tenantId, first.merchant.programId));
    expect(await pending(other.merchant.tenantId, other.member.id)).toBe(0);
    await db.transaction(tx => enqueueWalletRefresh(tx, other.merchant.tenantId, first.member.id));
    expect(await pending(other.merchant.tenantId, first.member.id)).toBe(1); // only the deliberately inserted row
  });
  }
});
