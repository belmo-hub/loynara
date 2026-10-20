import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";
import { createMerchant, enroll, getCard } from "./product";
import { closeMerchant } from "./merchant-deletion";
assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query('TRUNCATE tenants, "user", apple_devices CASCADE'); });
afterAll(() => pool.end());
async function fixture() {
  const userId = randomUUID(), sessionId = randomUUID();
  await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,\'Synthetic owner\',$2,false)', [userId, `${userId}@example.test`]);
  await pool.query('INSERT INTO session(id,"userId",token,"expiresAt","updatedAt") VALUES($1,$2,$3,now()+interval \'1 day\',now())',[sessionId,userId,randomUUID()]);
  const merchant=await createMerchant({userId,businessName:'Synthetic closed shop',city:'Berlin',country:'DE',timezone:'Europe/Berlin',locale:'de',currency:'EUR',programName:'Synthetic card',programType:'stamp',rulesText:'Synthetic terms',rewardTitle:'Reward',rewardCost:5});
  const card=await enroll({slug:merchant.programSlug,acceptedTerms:true,email:'close@example.test'});
  return {userId,sessionId,merchant,card,input:{actorUserId:userId,sessionId,tenantId:merchant.tenantId,confirmation:'Synthetic closed shop'}};
}
describe('merchant-account closure',()=>{
  it('revokes the tenant and every card immediately while awaiting classified erasure',async()=>{
    const {userId,sessionId,merchant,card,input}=await fixture();
    const result=await closeMerchant(input);
    expect(result).toMatchObject({closed:true,retention:'erasure-queued',receiptId:expect.any(String)});
    expect((await pool.query('SELECT closed_at FROM tenants WHERE id=$1',[merchant.tenantId])).rows[0].closed_at).toBeInstanceOf(Date);
    expect((await pool.query('SELECT active FROM staff_roles WHERE user_id=$1',[userId])).rows).toEqual([{active:false}]);
    expect((await pool.query('SELECT id FROM session WHERE id=$1',[sessionId])).rows).toEqual([]);
    expect((await pool.query('SELECT email FROM membership_contacts WHERE membership_id=$1',[card.id])).rows).toEqual([]);
    await expect(getCard(card.cardToken)).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(enroll({slug:merchant.programSlug,acceptedTerms:true})).rejects.toMatchObject({code:'NOT_FOUND'});
    await expect(pool.query('SELECT loynara_purge_tenant($1,clock_timestamp())',[merchant.tenantId])).rejects.toThrow(/classification|eligible/);
  });
  it('requires exact tenant confirmation and a recent server-side login',async()=>{
    const {input,merchant,sessionId}=await fixture();
    await expect(closeMerchant({...input,confirmation:'different shop'})).rejects.toMatchObject({code:'CONFIRMATION_REQUIRED'});
    await pool.query('UPDATE session SET "createdAt"=now()-interval \'11 minutes\' WHERE id=$1',[sessionId]);
    await expect(closeMerchant(input)).rejects.toMatchObject({code:'REAUTHENTICATION_REQUIRED'});
    expect((await pool.query('SELECT closed_at FROM tenants WHERE id=$1',[merchant.tenantId])).rows[0].closed_at).toBeNull();
  });
  it('does not accept a different tenant, staff role or another login session',async()=>{
    const {input,userId,merchant}=await fixture();
    await expect(closeMerchant({...input,tenantId:randomUUID()})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(closeMerchant({...input,sessionId:randomUUID()})).rejects.toMatchObject({code:'UNAUTHENTICATED'});
    await pool.query("UPDATE staff_roles SET role='manager',location_id=$2 WHERE user_id=$1",[userId,merchant.locationId]);
    await expect(closeMerchant(input)).rejects.toMatchObject({code:'FORBIDDEN'});
  });
});
