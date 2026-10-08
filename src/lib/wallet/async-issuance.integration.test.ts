import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll } from "@/lib/product";
import { POST as issue } from "@/app/api/wallet/apple/route";
import * as statusRoute from "@/app/api/wallet/status/route";
import { GET as download } from "@/app/api/wallet/apple/download/[ticket]/route";
import { refreshWalletForMembership } from "./refresh";
import { claimOutboxJob, markOutboxJob } from "@/lib/outbox";
import { createDownloadTicket } from "./ticket";
import { closeCard } from "@/lib/card-lifecycle";
import { passFastSerial } from "./passfast";
import { syntheticPassFastArchive } from "./test-support";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Requires disposable loopback database");
const origin = "http://localhost:3000", app = "11111111-1111-4111-8111-111111111111", template = "22222222-2222-4222-8222-222222222222";
const post = (path: string, token: string, extra = {}, originHeader = true) => new Request(origin+path,{method:"POST",headers:{"content-type":"application/json",...(originHeader?{origin}:{})},body:JSON.stringify({token,...extra})});
type Remote = {id:string; serial_number:string; external_id:string; app_id:string; template_id:string; wallet_type:string; status:string; dynamic_data:Record<string,unknown>};
let remote: Remote|undefined, calls: Array<{method:string;path:string}>, loseCreate=false, outage=false, pauseDownload:(()=>Promise<void>)|undefined;
const archive = () => new Response(new Uint8Array(syntheticPassFastArchive({serialNumber:remote!.serial_number,voided:false,barcodes:[{message:remote!.dynamic_data.scanCode}]})),{headers:{"Content-Type":"application/vnd.apple.pkpass"}});
async function provider(input: string|URL|Request, init?:RequestInit):Promise<Response> {
  const url = new URL(String(input)); if(url.origin!=="https://api.passfa.st") throw new Error("Real network forbidden");
  const method=init?.method??"GET"; calls.push({method,path:url.pathname});
  if(outage) return Response.json({error:"synthetic failure"},{status:503});
  if(url.pathname.endsWith("generate-pass")) {
    const body=JSON.parse(String(init?.body)); remote??={id:randomUUID(),serial_number:body.serial_number,external_id:body.external_id,app_id:app,template_id:body.template_id,wallet_type:"apple",status:"active",dynamic_data:body.data};
    if(loseCreate){loseCreate=false;throw new DOMException("synthetic lost response","TimeoutError");} return archive();
  }
  if(!remote) return Response.json({error:"missing"},{status:404});
  if(method==="PATCH"){Object.assign(remote.dynamic_data,JSON.parse(String(init?.body)).data);return Response.json({id:remote.id,status:"active"});}
  if(url.pathname.endsWith("download")){if(pauseDownload)await pauseDownload();return archive();}
  return Response.json(remote);
}
async function fixture(name="Synthetic async café") {
  const owner=randomUUID();await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)',[owner,"Synthetic owner",`${owner}@example.test`]);
  const merchant=await createMerchant({userId:owner,businessName:name,city:"Kassel",country:"DE",timezone:"Europe/Berlin",locale:"de",currency:"EUR",programName:"Coffee",programType:"stamp",rulesText:"One per purchase",rewardTitle:"Coffee",rewardCost:5});
  const member=await enroll({slug:merchant.programSlug,acceptedTerms:true});
  vi.stubEnv("PASSFAST_TENANT_TEMPLATES",JSON.stringify([{tenantId:merchant.tenantId,locationId:merchant.locationId,templateId:template}]));
  return {merchant,member};
}
async function processRefresh() {
  const job=await claimOutboxJob(pool,{maxAttempts:5,leaseMinutes:5});expect(job).not.toBeNull();
  try { const result=await refreshWalletForMembership(String(job!.payload.membershipId),{expectedTenantId:job!.tenantId}); await markOutboxJob(pool,job!,result.status,"reason" in result?result.reason:undefined); }
  catch(error){await markOutboxJob(pool,job!,"retry","synthetic provider failure",60);throw error;} return job!;
}
const status = (token:string,extra={}) => statusRoute.POST(post("/api/wallet/status",token,extra));
const projection = async (id:string) => (await pool.query("SELECT id,provider_object_id,status FROM wallet_passes WHERE membership_id=$1",[id])).rows[0];
beforeEach(async()=>{await pool.query('TRUNCATE tenants,"user",rate_limits,apple_devices CASCADE');remote=undefined;calls=[];loseCreate=outage=false;pauseDownload=undefined;for(const[k,v]of Object.entries({PASSFAST_ENABLED:"true",PASSFAST_API_KEY:"sk_live_synthetic_0123456789abcdef0123456789",PASSFAST_APP_ID:app,PASSFAST_WALLET_TYPES:"apple",APPLE_WALLET_ENABLED:"false",GOOGLE_WALLET_ENABLED:"false",PUBLIC_BASE_URL:origin}))vi.stubEnv(k,v);vi.stubGlobal("fetch",provider);});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});afterAll(()=>pool.end());
describe("managed Apple asynchronous customer workflow",()=>{
  it("returns pending without provider work and repeated issuance preserves one identity and one job",async()=>{
    const f=await fixture();outage=true;const started=Date.now();const one=await issue(post("/api/wallet/apple",f.member.cardToken));
    expect(one.status).toBe(202);expect(await one.json()).toEqual({status:"pending"});expect(Date.now()-started).toBeLessThan(1000);expect(calls).toHaveLength(0);
    const before=await projection(f.member.id);expect((await issue(post("/api/wallet/apple",f.member.cardToken))).status).toBe(202);expect(await projection(f.member.id)).toEqual(before);
    expect((await pool.query("SELECT count(*)::int n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(1);
  });
  it("protects status with same-origin current card bearer and ignores browser-selected projection identities",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));
    expect((await statusRoute.POST(post("/api/wallet/status",f.member.cardToken,{},false))).status).toBe(403);
    expect((await status("card_unknown_unknown_unknown_unknown_x")).status).toBe(404);
    const result=await(await status(f.member.cardToken,{passId:randomUUID(),tenantId:randomUUID(),locationId:randomUUID()})).json();
    expect(result).toMatchObject({apple:"available",google:"unavailable",applePass:{status:"pending"}});expect(result.applePass.url).toBeUndefined();expect(calls).toHaveLength(0);
    await closeCard(f.member.cardToken);expect((await status(f.member.cardToken)).status).toBe(404);
  });
  it("offers a fresh ticket after worker completion and download performs exactly one existing-archive GET",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await processRefresh();
    const result=await(await status(f.member.cardToken)).json();expect(result.applePass.status).toBe("ready");expect(result.applePass.url).toMatch(/^\/api\/wallet\/apple\/download\//);
    const before=calls.length;const ticket=result.applePass.url.split("/").at(-1)!;
    const response=await download(new Request(origin+result.applePass.url),{params:Promise.resolve({ticket})});expect(response.status).toBe(200);
    expect(calls.slice(before)).toEqual([{method:"GET",path:`/functions/v1/manage-passes/serial/${remote!.serial_number}/download`}]);
    const again=await(await status(f.member.cardToken)).json();expect(again.applePass.url).not.toBe(result.applePass.url);
  });
  it("refuses a ticket for a pending projection without generating or synchronizing",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));const row=await projection(f.member.id);const ticket=createDownloadTicket(row.id);
    const response=await download(new Request(origin+"/api/wallet/apple/download/"+ticket),{params:Promise.resolve({ticket})});expect(response.status).toBe(503);expect(calls).toHaveLength(0);
  });
  it("reconciles a lost generation response through the original serial and never regenerates on customer replay",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));const row=await projection(f.member.id);loseCreate=true;await expect(processRefresh()).rejects.toThrow();
    expect(remote!.serial_number).toBe(passFastSerial(row.provider_object_id));expect((await(await status(f.member.cardToken)).json()).applePass.status).toBe("pending");
    expect((await issue(post("/api/wallet/apple",f.member.cardToken))).status).toBe(202);expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
    await pool.query("UPDATE outbox_jobs SET next_attempt_at=now() WHERE kind='wallet.refresh'");await processRefresh();
    expect((await(await status(f.member.cardToken)).json()).applePass.status).toBe("ready");expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
  });
  it("reports terminal preparation failure without resetting attempts or making another provider call",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await pool.query("UPDATE outbox_jobs SET status='failed',attempts=5 WHERE kind='wallet.refresh'");
    expect((await(await status(f.member.cardToken)).json()).applePass.status).toBe("failed");expect((await issue(post("/api/wallet/apple",f.member.cardToken))).status).toBe(503);
    expect((await pool.query("SELECT status,attempts FROM outbox_jobs")).rows).toEqual([{status:"failed",attempts:5}]);expect(calls).toHaveLength(0);
  });
  it("checks closure again after archive retrieval before releasing bytes",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await processRefresh();const result=await(await status(f.member.cardToken)).json();
    pauseDownload=async()=>{await closeCard(f.member.cardToken);};const ticket=result.applePass.url.split("/").at(-1)!;
    expect((await download(new Request(origin+result.applePass.url),{params:Promise.resolve({ticket})})).status).toBe(404);
  });
  it("polls an actively processing job promptly rather than using its lease as a retry delay",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await claimOutboxJob(pool,{maxAttempts:5,leaseMinutes:5});
    expect((await(await status(f.member.cardToken)).json()).applePass).toEqual({status:"pending",retryAfterSeconds:5});
  });
  it("coalesces competing issuance requests without duplicate projections or provider calls",async()=>{
    const f=await fixture(); const results=await Promise.all(Array.from({length:6},()=>issue(post("/api/wallet/apple",f.member.cardToken))));
    expect(results.map(r=>r.status)).toEqual(Array(6).fill(202));expect(calls).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int n FROM wallet_passes")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(1);
  });
  it("rejects another tenant and another location in the pilot tenant through status and direct APIs",async()=>{
    const f=await fixture();const mapping=process.env.PASSFAST_TENANT_TEMPLATES!;const foreign=await fixture("Other tenant");vi.stubEnv("PASSFAST_TENANT_TEMPLATES",mapping);
    const locationId=randomUUID(),programId=randomUUID(),slug=randomUUID();
    await pool.query("INSERT INTO locations(id,tenant_id,name,city,country,timezone) VALUES($1,$2,'Second branch','Kassel','DE','Europe/Berlin')",[locationId,f.merchant.tenantId]);
    await pool.query("INSERT INTO programs(id,tenant_id,location_id,slug,name,type,rules_text) VALUES($1,$2,$3,$4,'Coffee two','stamp','One per purchase')",[programId,f.merchant.tenantId,locationId,slug]);
    const sibling=(await pool.query("INSERT INTO memberships(tenant_id,program_id,scan_code,card_token) VALUES($1,$2,$3,$4) RETURNING card_token AS \"cardToken\"",[f.merchant.tenantId,programId,`sc_${randomUUID()}`,`card_${randomUUID().replaceAll('-','')}`])).rows[0];
    for(const token of [foreign.member.cardToken,sibling.cardToken]){
      expect(await(await status(token,{tenantId:f.merchant.tenantId,locationId:f.merchant.locationId,templateId:template})).json()).toMatchObject({apple:"unavailable",google:"unavailable",applePass:{status:"unavailable"}});
      expect((await issue(post("/api/wallet/apple",token))).status).toBe(503);
    }
    const {POST:google}=await import("@/app/api/wallet/google/route");expect((await google(post("/api/wallet/google",f.member.cardToken))).status).toBe(503);
    expect((await pool.query("SELECT count(*)::int n FROM wallet_passes")).rows[0].n).toBe(0);expect(calls).toHaveLength(0);
  });
  it("rejects an expired ticket without provider work and mints a usable replacement",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await processRefresh();const row=await projection(f.member.id);
    const expired=createDownloadTicket(row.id,Date.now()-121_000);const before=calls.length;
    expect((await download(new Request(origin+"/api/wallet/apple/download/"+expired),{params:Promise.resolve({ticket:expired})})).status).toBe(404);expect(calls).toHaveLength(before);
    expect((await(await status(f.member.cardToken)).json()).applePass.status).toBe("ready");
  });
  it("fails closed on template remapping before and during an archive GET",async()=>{
    const f=await fixture();await issue(post("/api/wallet/apple",f.member.cardToken));await processRefresh();const result=await(await status(f.member.cardToken)).json();
    const changed=JSON.stringify([{tenantId:f.merchant.tenantId,locationId:f.merchant.locationId,templateId:"33333333-3333-4333-8333-333333333333"}]);
    const ticket=result.applePass.url.split("/").at(-1)!;pauseDownload=async()=>{vi.stubEnv("PASSFAST_TENANT_TEMPLATES",changed);};
    expect((await download(new Request(origin+result.applePass.url),{params:Promise.resolve({ticket})})).status).toBe(502);
    const before=calls.length;expect((await status(f.member.cardToken)).status).toBe(502);expect((await issue(post("/api/wallet/apple",f.member.cardToken))).status).toBe(502);
    expect((await download(new Request(origin+result.applePass.url),{params:Promise.resolve({ticket})})).status).toBe(502);expect(calls).toHaveLength(before);
  });
  it("keeps disabled managed capability private and makes no provider requests",async()=>{
    const f=await fixture();vi.stubEnv("PASSFAST_ENABLED","false");expect((await issue(post("/api/wallet/apple",f.member.cardToken))).status).toBe(503);
    expect(await(await status(f.member.cardToken)).json()).toMatchObject({apple:"unavailable",google:"unavailable",applePass:{status:"unavailable"}});
    expect(await(await statusRoute.GET()).json()).toEqual({apple:"unavailable",google:"unavailable"});expect(calls).toHaveLength(0);
  });
});
