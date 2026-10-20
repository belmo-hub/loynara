import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
import { createMerchant, enroll } from "./product";
import { award, redeem } from "./loyalty";
import { closeCard } from "./card-lifecycle";

assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query('TRUNCATE tenants, "user", apple_devices, deletion_receipts, card_recovery_challenges, rate_limits CASCADE'); });
afterAll(() => pool.end());
async function fixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic owner\',$2,false)', [userId, `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Synthetic lifecycle", city: "Berlin", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic loyalty", programType: "stamp", rulesText: "Synthetic terms", rewardTitle: "Synthetic reward", rewardCost: 5 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await award({ userId, locationId: merchant.locationId, membershipId: card.id, quantity: 7, idempotencyKey: randomUUID(), requestId: randomUUID() });
  return { userId, merchant, card };
}
async function purge(id: string) {
  return pool.query('SELECT public.loynara_purge_member($1, clock_timestamp()) AS purged', [id]);
}
async function asRole(role: "loynara_runtime" | "loynara_maintenance" | "loynara_restore", sql: string, values: unknown[] = []) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SET LOCAL ROLE ${role}`);
    const result = await client.query(sql, values);
    await client.query("COMMIT");
    return result;
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
async function hold(tenantId: string, membershipId: string | null) {
  return (await pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['ledger'],'Synthetic claim basis','Synthetic case','Synthetic custodian',clock_timestamp()+interval '29 days','Synthetic release') AS id", [tenantId, membershipId])).rows[0].id as string;
}
async function closeTenantFixture(tenantId: string) {
  await pool.query("UPDATE memberships SET closed_at=clock_timestamp() WHERE tenant_id=$1", [tenantId]);
  await pool.query("UPDATE tenants SET closed_at=clock_timestamp() WHERE id=$1", [tenantId]);
}
describe("approved card erasure", () => {
  it("provides a privileged erasure boundary without PUBLIC execution", async () => {
    const rows = await pool.query("SELECT proname, proacl::text AS acl FROM pg_proc WHERE proname='loynara_purge_member'");
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].acl).not.toMatch(/(?:^|,)=[^,]*X/);
  });
  it("deletes a closed whole ledger graph while preserving another balance", async () => {
    const { merchant, card, userId } = await fixture();
    const other = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId, locationId: merchant.locationId, membershipId: other.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await closeCard(card.cardToken);
    expect((await purge(card.id)).rows[0].purged).toBe(true);
    expect((await pool.query('SELECT id FROM memberships WHERE id=$1', [card.id])).rows).toEqual([]);
    expect((await pool.query('SELECT id FROM ledger_entries WHERE membership_id=$1', [card.id])).rows).toEqual([]);
    expect((await pool.query('SELECT m.balance, sum(l.delta)::int AS total FROM memberships m JOIN ledger_entries l ON l.membership_id=m.id WHERE m.id=$1 GROUP BY m.id', [other.id])).rows).toEqual([{ balance: 3, total: 3 }]);
  });
  it("refuses open cards and preserves ordinary append-only protections", async () => {
    const { card } = await fixture();
    await expect(purge(card.id)).rejects.toThrow(/not eligible/);
    await expect(pool.query('DELETE FROM ledger_entries WHERE membership_id=$1', [card.id])).rejects.toThrow(/append-only/);
    await pool.query("SET app.retention_purge = 'true'");
    await expect(pool.query('UPDATE ledger_entries SET delta=1 WHERE membership_id=$1', [card.id])).rejects.toThrow(/append-only/);
    await pool.query('RESET app.retention_purge');
  });
  it("removes purchase snapshots, redemptions, and both sides of a reversal together", async () => {
    const { merchant,card,userId }=await fixture();
    const entry=(await pool.query("SELECT id FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].id;
    const rule=(await pool.query("SELECT id FROM program_rule_versions WHERE program_id=$1",[merchant.programId])).rows[0].id;
    const reward=(await pool.query("SELECT v.id FROM reward_versions v JOIN rewards r ON r.id=v.reward_id WHERE r.program_id=$1",[merchant.programId])).rows[0].id;
    await pool.query("INSERT INTO purchase_awards(tenant_id,ledger_entry_id,rule_version_id,amount_minor,currency,applied_rate,points_awarded) VALUES($1,$2,$3,700,'EUR',1,7)",[merchant.tenantId,entry,rule]);
    const redeemed=await redeem({ userId,locationId:merchant.locationId,membershipId:card.id,rewardVersionId:reward,idempotencyKey:randomUUID(),requestId:randomUUID() });
    await pool.query("INSERT INTO ledger_entries(tenant_id,location_id,membership_id,delta,kind,actor_user_id,request_id,idempotency_key,reversal_of_id) VALUES($1,$2,$3,5,'reversal',$4,$5,$6,$7)",[merchant.tenantId,merchant.locationId,card.id,userId,randomUUID(),randomUUID(),redeemed.entryId]);
    await pool.query("UPDATE memberships SET balance=7 WHERE id=$1",[card.id]);
    await closeCard(card.cardToken); await purge(card.id);
    for(const table of ["ledger_entries","purchase_awards","redemptions"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[merchant.tenantId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT id FROM program_rule_versions WHERE id=$1",[rule])).rows).toEqual([{id:rule}]);
  });
  it("rolls back instead of deleting another card's unexpected financial reference", async () => {
    const { merchant,card,userId }=await fixture();
    const other=await enroll({slug:merchant.programSlug,acceptedTerms:true});
    const entry=(await pool.query("SELECT id FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].id;
    await pool.query("INSERT INTO ledger_entries(tenant_id,location_id,membership_id,delta,kind,actor_user_id,request_id,idempotency_key,reversal_of_id) VALUES($1,$2,$3,1,'reversal',$4,$5,$6,$7)",[merchant.tenantId,merchant.locationId,other.id,userId,randomUUID(),randomUUID(),entry]);
    await pool.query("UPDATE memberships SET balance=1 WHERE id=$1",[other.id]);
    await closeCard(card.cardToken);
    await expect(purge(card.id)).rejects.toThrow(/foreign key constraint/);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1",[merchant.tenantId])).rows[0].n).toBe(2);
    expect((await pool.query("SELECT id FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{id:card.id}]);
  });
  it("denies runtime purge and private helpers while maintenance can erase without table DML", async () => {
    const { merchant,card } = await fixture();
    await closeCard(card.cardToken);
    await expect(asRole("loynara_runtime", "SELECT public.loynara_purge_member($1,clock_timestamp())", [card.id])).rejects.toThrow(/permission denied/);
    await expect(asRole("loynara_maintenance", "DELETE FROM memberships WHERE id=$1", [card.id])).rejects.toThrow(/permission denied/);
    await expect(asRole("loynara_maintenance", "SELECT public.loynara_erase_member_graph($1,$2)", [merchant.tenantId,card.id])).rejects.toThrow(/permission denied/);
    expect((await asRole("loynara_maintenance", "SELECT public.loynara_purge_member($1,clock_timestamp()) AS erased", [card.id])).rows).toEqual([{ erased: true }]);
  });
  it("runtime can use business rows but cannot bypass archival by deleting or truncating subjects", async () => {
    const {merchant,card}=await fixture();
    expect((await asRole("loynara_runtime","SELECT id FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{id:card.id}]);
    await expect(asRole("loynara_runtime","DELETE FROM memberships WHERE id=$1",[card.id])).rejects.toThrow(/permission denied/);
    await expect(asRole("loynara_runtime","DELETE FROM tenants WHERE id=$1",[merchant.tenantId])).rejects.toThrow(/permission denied/);
    await expect(asRole("loynara_runtime","TRUNCATE tenants CASCADE")).rejects.toThrow(/permission denied/);
    await expect(asRole("loynara_runtime","INSERT INTO tenant_retention_auth_subjects(tenant_id,user_id) VALUES($1,'unrelated')",[merchant.tenantId])).rejects.toThrow(/permission denied/);
  });
  it("denies scheduled maintenance the restore-only ability to erase an open card", async () => {
    const {merchant,card}=await fixture();
    await expect(asRole("loynara_maintenance","SELECT public.loynara_replay_erasure('member',$1,$2,clock_timestamp(),$3)",[merchant.tenantId,card.id,randomUUID()])).rejects.toThrow(/permission denied/);
    expect((await pool.query("SELECT closed_at FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{closed_at:null}]);
  });
  it("blocks held subjects but removes an unrelated closed card and only exports scoped hold metadata", async () => {
    const { merchant, card } = await fixture();
    const other = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const holdId = await hold(merchant.tenantId, card.id);
    await closeCard(card.cardToken);
    await closeCard(other.cardToken);
    await expect(purge(card.id)).rejects.toThrow(/not eligible/);
    expect((await purge(other.id)).rows[0].purged).toBe(true);
    const exceptions = await asRole("loynara_runtime", "SELECT * FROM public.loynara_retention_exceptions($1,$2)", [merchant.tenantId, card.id]);
    expect(exceptions.rows).toHaveLength(1);
    expect(Object.keys(exceptions.rows[0]).sort()).toEqual(["categories", "created_at", "legal_basis", "review_at"]);
    await expect(asRole("loynara_runtime", "SELECT reason,custodian FROM retention_holds")).rejects.toThrow(/permission denied/);
    await pool.query("SELECT public.loynara_release_retention_hold($1)", [holdId]);
    expect((await purge(card.id)).rows[0].purged).toBe(true);
  });
  it("a financial hold preserves its ledger without retaining unrelated closed-card messages and security data", async () => {
    const {merchant,card}=await fixture(); await hold(merchant.tenantId,card.id);
    await pool.query("INSERT INTO card_security_events(tenant_id,membership_id,action) VALUES($1,$2,'synthetic')",[merchant.tenantId,card.id]);
    await pool.query("INSERT INTO wallet_passes(tenant_id,membership_id,provider,provider_object_id,status) VALUES($1,$2,'google',$3,'created')",[merchant.tenantId,card.id,randomUUID()]);
    await pool.query("INSERT INTO outbox_jobs(tenant_id,kind,payload) VALUES($1,'email.marketing',jsonb_build_object('membershipId',$2::text,'body','synthetic private content'))",[merchant.tenantId,card.id]);
    await closeCard(card.cardToken);
    await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '8 days' WHERE id=$1",[card.id]);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].n).toBe(1);
    for(const table of ["consent_events","card_security_events","wallet_passes"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE membership_id=$1`,[card.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT id FROM outbox_jobs WHERE payload->>'membershipId'=$1",[card.id])).rows).toEqual([]);
  });
  it("rejects unsupported hold categories and unreviewed long holds", async () => {
    const { merchant, card } = await fixture();
    await expect(pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['contacts'],'basis','reason','custodian',clock_timestamp()+interval '29 days','release')", [merchant.tenantId, card.id])).rejects.toThrow(/check constraint/);
    await expect(pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['ledger'],'basis','reason','custodian',clock_timestamp()+interval '31 days','release')", [merchant.tenantId, card.id])).rejects.toThrow(/check constraint/);
  });
  it("waits for Wallet revocation until the seven-day maximum and records an incomplete remote result", async () => {
    const { merchant, card } = await fixture();
    await pool.query("INSERT INTO wallet_passes(tenant_id,membership_id,provider,provider_object_id,status) VALUES($1,$2,'google',$3,'created')", [merchant.tenantId, card.id, randomUUID()]);
    await closeCard(card.cardToken);
    await expect(purge(card.id)).rejects.toThrow(/not eligible/);
    const receipt = (await pool.query("SELECT deletion_receipt_id AS id FROM memberships WHERE id=$1", [card.id])).rows[0].id;
    await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '7 days 1 second' WHERE id=$1", [card.id]);
    expect((await purge(card.id)).rows[0].purged).toBe(true);
    expect((await pool.query("SELECT remote_outcome,exception,completed_at IS NOT NULL AS complete FROM deletion_receipts WHERE id=$1", [receipt])).rows).toEqual([{ remote_outcome: "incomplete", exception: "remote_revocation_incomplete", complete: true }]);
  });
  it("preserves a shared Apple device and removes it after its final registration", async () => {
    const { merchant, card } = await fixture();
    const other = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await pool.query("INSERT INTO apple_devices(device_library_identifier,push_token) VALUES('synthetic-shared-device','synthetic-push')");
    await pool.query("INSERT INTO apple_registrations(device_library_identifier,tenant_id,membership_id,pass_type_identifier,serial_number) VALUES('synthetic-shared-device',$1,$2::uuid,'synthetic.pass',$2::text),('synthetic-shared-device',$1,$3::uuid,'synthetic.pass',$3::text)", [merchant.tenantId, card.id, other.id]);
    await closeCard(card.cardToken); await purge(card.id);
    expect((await pool.query("SELECT count(*)::int AS n FROM apple_devices")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT membership_id FROM apple_registrations")).rows).toEqual([{ membership_id: other.id }]);
    await closeCard(other.cardToken); await purge(other.id);
    expect((await pool.query("SELECT count(*)::int AS n FROM apple_devices")).rows[0].n).toBe(0);
  });
  it("removes referral attribution while preserving the other person's posted bonus", async () => {
    const {merchant,card,userId}=await fixture();
    const other=await enroll({slug:merchant.programSlug,acceptedTerms:true});
    const bonus=await award({userId,locationId:merchant.locationId,membershipId:other.id,quantity:3,idempotencyKey:randomUUID(),requestId:randomUUID()});
    const qualifying=(await pool.query("SELECT id FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].id;
    const code=(await pool.query("INSERT INTO referral_codes(tenant_id,program_id,membership_id,code) VALUES($1,$2,$3,$4) RETURNING id",[merchant.tenantId,merchant.programId,other.id,randomUUID()])).rows[0].id;
    await pool.query("INSERT INTO referrals(tenant_id,program_id,referrer_membership_id,referred_membership_id,code_id,referrer_bonus,referred_bonus,status,qualifying_entry_id,referrer_bonus_entry_id) VALUES($1,$2,$3,$4,$5,3,0,'qualified',$6,$7)",[merchant.tenantId,merchant.programId,other.id,card.id,code,qualifying,bonus.entryId]);
    await closeCard(card.cardToken); await purge(card.id);
    expect((await pool.query("SELECT id FROM referrals WHERE tenant_id=$1",[merchant.tenantId])).rows).toEqual([]);
    expect((await pool.query("SELECT m.balance,sum(l.delta)::int AS total FROM memberships m JOIN ledger_entries l ON l.membership_id=m.id WHERE m.id=$1 GROUP BY m.id",[other.id])).rows).toEqual([{balance:3,total:3}]);
  });
  it("refuses future and pre-subject cutoffs and is idempotent after success", async () => {
    const { card } = await fixture(); await closeCard(card.cardToken);
    await expect(pool.query("SELECT public.loynara_purge_member($1,clock_timestamp()+interval '1 minute')", [card.id])).rejects.toThrow(/not eligible/);
    await expect(pool.query("SELECT public.loynara_purge_member($1,'2000-01-01'::timestamptz)", [card.id])).rejects.toThrow(/not eligible/);
    expect((await purge(card.id)).rows[0].purged).toBe(true);
    expect((await purge(card.id)).rows[0].purged).toBe(false);
  });
  it("requires tenant classification and prevents the individual-card route bypassing it", async () => {
    const { merchant, card, userId } = await fixture(); await closeTenantFixture(merchant.tenantId);
    await expect(purge(card.id)).rejects.toThrow(/not eligible/);
    await expect(pool.query("SELECT public.loynara_purge_tenant($1,clock_timestamp())", [merchant.tenantId])).rejects.toThrow(/not eligible/);
    await pool.query("SELECT public.loynara_classify_tenant_retention($1,'no_statutory_records','Synthetic accountant')", [merchant.tenantId]);
    expect((await asRole("loynara_maintenance", "SELECT public.loynara_purge_tenant($1,clock_timestamp()) AS erased", [merchant.tenantId])).rows).toEqual([{ erased: true }]);
    expect((await pool.query("SELECT id FROM tenants WHERE id=$1", [merchant.tenantId])).rows).toEqual([]);
    expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [userId])).rows).toEqual([]);
  });
  it("preserves auth credentials when a former owner has moved to another tenant", async () => {
    const { merchant, userId } = await fixture();
    const {merchant:other}=await fixture();
    await pool.query("UPDATE staff_roles SET tenant_id=$1,location_id=$2,role='cashier' WHERE user_id=$3",[other.tenantId,other.locationId,userId]);
    await closeTenantFixture(merchant.tenantId);
    await pool.query("SELECT public.loynara_classify_tenant_retention($1,'archive_verified','Synthetic accountant','synthetic-archive-case')", [merchant.tenantId]);
    await pool.query("SELECT public.loynara_purge_tenant($1,clock_timestamp())", [merchant.tenantId]);
    expect((await pool.query('SELECT id FROM "user" WHERE id=$1', [userId])).rows).toEqual([{ id: userId }]);
    expect((await pool.query("SELECT tenant_id FROM staff_roles WHERE user_id=$1", [userId])).rows).toEqual([{ tenant_id: other.tenantId }]);
  });
  it("repairs restored function ownership and PUBLIC grants without granting login membership", async () => {
    await pool.query("ALTER FUNCTION public.loynara_purge_member(uuid,timestamptz) OWNER TO looplocal; GRANT EXECUTE ON FUNCTION public.loynara_purge_member(uuid,timestamptz) TO PUBLIC");
    await pool.query(readFileSync(new URL("../../scripts/provision-retention-roles.sql", import.meta.url),"utf8"));
    const authority=await pool.query("SELECT r.rolname,p.prosecdef,p.proconfig,has_function_privilege('loynara_runtime',p.oid,'EXECUTE') AS runtime,has_function_privilege('loynara_maintenance',p.oid,'EXECUTE') AS maintenance FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid='public.loynara_purge_member(uuid,timestamptz)'::regprocedure");
    expect(authority.rows).toEqual([{rolname:"loynara_purge_owner",prosecdef:true,proconfig:["search_path=pg_catalog"],runtime:false,maintenance:true}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM pg_auth_members a JOIN pg_roles r ON r.oid IN(a.member,a.roleid) WHERE r.rolname='loynara_purge_owner'")).rows[0].n).toBe(0);
  });
  it("serializes new holds against a prepared erasure transaction", async () => {
    const {merchant,card}=await fixture(); await closeCard(card.cardToken);
    const prepared=await pool.connect(); const competing=await pool.connect();
    try {
      await prepared.query("BEGIN");
      await prepared.query("SELECT public.loynara_prepare_erasure('member',$1,$2,clock_timestamp())",[merchant.tenantId,card.id]);
      await competing.query("BEGIN; SET LOCAL lock_timeout='50ms'");
      await expect(competing.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['ledger'],'basis','reason','custodian',clock_timestamp()+interval '29 days','release')",[merchant.tenantId,card.id])).rejects.toThrow(/lock timeout/);
    } finally {await competing.query("ROLLBACK");await prepared.query("ROLLBACK");competing.release();prepared.release();}
    await hold(merchant.tenantId,card.id);
    await expect(purge(card.id)).rejects.toThrow(/not eligible/);
  });
  it("reports only aggregate overdue and classification counts to runtime", async () => {
    const {merchant,card}=await fixture(); await closeCard(card.cardToken);
    await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '25 hours' WHERE id=$1",[card.id]);
    const held=await enroll({slug:merchant.programSlug,acceptedTerms:true}); await closeCard(held.cardToken);
    await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '8 days' WHERE id=$1",[held.id]); await hold(merchant.tenantId,held.id);
    const {merchant:closedTenant}=await fixture(); await closeTenantFixture(closedTenant.tenantId);
    await pool.query("UPDATE tenants SET closed_at=clock_timestamp()-interval '8 days' WHERE id=$1",[closedTenant.tenantId]);
    const health=await asRole("loynara_runtime","SELECT * FROM public.loynara_retention_health()");
    expect(health.rows).toEqual([{overdue_cards:1,overdue_tenants:1,hold_reviews:0,remote_incomplete:0,unclassified_tenants:1}]);
  });
  it("replays an erasure against an open restored snapshot without queuing provider work", async () => {
    const { merchant, card } = await fixture();
    await asRole("loynara_restore", "SELECT public.loynara_replay_erasure('member',$1,$2,clock_timestamp(),$3)", [merchant.tenantId, card.id, randomUUID()]);
    expect((await pool.query("SELECT id FROM memberships WHERE id=$1", [card.id])).rows).toEqual([]);
    expect((await pool.query("SELECT id FROM outbox_jobs WHERE payload->>'membershipId'=$1", [card.id])).rows).toEqual([]);
    await asRole("loynara_restore", "SELECT public.loynara_replay_erasure('member',$1,$2,clock_timestamp(),$3)", [merchant.tenantId, card.id, randomUUID()]);
  });
  it("replays closure before purge so an old backup cannot restore a live bearer or staff authority", async () => {
    const {merchant,card}=await fixture(); const receipt=randomUUID();
    await hold(merchant.tenantId,card.id);
    await pool.query("INSERT INTO wallet_passes(tenant_id,membership_id,provider,provider_object_id,status) VALUES($1,$2,'google',$3,'created')",[merchant.tenantId,card.id,randomUUID()]);
    await expect(asRole("loynara_maintenance","SELECT public.loynara_replay_closure('member',$1,$2,clock_timestamp(),$3)",[merchant.tenantId,card.id,receipt])).rejects.toThrow(/permission denied/);
    await asRole("loynara_restore","SELECT public.loynara_replay_closure('member',$1,$2,clock_timestamp(),$3)",[merchant.tenantId,card.id,receipt]);
    const row=(await pool.query("SELECT card_token,scan_code,closed_at,balance,deletion_receipt_id FROM memberships WHERE id=$1",[card.id])).rows[0];
    expect(row.card_token).not.toBe(card.cardToken); expect(row.scan_code).not.toBe(card.scanCode); expect(row.closed_at).not.toBeNull(); expect(row.balance).toBe(7); expect(row.deletion_receipt_id).toBe(receipt);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT status FROM wallet_passes WHERE membership_id=$1",[card.id])).rows).toEqual([{status:"revocation_pending"}]);
    expect((await pool.query("SELECT kind,status FROM outbox_jobs WHERE payload->>'membershipId'=$1 AND status='pending'",[card.id])).rows).toEqual([{kind:"wallet.refresh",status:"pending"}]);
  });
  it("replays tenant shutdown without requiring accounting classification and is idempotent", async () => {
    const {merchant,card,userId}=await fixture(); const receipt=randomUUID();
    await pool.query('INSERT INTO session(id,"expiresAt",token,"updatedAt","userId") VALUES($1,now()+interval \'1 day\',$2,now(),$3)',[randomUUID(),randomUUID(),userId]);
    await asRole("loynara_restore","SELECT public.loynara_replay_closure('tenant',$1,NULL,clock_timestamp(),$2)",[merchant.tenantId,receipt]);
    await asRole("loynara_restore","SELECT public.loynara_replay_closure('tenant',$1,NULL,clock_timestamp(),$2)",[merchant.tenantId,receipt]);
    expect((await pool.query("SELECT active FROM staff_roles WHERE tenant_id=$1",[merchant.tenantId])).rows).toEqual([{active:false}]);
    expect((await pool.query('SELECT id FROM session WHERE "userId"=$1',[userId])).rows).toEqual([]);
    expect((await pool.query("SELECT status FROM programs WHERE tenant_id=$1",[merchant.tenantId])).rows).toEqual([{status:"archived"}]);
    expect((await pool.query("SELECT balance,closed_at IS NOT NULL AS closed FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{balance:7,closed:true}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM deletion_receipts WHERE id=$1",[receipt])).rows[0].n).toBe(1);
    await expect(pool.query("SELECT public.loynara_purge_tenant($1,clock_timestamp())",[merchant.tenantId])).rejects.toThrow(/not eligible/);
  });
  it("replay clears the last shared-email recovery challenge and its cross-tenant job", async () => {
    const { merchant,card }=await fixture();
    const otherTenant=await fixture();
    const challenge=randomUUID(); const job=randomUUID();
    await pool.query("INSERT INTO membership_contacts(tenant_id,membership_id,email,email_verified) VALUES($1,$2,'synthetic-recovery@example.test',true)",[merchant.tenantId,card.id]);
    await pool.query("INSERT INTO card_recovery_challenges(id,email,token_hash,expires_at) VALUES($1,'synthetic-recovery@example.test',$2,clock_timestamp()+interval '20 minutes')",[challenge,"a".repeat(64)]);
    await pool.query("INSERT INTO outbox_jobs(id,tenant_id,kind,payload) VALUES($1,$2,'email.recover',jsonb_build_object('challengeId',$3::text))",[job,otherTenant.merchant.tenantId,challenge]);
    await pool.query("SELECT public.loynara_replay_erasure('member',$1,$2,clock_timestamp(),$3)",[merchant.tenantId,card.id,randomUUID()]);
    expect((await pool.query("SELECT id FROM card_recovery_challenges WHERE id=$1",[challenge])).rows).toEqual([]);
    expect((await pool.query("SELECT id FROM outbox_jobs WHERE id=$1",[job])).rows).toEqual([]);
    expect((await pool.query("SELECT id FROM memberships WHERE id=$1",[otherTenant.card.id])).rows).toEqual([{id:otherTenant.card.id}]);
  });
  it("does not let a replay override a hold or erase a post-cutoff subject", async () => {
    const { merchant, card } = await fixture();
    const holdId=await hold(merchant.tenantId,card.id);
    await expect(pool.query("SELECT public.loynara_replay_erasure('member',$1,$2,clock_timestamp(),$3)", [merchant.tenantId,card.id,randomUUID()])).rejects.toThrow(/not eligible/);
    await pool.query("SELECT public.loynara_release_retention_hold($1)", [holdId]);
    await expect(pool.query("SELECT public.loynara_replay_erasure('member',$1,$2,'2000-01-01'::timestamptz,$3)", [merchant.tenantId,card.id,randomUUID()])).rejects.toThrow(/not eligible/);
    expect((await pool.query("SELECT closed_at FROM memberships WHERE id=$1", [card.id])).rows).toEqual([{ closed_at:null }]);
  });
  it("prunes bounded expired enforcement buckets while retaining unexpired buckets", async () => {
    await pool.query("INSERT INTO rate_limits(key_hash,hits,reset_at) VALUES('synthetic-old-1',1,clock_timestamp()-interval '25 hours'),('synthetic-old-2',1,clock_timestamp()-interval '25 hours'),('synthetic-new',1,clock_timestamp()+interval '1 hour')");
    const first = await asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(1) AS counts");
    expect(first.rows[0].counts.rate_limits).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM rate_limits")).rows[0].n).toBe(2);
    await asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT key_hash FROM rate_limits")).rows).toEqual([{ key_hash:"synthetic-new" }]);
    await expect(asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(0)")).rejects.toThrow(/Invalid retention batch/);
  });
  it("does not let a financial hold prolong an expired shared-email recovery challenge", async () => {
    const {merchant,card}=await fixture();await hold(merchant.tenantId,card.id);
    await pool.query("INSERT INTO membership_contacts(tenant_id,membership_id,email,email_verified) VALUES($1,$2,'held-active@example.test',true)",[merchant.tenantId,card.id]);
    const expired=randomUUID(),live=randomUUID();
    await pool.query("INSERT INTO card_recovery_challenges(id,email,token_hash,expires_at) VALUES($1,'held-active@example.test',$3,now()-interval '25 hours'),($2,'held-active@example.test',$4,now()+interval '20 minutes')",[expired,live,"d".repeat(64),"e".repeat(64)]);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT id FROM card_recovery_challenges ORDER BY id")).rows).toEqual([{id:live}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].n).toBe(1);
  });
  it("prunes old append-only security events while preserving recent and held history", async () => {
    const { merchant, card } = await fixture();
    const other = await enroll({ slug:merchant.programSlug,acceptedTerms:true });
    await pool.query("INSERT INTO card_security_events(tenant_id,membership_id,action,created_at) VALUES($1,$2,'synthetic',clock_timestamp()-interval '91 days'),($1,$2,'recent',clock_timestamp()),($1,$3,'held',clock_timestamp()-interval '91 days')", [merchant.tenantId,card.id,other.id]);
    await pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['security'],'basis','reason','custodian',clock_timestamp()+interval '29 days','release')",[merchant.tenantId,other.id]);
    const result=await asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(100) AS counts");
    expect(result.rows[0].counts.card_security_events).toBe(1);
    expect((await pool.query("SELECT action FROM card_security_events ORDER BY action")).rows).toEqual([{ action:"held" },{ action:"recent" }]);
    await expect(pool.query("DELETE FROM card_security_events")).rejects.toThrow(/append-only/);
  });
  it("measures outbox retention from terminal completion and retains unresolved failed work", async () => {
    const {merchant}=await fixture();
    const expired=randomUUID(),recent=randomUUID(),failed=randomUUID();
    const client=await pool.connect();
    try {
      // Only this synthetic fixture bypasses the terminal clock to represent pre-existing aged rows.
      await client.query("BEGIN; ALTER TABLE public.outbox_jobs DISABLE TRIGGER outbox_terminal_clock");
      await client.query("INSERT INTO outbox_jobs(id,tenant_id,kind,payload,status,created_at,terminal_at) VALUES($1,$4,'synthetic','{}','complete',clock_timestamp()-interval '90 days',clock_timestamp()-interval '31 days'),($2,$4,'synthetic','{}','complete',clock_timestamp()-interval '90 days',clock_timestamp()-interval '29 days'),($3,$4,'synthetic','{}','failed',clock_timestamp()-interval '91 days',clock_timestamp()-interval '91 days')",[expired,recent,failed,merchant.tenantId]);
      await client.query("ALTER TABLE public.outbox_jobs ENABLE TRIGGER outbox_terminal_clock; COMMIT");
    } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT id FROM outbox_jobs WHERE id=$1",[expired])).rows).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE id=ANY($1::uuid[])",[[recent,failed]])).rows[0].n).toBe(2);
  });
  it.each(["consent","security"])("retains a standalone %s hold without retaining unheld financial history", async category => {
    const {merchant,card}=await fixture();
    await pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY[$3::text],'basis','reason','custodian',clock_timestamp()+interval '29 days','release')",[merchant.tenantId,card.id,category]);
    await pool.query("INSERT INTO card_security_events(tenant_id,membership_id,action) VALUES($1,$2,'synthetic')",[merchant.tenantId,card.id]);
    await closeCard(card.cardToken);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{balance:0}]);
    expect((await pool.query("SELECT id FROM ledger_entries WHERE membership_id=$1",[card.id])).rows).toEqual([]);
    expect((await pool.query("SELECT count(*)::int AS n FROM consent_events WHERE membership_id=$1",[card.id])).rows[0].n).toBe(category==="consent"?1:0);
    expect((await pool.query("SELECT count(*)::int AS n FROM card_security_events WHERE membership_id=$1",[card.id])).rows[0].n).toBe(category==="security"?1:0);
  });
  it("a tenant financial hold removes unheld campaign content and credentials while retaining an actor tombstone", async () => {
    const {merchant,card,userId}=await fixture();
    await hold(merchant.tenantId,null);
    await pool.query('INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,\'synthetic-password\',now())',[randomUUID(),userId]);
    await pool.query("INSERT INTO campaigns(tenant_id,program_id,created_by_user_id,title,subject,body,audience_definition) VALUES($1,$2,$3,'Synthetic campaign','Synthetic subject','Synthetic private body','{}')",[merchant.tenantId,merchant.programId,userId]);
    await pool.query("INSERT INTO staff_invites(tenant_id,location_id,invited_email,role,token_hash,invited_by_user_id,expires_at) VALUES($1,$2,'invite@example.test','cashier',$3,$4,now()+interval '1 day')",[merchant.tenantId,merchant.locationId,"c".repeat(64),userId]);
    await closeTenantFixture(merchant.tenantId);
    await pool.query("UPDATE tenants SET closed_at=now()-interval '8 days' WHERE id=$1;",[merchant.tenantId]);
    await pool.query("UPDATE memberships SET closed_at=now()-interval '8 days' WHERE tenant_id=$1",[merchant.tenantId]);
    await pool.query("SELECT public.loynara_classify_tenant_retention($1,'no_statutory_records','Synthetic accountant')",[merchant.tenantId]);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    for(const table of ["campaigns","staff_invites","outbox_jobs"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,[merchant.tenantId])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT id FROM account WHERE "userId"=$1',[userId])).rows).toEqual([]);
    const actor=(await pool.query('SELECT name,email,image FROM "user" WHERE id=$1',[userId])).rows[0];
    expect(actor.name).toBe("Closed account"); expect(actor.email).toMatch(/^erased-.*@invalid\.example$/); expect(actor.image).toBeNull();
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{balance:7}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].n).toBe(1);
  });
  it("a held tenant never scrubs an actor's active account in another tenant", async () => {
    const {merchant,userId}=await fixture(); const {merchant:other}=await fixture();
    await pool.query("UPDATE staff_roles SET tenant_id=$1,location_id=$2,role='cashier' WHERE user_id=$3",[other.tenantId,other.locationId,userId]);
    await pool.query('INSERT INTO account(id,"accountId","providerId","userId",password,"updatedAt") VALUES($1,$2,\'credential\',$2,\'synthetic-password\',now())',[randomUUID(),userId]);
    await hold(merchant.tenantId,null); await closeTenantFixture(merchant.tenantId);
    await pool.query("UPDATE tenants SET closed_at=now()-interval '8 days' WHERE id=$1",[merchant.tenantId]);
    await pool.query("UPDATE memberships SET closed_at=now()-interval '8 days' WHERE tenant_id=$1",[merchant.tenantId]);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query('SELECT name,email FROM "user" WHERE id=$1',[userId])).rows).toEqual([{name:"Synthetic owner",email:`${userId}@example.test`}]);
    expect((await pool.query('SELECT password FROM account WHERE "userId"=$1',[userId])).rows).toEqual([{password:"synthetic-password"}]);
  });
  it("offers an unheld card in a classified closed tenant for archived purge without erasing it during routine pruning", async () => {
    const {merchant,card}=await fixture();const held=await enroll({slug:merchant.programSlug,acceptedTerms:true});await hold(merchant.tenantId,held.id);
    await closeTenantFixture(merchant.tenantId);
    await pool.query("UPDATE tenants SET closed_at=now()-interval '8 days' WHERE id=$1",[merchant.tenantId]);
    await pool.query("UPDATE memberships SET closed_at=now()-interval '8 days' WHERE tenant_id=$1",[merchant.tenantId]);
    await pool.query("SELECT public.loynara_classify_tenant_retention($1,'no_statutory_records','Synthetic accountant')",[merchant.tenantId]);
    await asRole("loynara_maintenance","SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1",[card.id])).rows).toEqual([{balance:7}]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1",[card.id])).rows[0].n).toBe(1);
    const candidates=await asRole("loynara_maintenance","SELECT scope,membership_id FROM public.loynara_retention_candidates(100)");
    expect(candidates.rows).toEqual([{scope:"member",membership_id:card.id}]);
    expect((await asRole("loynara_maintenance","SELECT public.loynara_purge_member($1,clock_timestamp()) AS purged",[card.id])).rows[0].purged).toBe(true);
    expect((await pool.query("SELECT id FROM memberships WHERE id=$1",[held.id])).rows).toEqual([{id:held.id}]);
    await expect(pool.query("SELECT public.loynara_purge_tenant($1,clock_timestamp())",[merchant.tenantId])).rejects.toThrow(/not eligible/);
  });
});
describe("append-only reward history (0025) under erasure", () => {
  async function redeemed() {
    const { merchant, card, userId } = await fixture();
    const reward = (await pool.query("SELECT v.id FROM reward_versions v JOIN rewards r ON r.id=v.reward_id WHERE r.program_id=$1", [merchant.programId])).rows[0].id as string;
    await redeem({ userId, locationId: merchant.locationId, membershipId: card.id, rewardVersionId: reward, idempotencyKey: randomUUID(), requestId: randomUUID() });
    return { merchant, card, userId, reward };
  }
  // Runs one statement as a role inside a transaction that is always rolled back, optionally granting table rights
  // first, so a refusal proves the trigger rather than a missing privilege.
  async function attempt(role: "loynara_runtime" | "loynara_purge_owner", sql: string, values: unknown[], grant = false) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (grant) await client.query("GRANT SELECT, UPDATE, DELETE ON redemptions, reward_versions TO loynara_runtime");
      await client.query(`SET LOCAL ROLE ${role}`);
      return await client.query(sql, values);
    } finally { await client.query("ROLLBACK"); client.release(); }
  }
  it("the runtime role cannot update or delete reward versions or redemptions, even with table rights", async () => {
    const { card, reward } = await redeemed();
    await closeCard(card.cardToken);
    for (const grant of [false, true]) {
      await expect(attempt("loynara_runtime", "UPDATE redemptions SET cost=1 WHERE membership_id=$1", [card.id], grant)).rejects.toThrow(grant ? /append-only/ : /append-only|permission denied/);
      await expect(attempt("loynara_runtime", "DELETE FROM redemptions WHERE membership_id=$1", [card.id], grant)).rejects.toThrow(grant ? /append-only/ : /append-only|permission denied/);
      await expect(attempt("loynara_runtime", "UPDATE reward_versions SET cost=1 WHERE id=$1", [reward], grant)).rejects.toThrow(grant ? /append-only/ : /append-only|permission denied/);
      await expect(attempt("loynara_runtime", "DELETE FROM reward_versions WHERE id=$1", [reward], grant)).rejects.toThrow(grant ? /append-only/ : /append-only|permission denied/);
    }
    // The table owner (the migration and test user) is refused too: only the purge owner has the DELETE exception.
    await expect(pool.query("DELETE FROM redemptions WHERE membership_id=$1", [card.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM reward_versions WHERE id=$1", [reward])).rejects.toThrow(/append-only/);
  });
  it("the purge owner can never update, and can delete only a closed, unheld subject's history", async () => {
    const { merchant, card, reward } = await redeemed();
    await expect(attempt("loynara_purge_owner", "UPDATE redemptions SET cost=1 WHERE membership_id=$1", [card.id])).rejects.toThrow(/append-only/);
    await expect(attempt("loynara_purge_owner", "UPDATE reward_versions SET cost=1 WHERE id=$1", [reward])).rejects.toThrow(/append-only/);
    // Open card and open merchant.
    await expect(attempt("loynara_purge_owner", "DELETE FROM redemptions WHERE membership_id=$1", [card.id])).rejects.toThrow(/append-only/);
    await expect(attempt("loynara_purge_owner", "DELETE FROM reward_versions WHERE id=$1", [reward])).rejects.toThrow(/append-only/);
    // Closed but held.
    await closeTenantFixture(merchant.tenantId);
    await hold(merchant.tenantId, null);
    await expect(attempt("loynara_purge_owner", "DELETE FROM redemptions WHERE membership_id=$1", [card.id])).rejects.toThrow(/append-only/);
    await expect(attempt("loynara_purge_owner", "DELETE FROM reward_versions WHERE id=$1", [reward])).rejects.toThrow(/append-only/);
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE membership_id=$1", [card.id])).rows[0].n).toBe(1);
  });
  it("card erasure removes a closed card's redemptions and keeps the merchant's reward versions", async () => {
    const { card, reward } = await redeemed();
    await closeCard(card.cardToken);
    expect((await asRole("loynara_maintenance", "SELECT public.loynara_purge_member($1,clock_timestamp()) AS purged", [card.id])).rows[0].purged).toBe(true);
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE membership_id=$1", [card.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT id FROM reward_versions WHERE id=$1", [reward])).rows).toEqual([{ id: reward }]);
  });
  it("merchant erasure removes redemptions and reward versions with the tenant", async () => {
    const { merchant } = await redeemed();
    await closeTenantFixture(merchant.tenantId);
    await pool.query("SELECT public.loynara_classify_tenant_retention($1,'no_statutory_records','Synthetic accountant')", [merchant.tenantId]);
    expect((await asRole("loynara_maintenance", "SELECT public.loynara_purge_tenant($1,clock_timestamp()) AS erased", [merchant.tenantId])).rows).toEqual([{ erased: true }]);
    for (const table of ["redemptions", "reward_versions", "rewards", "tenants"]) {
      expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${table === "tenants" ? "id" : "tenant_id"}=$1`, [merchant.tenantId])).rows[0].n).toBe(0);
    }
  });
  it("routine pruning of a held closed card keeps its redemptions while the financial hold lasts", async () => {
    const { merchant, card } = await redeemed();
    await closeCard(card.cardToken);
    await hold(merchant.tenantId, card.id);
    await pool.query("UPDATE memberships SET closed_at=clock_timestamp()-interval '8 days' WHERE id=$1", [card.id]);
    await asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE membership_id=$1", [card.id])).rows[0].n).toBe(1);
  });
  it("routine pruning of a closed card held only for consent evidence removes its redemptions", async () => {
    const { merchant, card } = await redeemed();
    await closeCard(card.cardToken);
    await pool.query("SELECT public.loynara_set_retention_hold($1,$2,ARRAY['consent'],'Synthetic claim basis','Synthetic case','Synthetic custodian',clock_timestamp()+interval '29 days','Synthetic release')", [merchant.tenantId, card.id]);
    await asRole("loynara_maintenance", "SELECT public.loynara_prune_expired(100)");
    expect((await pool.query("SELECT retention_pruned_at IS NOT NULL AS pruned FROM memberships WHERE id=$1", [card.id])).rows).toEqual([{ pruned: true }]);
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE membership_id=$1", [card.id])).rows[0].n).toBe(0);
  });
});
