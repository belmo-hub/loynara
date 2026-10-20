import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { nfcFixture } from "./nfc-test-db";
import { award } from "./loyalty";
import { closeCard } from "./card-lifecycle";
import { consumeCustomerExportProof, deliverCustomerExportProof, requestCustomerExportProof } from "./customer-export-proof";
import { prepareCustomerPersonalExport } from "./customer-personal-export";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
import type { LocalMessage } from "./email";
import { POST as download } from "@/app/api/card/[token]/data-export/route";
assertTestDatabaseUrl();
beforeEach(async () => {
  await assertOwnedTestDatabase(pool);
  vi.stubEnv("SMTP_HOST", "localhost"); vi.stubEnv("EXTERNAL_EMAIL_ENABLED", "false");
  await pool.query('TRUNCATE tenants,"user" CASCADE');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
afterAll(() => pool.end());
async function read(input: { cardToken?: string; proof?: string }) {
  const staged = await prepareCustomerPersonalExport(input);
  try { return await new Response(staged.stream).json(); } finally { await staged.dispose(); }
}
async function proofFor(f: Awaited<ReturnType<typeof nfcFixture>>, address = "own@example.test") {
  await pool.query("INSERT INTO membership_contacts (tenant_id,membership_id,email,email_verified) VALUES ($1,$2,$3,true)", [f.tenant.id, f.member.id, address]);
  expect(await requestCustomerExportProof(f.member.cardToken)).toEqual({ mode: "email", status: "queued" });
  const row = (await pool.query("SELECT id,tenant_id,payload FROM outbox_jobs WHERE kind='email.export-proof' AND payload->>'membershipId'=$1 ORDER BY created_at DESC LIMIT 1", [f.member.id])).rows[0];
  const messages: LocalMessage[] = [];
  expect(await deliverCustomerExportProof({ id: row.id, tenantId: row.tenant_id, payload: row.payload }, async message => { messages.push(message); })).toMatchObject({ status: "complete" });
  expect(messages).toHaveLength(1);
  const link = new URL(messages[0].body.match(/https?:\/\/\S+/)![0]);
  expect(link.search).toBe(""); expect(link.pathname).toBe("/personal-data-export");
  return { proof: new URLSearchParams(link.hash.slice(1)).get("proof")!, job: row };
}
it("exports contactless card data and own referral outcome without peer identities, staff IDs or credentials", async () => {
  const f = await nfcFixture(), other = await nfcFixture();
  await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const peer = (await pool.query("INSERT INTO memberships (tenant_id,program_id,scan_code,card_token) VALUES ($1,$2,$3,$4) RETURNING id", [f.tenant.id, f.program.id, `sc_${randomUUID()}`, `card_${randomUUID().replaceAll("-", "")}`])).rows[0].id;
  const code = (await pool.query("INSERT INTO referral_codes (tenant_id,program_id,membership_id,code) VALUES ($1,$2,$3,$4) RETURNING id", [f.tenant.id, f.program.id, f.member.id, `ref_${randomUUID()}`])).rows[0].id;
  await pool.query("INSERT INTO referrals (tenant_id,program_id,referrer_membership_id,referred_membership_id,code_id,referrer_bonus,referred_bonus) VALUES ($1,$2,$3,$4,$5,2,1)", [f.tenant.id, f.program.id, f.member.id, peer, code]);
  expect(await requestCustomerExportProof(f.member.cardToken)).toEqual({ mode: "bearer", status: "ready" });
  const data = await read({ cardToken: f.member.cardToken });
  expect(data).toMatchObject({ formatVersion: 2, scope: "complete-own-card-personal-data", membership: { id: f.member.id, balance: 2 }, referrals: [{ role: "referrer", own_bonus: 2, status: "pending" }] });
  expect(data.ledger).toHaveLength(1); expect(data.contacts).toEqual([]);
  for (const secret of [f.member.cardToken, f.member.scanCode, f.userId, peer, other.member.id, other.member.cardToken]) expect(JSON.stringify(data)).not.toContain(secret);
});
it("requires fresh verified-email control and consumes one proof once without exposing another card sharing the address", async () => {
  const f = await nfcFixture(), other = await nfcFixture();
  await pool.query("INSERT INTO membership_contacts (tenant_id,membership_id,email,email_verified) VALUES ($1,$2,'shared@example.test',true)", [other.tenant.id, other.member.id]);
  const { proof } = await proofFor(f, "shared@example.test");
  await expect(read({ cardToken: f.member.cardToken })).rejects.toMatchObject({ code: "EXPORT_ASSISTANCE_REQUIRED" });
  await pool.query("INSERT INTO contact_verification_challenges (tenant_id,membership_id,email,token_hash,expires_at) VALUES ($1,$2,'never-verified@example.test',$3,now()+interval '10 minutes')", [f.tenant.id, f.member.id, "a".repeat(64)]);
  const data = await read({ proof });
  expect(JSON.stringify(data)).not.toContain("never-verified@example.test");
  expect(data.contactVerificationEvents).toHaveLength(1);
  expect(data.contacts).toEqual([expect.objectContaining({ email: "shared@example.test", email_verified: true })]);
  expect(JSON.stringify(data)).not.toContain(other.member.id);
  expect(JSON.stringify(data)).not.toContain(proof);
  await expect(read({ proof })).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
});
it("does not expose an entered unverified address or queue a proof to it", async () => {
  const f = await nfcFixture();
  await pool.query("INSERT INTO membership_contacts (tenant_id,membership_id,email,email_verified) VALUES ($1,$2,'unverified@example.test',false)", [f.tenant.id, f.member.id]);
  await expect(requestCustomerExportProof(f.member.cardToken)).rejects.toMatchObject({ code: "EXPORT_ASSISTANCE_REQUIRED" });
  await expect(read({ cardToken: f.member.cardToken })).rejects.toMatchObject({ code: "EXPORT_ASSISTANCE_REQUIRED" });
  expect((await pool.query("SELECT count(*)::int AS n FROM customer_export_challenges")).rows[0].n).toBe(0);
});
it.each(["expired", "contact changed", "credential changed", "closed"] as const)("refuses %s proof and never starts a new delivery for a closed card", async mode => {
  const f = await nfcFixture(); const { proof, job } = await proofFor(f);
  if (mode === "expired") await pool.query("UPDATE customer_export_challenges SET created_at=created_at-interval '11 minutes',expires_at=expires_at-interval '11 minutes'");
  if (mode === "contact changed") await pool.query("UPDATE membership_contacts SET email='changed@example.test' WHERE membership_id=$1", [f.member.id]);
  if (mode === "credential changed") await pool.query("UPDATE memberships SET card_token=$1 WHERE id=$2", [`card_${randomUUID().replaceAll("-", "")}`, f.member.id]);
  if (mode === "closed") await closeCard(f.member.cardToken);
  await expect(consumeCustomerExportProof(proof)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
  const send = vi.fn(async () => undefined);
  expect(await deliverCustomerExportProof({ id: job.id, tenantId: job.tenant_id, payload: job.payload }, send)).toMatchObject({ status: "suppressed" });
  expect(send).not.toHaveBeenCalled();
});
it("allows only one concurrent proof consumer", async () => {
  const f = await nfcFixture(); const { proof } = await proofFor(f);
  const results = await Promise.allSettled([consumeCustomerExportProof(proof), consumeCustomerExportProof(proof)]);
  expect(results.map(result => result.status).sort()).toEqual(["fulfilled", "rejected"]);
});
it("returns no attachment when a late export category fails and refuses cross-origin downloads", async () => {
  const f = await nfcFixture(), origin = "http://localhost:3000";
  const request = (requestOrigin: string) => new Request(`${origin}/api/card/${f.member.cardToken}/data-export`, { method: "POST", headers: { origin: requestOrigin, "content-type": "application/json" }, body: "{}" });
  expect((await download(request("https://foreign.example.test"), { params: Promise.resolve({ token: f.member.cardToken }) })).status).toBe(403);
  const original = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    if (text?.includes("DECLARE export_rows") && text.includes("loynara_retention_exceptions")) return Promise.reject(new Error("synthetic-private-query-content"));
    return Reflect.apply(original, this, args);
  }) as typeof original);
  try {
    const response = await download(request(origin), { params: Promise.resolve({ token: f.member.cardToken }) });
    expect(response.status).toBe(500); expect(response.headers.has("Content-Disposition")).toBe(false);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "Internal error" });
  } finally { spy.mockRestore(); }
});
it("exports more than the legacy 50000-row limit completely using bounded cursor batches", async () => {
  const f = await nfcFixture();
  await pool.query("INSERT INTO consent_events (tenant_id,membership_id,channel,purpose,granted,notice_version,source) SELECT $1,$2,'email','marketing',false,'synthetic','synthetic' FROM generate_series(1,50001)", [f.tenant.id, f.member.id]);
  expect((await read({ cardToken: f.member.cardToken })).consentEvents).toHaveLength(50001);
}, 60_000);
it("keeps membership and ledger in one readonly snapshot across a concurrent award", async () => {
  const f = await nfcFixture();
  const original = Client.prototype.query;
  let released!: () => void, reached!: () => void, paused = false;
  const gate = new Promise<void>(done => { released = done; }), seen = new Promise<void>(done => { reached = done; });
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const text = typeof args[0] === "string" ? args[0] : (args[0] as { text?: string })?.text;
    const result = Reflect.apply(original, this, args);
    if (paused || !text?.startsWith("SELECT m.id,m.tenant_id,m.program_id,m.card_locator")) return result;
    paused = true;
    return (result as Promise<unknown>).then(async rows => {
      const state = await Reflect.apply(original, this, ["SHOW transaction_read_only"]);
      expect(state.rows[0].transaction_read_only).toBe("on"); reached(); await gate; return rows;
    });
  }) as typeof original);
  const pending = read({ cardToken: f.member.cardToken });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([seen, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Snapshot gate not reached")), 2000); })]);
    await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    released(); const data = await pending;
    expect(data.membership.balance).toBe(0); expect(data.ledger).toEqual([]);
    expect((await read({ cardToken: f.member.cardToken })).membership.balance).toBe(2);
  } finally { clearTimeout(timer); released(); await Promise.allSettled([pending]); spy.mockRestore(); }
});

