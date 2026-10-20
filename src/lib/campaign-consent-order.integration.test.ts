import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { campaignAttempts, campaignDailyUsage, campaignRecipients, consentEvents, membershipContacts, outboxJobs } from "@/db/schema";
import { updateLocationAddress } from "./locations";
import { createMerchant, enroll } from "./product";
import { createDraftCampaign, deliverCampaignRecipient, dispatchCampaign, previewCampaign, scheduleCampaign } from "./campaigns";
import type { LocalMessage } from "./email";
import { createUnsubscribeToken } from "./unsubscribe";
import { POST as unsubscribe } from "@/app/api/unsubscribe/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Owned disposable database required");
vi.mock("./promotion-policy", async original => ({ ...await original<typeof import("./promotion-policy")>(), quietHoursDeferral: () => null }));
afterAll(async () => { vi.restoreAllMocks(); await pool.end(); });

it("rechecks committed withdrawal after stale materialization eligibility before promotional delivery", async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.MAILGUN_PROMOTIONAL_SEND_APPROVED = "false";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.BETTER_AUTH_SECRET = "synthetic-consent-order-secret-long-enough";
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET;
  await pool.query('TRUNCATE tenants, "user", email_suppressions CASCADE');
  async function shop(label: string) {
    const ownerId = randomUUID();
    await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [ownerId,label,`${ownerId}@example.test`]);
    const merchant = await createMerchant({ userId:ownerId,businessName:label,city:"Kassel",country:"DE",timezone:"Europe/Berlin",locale:"de",currency:"EUR",programName:label,programType:"stamp",rulesText:"One synthetic approved award",rewardTitle:"Coffee",rewardCost:5 });
    await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Teststraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
    async function card(email: string) {
      const result = await enroll({slug:merchant.programSlug,acceptedTerms:true,email,marketingOptIn:true});
      await db.update(membershipContacts).set({emailVerified:true}).where(eq(membershipContacts.membershipId,result.id));
      return result;
    }
    return {ownerId,merchant,card};
  }
  const own = await shop("Consent order A"), foreign = await shop("Consent order B");
  const withdrawn = await own.card("withdrawn@example.test"), eligible = await own.card("eligible@example.test");
  const foreignCard = await foreign.card("withdrawn@example.test");
  const definition = {kind:"all" as const};
  expect(await previewCampaign({actorUserId:own.ownerId,programSlug:own.merchant.programSlug,audienceDefinition:definition})).toMatchObject({eligibleCount:2});
  const campaign = await createDraftCampaign({actorUserId:own.ownerId,programSlug:own.merchant.programSlug,title:"Synthetic",subject:"Synthetic",body:"No external delivery",audienceDefinition:definition});
  const scheduled = new Date(Date.now()+1000);
  await scheduleCampaign({actorUserId:own.ownerId,campaignId:campaign.id,scheduledAt:scheduled});
  const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind,"campaign.dispatch"));
  const input = {id:dispatch.id,tenantId:dispatch.tenantId,payload:dispatch.payload};
  let ready!: () => void, release!: () => void;
  const observed = new Promise<void>(resolve => {ready=resolve;}), resume = new Promise<void>(resolve => {release=resolve;});
  const original = Client.prototype.query;
  const barrier: {client?:Client; pid?:number} = {};
  const spy = vi.spyOn(Client.prototype,"query").mockImplementation((function(this:Client,...args:unknown[]) {
    const config=args[0]; const text=typeof config==="string"?config:(config as {text?:string}|undefined)?.text;
    if (!barrier.client && text?.startsWith('insert into "campaign_recipients"')) {
      barrier.client=this;
      return (async () => {
        const identity=await Reflect.apply(original,this,["SELECT pg_backend_pid() AS pid"]);
        barrier.pid=identity.rows[0].pid; ready(); await resume;
        return Reflect.apply(original,this,args);
      })();
    }
    return Reflect.apply(original,this,args);
  }) as typeof original);
  const pending=dispatchCampaign(input,new Date(scheduled.getTime()+1000));
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    await Promise.race([observed,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Materialization insert barrier not reached")),2000);})]);
    expect((await pool.query("SELECT state FROM pg_stat_activity WHERE pid=$1",[barrier.pid])).rows).toEqual([{state:"idle in transaction"}]);
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    const token=createUnsubscribeToken({tenantId:own.merchant.tenantId,membershipId:withdrawn.id,email:"withdrawn@example.test"});
    const request=()=>new Request("http://localhost:3000/api/unsubscribe",{method:"POST",headers:{origin:"http://localhost:3000","content-type":"application/json"},body:JSON.stringify({token})});
    for (let replay=0;replay<2;replay++) { const response=await unsubscribe(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({status:"complete"}); }
    const withdrawals=await db.select().from(consentEvents).where(eq(consentEvents.membershipId,withdrawn.id));
    expect(withdrawals.filter(event=>!event.granted)).toHaveLength(1);
    expect((await db.select().from(consentEvents).where(eq(consentEvents.membershipId,foreignCard.id))).every(event=>event.granted)).toBe(true);
    // Withdrawal is committed and independently readable before materialization resumes.
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    release();expect(await pending).toMatchObject({status:"complete",queuedCount:2});
    spy.mockRestore();
    expect(await dispatchCampaign(input,new Date(scheduled.getTime()+1000))).toMatchObject({status:"suppressed"});
    const jobs=await db.select().from(outboxJobs).where(eq(outboxJobs.kind,"email.campaign"));
    expect(jobs).toHaveLength(2);
    expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(2);
    const send=vi.fn<(message: LocalMessage) => Promise<void>>(async()=>{});
    const withdrawnJob=jobs.find(job=>job.payload.membershipId===withdrawn.id)!;
    expect(await deliverCampaignRecipient({...withdrawnJob,attempts:1},send,null)).toMatchObject({status:"suppressed",reason:"Unsubscribed"});
    expect(send).not.toHaveBeenCalled();
    const eligibleJob=jobs.find(job=>job.payload.membershipId===eligible.id)!;
    expect(await deliverCampaignRecipient({...eligibleJob,attempts:1},send,null)).toEqual({status:"complete"});
    expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0][0]).toMatchObject({to:"eligible@example.test"});
    expect(await deliverCampaignRecipient({...withdrawnJob,attempts:1},send,null)).toMatchObject({status:"suppressed"});
    expect(send).toHaveBeenCalledTimes(1);
    expect((await db.select().from(campaignRecipients)).map(row=>({membershipId:row.membershipId,status:row.status}))).toEqual(expect.arrayContaining([{membershipId:withdrawn.id,status:"suppressed"},{membershipId:eligible.id,status:"complete"}]));
    expect((await db.select().from(campaignAttempts)).map(row=>row.status).sort()).toEqual(["complete","suppressed"]);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.tenantId,foreign.merchant.tenantId))).toHaveLength(0);
  } finally {
    if(timer) clearTimeout(timer); release(); await Promise.allSettled([pending]);spy.mockRestore();
  }
});
