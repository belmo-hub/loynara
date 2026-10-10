import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { membershipContacts, outboxJobs, walletPasses } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { getCustomerExport } from "./export";
import { award } from "./loyalty";
import { nfcFixture } from "./nfc-test-db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE tenants, "user", apple_devices CASCADE'); });
afterAll(() => pool.end());

async function snapshot(tenantId: string) {
  const tables = ["memberships", "membership_contacts", "consent_events", "ledger_entries", "outbox_jobs", "wallet_passes"];
  return Promise.all(tables.map(table => pool.query(`SELECT * FROM ${table} AS t WHERE tenant_id=$1 ORDER BY to_jsonb(t)::text`, [tenantId]).then(result => result.rows)));
}

function failActualQuery(matches: (text: string) => boolean) {
  const original = Client.prototype.query;
  const observed: { client?: Client; rollback: boolean } = { rollback: false };
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!observed.client && text && matches(text)) {
      observed.client = this;
      // PostgreSQL itself aborts the actual transaction; no fabricated query rows/errors.
      return Reflect.apply(original, this, ["select 1 / 0"]);
    }
    if (this === observed.client && text?.toLowerCase() === "rollback") observed.rollback = true;
    return Reflect.apply(original, this, args);
  }) as typeof original);
  return { observed, spy };
}

it("rolls back contact erasure, queue suppression and Wallet revocation if final identifier retirement fails, then safely retries", async () => {
  const f = await nfcFixture(); const foreign = await nfcFixture();
  await db.insert(membershipContacts).values({ tenantId: f.tenant.id, membershipId: f.member.id, email: "private@example.test", recoveryTokenHash: "synthetic-recovery-hash" });
  await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
  await db.insert(outboxJobs).values({ tenantId: f.tenant.id, kind: "email.marketing", payload: { membershipId: f.member.id, body: "synthetic-private-content" } });
  await db.insert(walletPasses).values({ tenantId: f.tenant.id, membershipId: f.member.id, provider: "apple", providerObjectId: f.member.id, status: "downloaded" });
  const before = await snapshot(f.tenant.id); const foreignBefore = await snapshot(foreign.tenant.id);
  const { observed, spy } = failActualQuery(text => text.startsWith('update "memberships"') && text.includes('"closed_at"'));
  try {
    await expect(closeCard(f.member.cardToken)).rejects.toMatchObject({ cause: { code: "22012" } });
    expect(observed.client).toBeDefined(); expect(observed.rollback).toBe(true);
  } finally { spy.mockRestore(); }
  expect(await snapshot(f.tenant.id)).toEqual(before);
  expect(await snapshot(foreign.tenant.id)).toEqual(foreignBefore);
  expect((await getCustomerExport(f.member.cardToken)).membership.balance).toBe(2);
  await expect(closeCard(f.member.cardToken)).resolves.toMatchObject({ closed: true });
  expect((await pool.query("SELECT * FROM membership_contacts WHERE membership_id=$1", [f.member.id])).rows).toEqual([]);
  const jobs = (await pool.query("SELECT kind,status,payload FROM outbox_jobs WHERE tenant_id=$1 ORDER BY kind", [f.tenant.id])).rows;
  expect(jobs).toEqual([{ kind: "email.marketing", status: "suppressed", payload: { membershipId: f.member.id } }, { kind: "wallet.refresh", status: "pending", payload: { membershipId: f.member.id, coalescingVersion: "1" } }]);
  expect((await pool.query("SELECT status,revoke_reason FROM wallet_passes WHERE membership_id=$1", [f.member.id])).rows).toEqual([{ status: "revocation_pending", revoke_reason: "closed" }]);
  expect((await pool.query("SELECT count(*)::int AS n FROM consent_events WHERE membership_id=$1 AND source='card_closure'", [f.member.id])).rows[0].n).toBe(1);
  await expect(closeCard(f.member.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(getCustomerExport(f.member.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await snapshot(foreign.tenant.id)).toEqual(foreignBefore);
});

it("rejects a real customer export query failure without returning partial data and releases a clean transaction for retry", async () => {
  const f = await nfcFixture(); const foreign = await nfcFixture();
  await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const before = await snapshot(f.tenant.id); const foreignBefore = await snapshot(foreign.tenant.id);
  const { observed, spy } = failActualQuery(text => text.startsWith("select") && text.includes('from "ledger_entries"'));
  try {
    await expect(getCustomerExport(f.member.cardToken)).rejects.toMatchObject({ cause: { code: "22012" } });
    expect(observed.client).toBeDefined(); expect(observed.rollback).toBe(true);
  } finally { spy.mockRestore(); }
  const client = await pool.connect();
  try { expect(client).toBe(observed.client); expect((await client.query("show transaction_read_only")).rows[0].transaction_read_only).toBe("off"); await expect(client.query("select 1 as healthy")).resolves.toMatchObject({ rows: [{ healthy: 1 }] }); }
  finally { client.release(); }
  expect(await snapshot(f.tenant.id)).toEqual(before); expect(await snapshot(foreign.tenant.id)).toEqual(foreignBefore);
  const retried = await getCustomerExport(f.member.cardToken);
  expect(retried.membership.balance).toBe(2); expect(retried.ledger.map(row => row.delta)).toEqual([2]);
  expect(JSON.stringify(retried)).not.toContain(f.member.cardToken); expect(JSON.stringify(retried)).not.toContain(foreign.member.id);
});