it("rechecks verified contact after a delivery member-lock wait before starting transport", async () => {
  const f = await nfcFixture(), { job } = await proofFor(f), control = await pool.connect();
  const send = vi.fn(async () => undefined);
  let pending: ReturnType<typeof deliverCustomerExportProof> | undefined;
  try {
    await control.query("BEGIN");
    await control.query("SELECT id FROM memberships WHERE id=$1 FOR UPDATE", [f.member.id]);
    pending = deliverCustomerExportProof({ id: job.id, tenantId: job.tenant_id, payload: job.payload }, send);
    await expect.poll(async () => Number((await pool.query("SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR UPDATE OF m%'")).rows[0].n)).toBe(1);
    await control.query("UPDATE membership_contacts SET email='replaced@example.test',email_verified=false WHERE membership_id=$1", [f.member.id]);
    await control.query("COMMIT");
    expect(await pending).toMatchObject({ status: "suppressed" });
    expect(send).not.toHaveBeenCalled();
  } finally { await control.query("ROLLBACK"); control.release(); await Promise.allSettled(pending ? [pending] : []); }
});
it("includes retained inactivity review and indirectly attributable email outcomes without staff identity", async () => {
  const f = await nfcFixture();
  await pool.query("UPDATE memberships SET last_customer_activity_at=now() WHERE id=$1", [f.member.id]);
  await pool.query("INSERT INTO inactivity_reviews (tenant_id,membership_id,reviewed_at,reviewed_by) VALUES ($1,$2,now(),$3)", [f.tenant.id, f.member.id, f.userId]);
  const campaign = (await pool.query("INSERT INTO campaigns (tenant_id,program_id,created_by_user_id,title,subject,body,audience_definition) VALUES ($1,$2,$3,'Synthetic','Synthetic','Synthetic','{}') RETURNING id", [f.tenant.id, f.program.id, f.userId])).rows[0].id;
  const recipient = (await pool.query("INSERT INTO campaign_recipients (tenant_id,campaign_id,membership_id,status) VALUES ($1,$2,$3,'complete') RETURNING id", [f.tenant.id, campaign, f.member.id])).rows[0].id;
  const job = (await pool.query("INSERT INTO outbox_jobs (tenant_id,kind,payload,status) VALUES ($1,'email.campaign',$2,'complete') RETURNING id", [f.tenant.id, { recipientId: recipient }])).rows[0].id;
  const data = await read({ cardToken: f.member.cardToken });
  expect(data.membership.lastCustomerActivityAt).toBeTruthy();
  expect(data.inactivityReviews).toEqual([expect.objectContaining({ flagged_at: expect.any(String), reviewed_at: expect.any(String) })]);
  expect(data.outboxOutcomes).toEqual([expect.objectContaining({ id: job, terminal_at: expect.any(String) })]);
  expect(data.campaignParticipation).toEqual([expect.objectContaining({ id: recipient, terminal_at: expect.any(String) })]);
  expect(JSON.stringify(data)).not.toContain(f.userId);
});
