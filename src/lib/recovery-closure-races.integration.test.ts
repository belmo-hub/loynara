import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { nfcFixture } from "./nfc-test-db";
import { closeCard } from "./card-lifecycle";
import { requestCardRecovery } from "./card-recovery";
import { deliverRecoveryEmail, deliverRecoveryNotice } from "./card-recovery-delivery";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
assertTestDatabaseUrl();
beforeEach(async () => {
  await assertOwnedTestDatabase(pool);
  vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("EXTERNAL_EMAIL_ENABLED", "false");
  await pool.query('TRUNCATE tenants,"user" CASCADE');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
function gate() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
async function fixture() {
  const f = await nfcFixture(), email = `${randomUUID()}@example.test`;
  await pool.query("INSERT INTO membership_contacts (tenant_id,membership_id,email,email_verified) VALUES ($1,$2,$3,true)", [f.tenant.id, f.member.id, email]);
  return { ...f, email };
}
it("rechecks live verified contact after the email advisory lock instead of inserting a stale post-closure challenge", async () => {
  const f = await fixture(), control = await pool.connect();
  let pending: ReturnType<typeof requestCardRecovery> | undefined;
  try {
    await control.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [f.email]);
    pending = requestCardRecovery(f.email);
    await expect.poll(async () => Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%pg_advisory_xact_lock%'")).rows[0].n)).toBe(1);
    await closeCard(f.member.cardToken);
    await control.query("SELECT pg_advisory_unlock(hashtextextended($1,0))", [f.email]);
    await pending;
    expect((await pool.query("SELECT count(*)::int AS n FROM card_recovery_challenges WHERE email=$1", [f.email])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='email.recover' AND status='pending'")).rows[0].n).toBe(0);
  } finally {
    await control.query("SELECT pg_advisory_unlock_all()"); control.release();
    await Promise.allSettled(pending ? [pending] : []);
  }
});
it.each(["recovery", "notice"] as const)("holds the card lock through %s transport so closure cannot commit before the send, and suppresses sends after closure", async kind => {
  const f = await fixture();
  let job: { id: string; tenantId: string; payload: Record<string, unknown> };
  if (kind === "recovery") {
    await requestCardRecovery(f.email);
    const row = (await pool.query("SELECT id,tenant_id,payload FROM outbox_jobs WHERE kind='email.recover'")).rows[0];
    job = { id: row.id, tenantId: row.tenant_id, payload: row.payload };
  } else {
    await pool.query("INSERT INTO card_security_events (tenant_id,membership_id,action) VALUES ($1,$2,'card_credential_rotated')", [f.tenant.id, f.member.id]);
    const row = (await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload) VALUES ($1,'email.recovery_notice',$2) RETURNING id", [f.tenant.id, { membershipId: f.member.id }])).rows[0];
    job = { id: row.id, tenantId: f.tenant.id, payload: { membershipId: f.member.id } };
  }
  const reached = gate(), release = gate();
  const send = vi.fn(async () => { reached.resolve(); await release.promise; });
  const deliver = kind === "recovery" ? deliverRecoveryEmail : deliverRecoveryNotice;
  const pending = deliver(job, send);
  let closing: ReturnType<typeof closeCard> | undefined;
  try {
    await reached.promise;
    closing = closeCard(f.member.cardToken);
    await expect.poll(async () => Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query ILIKE '%from \"memberships\"%'")).rows[0].n)).toBeGreaterThan(0);
    release.resolve();
    expect(await pending).toMatchObject({ status: "complete" });
    await closing;
    const later = vi.fn(async () => undefined);
    expect(await deliver(job, later)).toMatchObject({ status: "suppressed" });
    expect(later).not.toHaveBeenCalled(); expect(send).toHaveBeenCalledOnce();
  } finally { release.resolve(); await Promise.allSettled([pending, ...(closing ? [closing] : [])]); }
});
