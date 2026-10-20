import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
import { createMerchant, enroll, getCard } from "./product";
import { closeCard } from "./card-lifecycle";
import { closeMerchant } from "./merchant-deletion";
import { recordClosureIntent } from "./closure-manifest";
assertTestDatabaseUrl();
beforeEach(async()=>{await assertOwnedTestDatabase(pool);await pool.query('TRUNCATE tenants,"user",apple_devices,card_recovery_challenges CASCADE');vi.mocked(recordClosureIntent).mockReset().mockResolvedValue(undefined);});
afterAll(()=>pool.end());
async function fixture(){
 const userId=randomUUID(),sessionId=randomUUID();
 await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic owner\',$2,false)',[userId,`${userId}@example.test`]);
 await pool.query('INSERT INTO session(id,"userId",token,"expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now())',[sessionId,userId,randomUUID()]);
 const merchant=await createMerchant({userId,businessName:'Synthetic archive',city:'Berlin',country:'DE',timezone:'Europe/Berlin',locale:'de',currency:'EUR',programName:'Synthetic',programType:'stamp',rulesText:'Synthetic terms',rewardTitle:'Reward',rewardCost:5});
 const card=await enroll({slug:merchant.programSlug,acceptedTerms:true,email:'archive@example.test'});
 return {userId,sessionId,merchant,card};
}
describe('durable closure before commit',()=>{
 it('keeps a card open and all contact data intact if the archive refuses the intent',async()=>{
  const {card}=await fixture();
  vi.mocked(recordClosureIntent).mockRejectedValueOnce(new Error('synthetic archive outage'));
  await expect(closeCard(card.cardToken)).rejects.toThrow('synthetic archive outage');
  expect((await getCard(card.cardToken)).balance).toBe(0);
  expect((await pool.query('SELECT email FROM membership_contacts WHERE membership_id=$1',[card.id])).rows).toEqual([{email:'archive@example.test'}]);
 });
 it('does not commit until the independently archived intent has been acknowledged',async()=>{
  const {card,merchant}=await fixture();
  let release!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(recordClosureIntent).mockImplementationOnce(async intent=>{
   expect(intent).toMatchObject({scope:'member',tenant_id:merchant.tenantId,member_id:card.id,intent_id:expect.any(String)});
   expect(JSON.stringify(intent)).not.toContain(card.cardToken);
   expect((await pool.query('SELECT closed_at FROM memberships WHERE id=$1',[card.id])).rows[0].closed_at).toBeNull();
   await gate;
  });
  const closing=closeCard(card.cardToken);
  await expect.poll(()=>vi.mocked(recordClosureIntent).mock.calls.length).toBe(1);
  release();const result=await closing;
  expect(vi.mocked(recordClosureIntent).mock.calls[0][0].intent_id).toBe(result.receiptId);
  await expect(getCard(card.cardToken)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('rolls every merchant access change back when closure archival fails',async()=>{
  const {userId,sessionId,merchant,card}=await fixture();
  vi.mocked(recordClosureIntent).mockRejectedValueOnce(new Error('synthetic archive outage'));
  await expect(closeMerchant({actorUserId:userId,sessionId,tenantId:merchant.tenantId,confirmation:'Synthetic archive'})).rejects.toThrow('synthetic archive outage');
  expect((await pool.query('SELECT active FROM staff_roles WHERE user_id=$1',[userId])).rows).toEqual([{active:true}]);
  expect((await pool.query('SELECT id FROM session WHERE id=$1',[sessionId])).rows).toHaveLength(1);
  expect((await getCard(card.cardToken)).balance).toBe(0);
 });
});
