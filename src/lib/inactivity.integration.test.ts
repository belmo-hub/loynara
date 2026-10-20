import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordClosureIntent } from "./closure-manifest";
import { pool } from "@/db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
import { createMerchant, enroll, getCard } from "./product";
import { award } from "./loyalty";
import { recordCustomerActivity, reviewInactiveCards, merchantInactivity, acknowledgeInactivity } from "./inactivity";
assertTestDatabaseUrl();
beforeEach(async()=>{vi.mocked(recordClosureIntent).mockReset().mockResolvedValue(undefined);await assertOwnedTestDatabase(pool);await pool.query('TRUNCATE tenants,"user",apple_devices,card_recovery_challenges CASCADE');});
afterAll(()=>pool.end());
afterEach(()=>vi.restoreAllMocks());
async function fixture(balance=0) {
 const userId=randomUUID();
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic owner\',$2,false)',[userId,`${userId}@example.test`]);
 const merchant=await createMerchant({userId,businessName:'Synthetic inactivity',city:'Berlin',country:'DE',timezone:'Europe/Berlin',locale:'de',currency:'EUR',programName:'Synthetic',programType:'stamp',rulesText:'Synthetic terms',rewardTitle:'Reward',rewardCost:5});
 const card=await enroll({slug:merchant.programSlug,acceptedTerms:true});
 if(balance) await award({userId,locationId:merchant.locationId,membershipId:card.id,quantity:balance,idempotencyKey:randomUUID(),requestId:randomUUID()});
 await pool.query("UPDATE memberships SET created_at=now()-interval '25 months' WHERE id=$1",[card.id]);
 return {userId,merchant,card};
}
describe('inactivity policy',()=>{
 it('closes zero balance after24months; provider/staff GETs do not renew activity',async()=>{
  const {card}=await fixture();
  await getCard(card.cardToken);
  expect(await reviewInactiveCards()).toEqual({closed:1,flagged:0,cleaned:0});
  await expect(getCard(card.cardToken)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('retains a zero balance when explicit customer use renews activity',async()=>{
  const {card}=await fixture();
  await recordCustomerActivity(card.cardToken);
  expect(await reviewInactiveCards()).toEqual({closed:0,flagged:0,cleaned:0});
  expect((await pool.query('SELECT last_customer_activity_at FROM memberships WHERE id=$1',[card.id])).rows[0].last_customer_activity_at).toBeInstanceOf(Date);
 });
 it('keeps current loyalty transactions and nonzero balances open',async()=>{
  const {card}=await fixture(2);
  expect(await reviewInactiveCards()).toEqual({closed:0,flagged:0,cleaned:0});
  expect((await getCard(card.cardToken)).balance).toBe(2);
 });
 it('flags an old nonzero balance monthly without changing ledger or customer activity',async()=>{
  const {card,userId}=await fixture();
  // Synthetic historic ledger inserted directly, using the same immutable financial model.
  await pool.query("INSERT INTO ledger_entries(tenant_id,location_id,membership_id,delta,kind,actor_user_id,request_id,idempotency_key,created_at) SELECT m.tenant_id,p.location_id,m.id,3,'award',$2,$3,$4,now()-interval '25 months' FROM memberships m JOIN programs p ON p.id=m.program_id WHERE m.id=$1",[card.id,userId,randomUUID(),randomUUID()]);
  await pool.query('UPDATE memberships SET balance=3 WHERE id=$1',[card.id]);
  expect(await reviewInactiveCards()).toEqual({closed:0,flagged:1,cleaned:0});
  expect(await merchantInactivity(userId)).toHaveLength(1);
  await acknowledgeInactivity(userId,card.id);
  expect(await merchantInactivity(userId)).toHaveLength(0);
  expect(await reviewInactiveCards()).toEqual({closed:0,flagged:0,cleaned:0});
  await pool.query("UPDATE inactivity_reviews SET flagged_at=now()-interval '2 months',reviewed_at=now()-interval '1 month 1 day'");
  expect(await reviewInactiveCards()).toEqual({closed:0,flagged:1,cleaned:0});
  expect((await pool.query('SELECT balance,last_customer_activity_at,closed_at FROM memberships WHERE id=$1',[card.id])).rows).toEqual([{balance:3,last_customer_activity_at:null,closed_at:null}]);
  await expect(acknowledgeInactivity(randomUUID(),card.id)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('never closes before the24month boundary and bounds each batch',async()=>{
  const {card,merchant}=await fixture();
  await pool.query("UPDATE memberships SET created_at=now()-interval '24 months'+interval '1 minute' WHERE id=$1",[card.id]);
  expect(await reviewInactiveCards(1)).toEqual({closed:0,flagged:0,cleaned:0});
  for(let i=0;i<3;i++){const other=await enroll({slug:merchant.programSlug,acceptedTerms:true});await pool.query("UPDATE memberships SET created_at=now()-interval '25 months' WHERE id=$1",[other.id]);}
  expect(await reviewInactiveCards(1)).toEqual({closed:1,flagged:0,cleaned:0});
  expect((await pool.query('SELECT count(*)::int AS n FROM memberships WHERE closed_at IS NULL')).rows[0].n).toBe(3);
  await expect(reviewInactiveCards(0)).rejects.toThrow('Invalid retention batch');
 });
 it('commits each closed card before processing the next; a later archive failure cannot undo it',async()=>{
  const first=await fixture(),second=await fixture();
  const ids=[first.card.id,second.card.id].sort();
  vi.mocked(recordClosureIntent).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('synthetic second archive outage'));
  await expect(reviewInactiveCards(2)).rejects.toThrow('synthetic second archive outage');
  expect((await pool.query('SELECT id,closed_at IS NOT NULL AS closed FROM memberships ORDER BY id')).rows).toEqual([{id:ids[0],closed:true},{id:ids[1],closed:false}]);
 });
 it('does not lock another candidate while waiting for the first external archive',async()=>{
  const first=await fixture(),second=await fixture();
  const ids=[first.card.id,second.card.id].sort();
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(recordClosureIntent).mockImplementationOnce(async()=>{await gate;});
  const run=reviewInactiveCards(2);
  try {
   await expect.poll(()=>vi.mocked(recordClosureIntent).mock.calls.length).toBe(1);
   const client=await pool.connect();
   try {await client.query('BEGIN');await client.query("SET LOCAL lock_timeout='100ms'");await expect(client.query('SELECT id FROM memberships WHERE id=$1 FOR UPDATE',[ids[1]])).resolves.toMatchObject({rowCount:1});await client.query('ROLLBACK');}
   finally{client.release();}
  } finally {release();await run;}
 });

 it('bounds stale review cleanup to one batch',async()=>{
  const {card,merchant}=await fixture();
  await recordCustomerActivity(card.cardToken);
  const other=await enroll({slug:merchant.programSlug,acceptedTerms:true});
  for(const id of [card.id,other.id]) await pool.query('INSERT INTO inactivity_reviews(tenant_id,membership_id) VALUES($1,$2)',[merchant.tenantId,id]);
  await reviewInactiveCards(1);
  expect((await pool.query('SELECT count(*)::int AS n FROM inactivity_reviews')).rows[0].n).toBe(1);
 });
 it('stops before another archive would overrun its deadline, preserving committed cards',async()=>{
  await fixture();await fixture();
  let now=Date.now();const deadline=now+90_000;
  vi.spyOn(Date,'now').mockImplementation(()=>now);
  vi.mocked(recordClosureIntent).mockImplementationOnce(async()=>{now+=30_000;});
  await expect(reviewInactiveCards(2,deadline)).rejects.toThrow('deadline exhausted');
  expect((await pool.query('SELECT count(*)::int AS n FROM memberships WHERE closed_at IS NOT NULL')).rows[0].n).toBe(1);
  expect(recordClosureIntent).toHaveBeenCalledTimes(1);
 });

});
