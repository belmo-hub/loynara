import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, walletPasses } from "@/db/schema";
import { eq } from "drizzle-orm";
import { nfcFixture } from "./nfc-test-db";
import { parseMaster, deriveTagKeys } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { activateSecureTag, provisionSecureTag, tapCookieName, confirmTapRequest } from "./secure-tap";
import { returningCardCookieName } from "./returning-card";
import { issueCustomerSession, readCustomerSession } from "./customer-session";
import { award } from "./loyalty";
import { GET, POST } from "@/app/api/tap/[ref]/route";
import { POST as bind } from "@/app/api/card/[token]/tap-session/route";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw Error("Isolated database required");
const master="7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
const origin="http://localhost:3000", start=1791547200;
beforeEach(async()=>{
  vi.stubEnv("BETTER_AUTH_SECRET","synthetic-customer-renewal-secret-at-least-32");
  vi.stubEnv("PUBLIC_BASE_URL",origin);vi.stubEnv("NFC_ENABLED","true");vi.stubEnv("NFC_KEY_PROVIDER","derived_v1");vi.stubEnv("NFC_VERIFY_MASTER_KEY",master);
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE');
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();});
afterAll(()=>pool.end());
async function fixture(paid=true){
 const f=await nfcFixture({cooldownSeconds:1});
 const uid=`04${randomBytes(6).toString("hex")}`,keyRef=`dv1_${randomBytes(9).toString("base64url")}`;
 const tag=await provisionSecureTag({actorUserId:f.userId,programId:f.program.id,uid,keyRef,configVersion:1});
 await activateSecureTag({actorUserId:f.userId,tagId:tag.id});
 const keys=deriveTagKeys({verifyMaster:parseMaster(master),adminMaster:parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e"),ref:keyRef,uid});
 if(paid)await award({userId:f.userId,locationId:f.location.id,membershipId:f.member.id,quantity:1,requestId:randomUUID(),idempotencyKey:randomUUID()});
 return {...f,ref:tag.publicRef,path:(counter:number)=>{const s=sdmFor({uid,counter,keys});return `/api/tap/${tag.publicRef}?e=${s.encrypted}&c=${s.mac}`;}};
}
function cookies(f:Awaited<ReturnType<typeof fixture>>,issued=start,active=issued,shared=false){
 const value=issueCustomerSession(f.program.id,f.member.cardToken,shared,issued,active);
 return `${tapCookieName(f.program.id)}=${value}; ${returningCardCookieName(f.program.id)}=${value}`;
}
function request(path:string,cookie:string,method="POST",interactive=true,body?:unknown){return new Request(origin+path,{method,headers:{origin,cookie,...(interactive?{"x-loynara-customer-interaction":"nfc_visit"}:{}),...(body?{"content-type":"application/json"}:{})},body:body?JSON.stringify(body):undefined});}
function renewed(response:Response,programId:string){const header=response.headers.getSetCookie().find(x=>x.startsWith(tapCookieName(programId)+"="));return header?readCustomerSession(header.split(";")[0].split("=")[1],programId):undefined;}
it("renews both customer scopes on a fresh authenticated visit; replay, GET and background requests cannot renew",async()=>{
 const f=await fixture();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime((start+85*86400)*1000);
 const cookie=cookies(f);const ctx={params:Promise.resolve({ref:f.ref})};
 expect((await GET(request(f.path(1),cookie,"GET"),ctx)).headers.getSetCookie()).toEqual([]);
 const response=await POST(request(f.path(1),cookie),ctx);const result=await response.json();expect(result.state).toBe("pending_staff");
 expect(renewed(response,f.program.id)).toMatchObject({token:f.member.cardToken,issued:start,active:start+85*86400,shared:false});
 expect(response.headers.getSetCookie().filter(x=>!x.includes("Max-Age=0"))).toHaveLength(2);
 expect((await POST(request(f.path(1),cookie),ctx)).headers.getSetCookie()).toEqual([]);
 expect((await POST(request(f.path(2),cookie,"POST",false),ctx)).headers.getSetCookie()).toEqual([]);
 // The customer response sets its cookies before any cashier response exists.
 expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId,f.member.id))).map(r=>r.delta)).toEqual([1]);
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId:result.requestId});
 const rows=await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId,f.member.id));expect(rows.map(r=>r.delta)).toEqual([1,1]);
});
it("does not renew a first or unqualified award, a foreign merchant session or a reused pending request",async()=>{
 const f=await fixture(false),other=await fixture();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime((start+85*86400)*1000);const ctx={params:Promise.resolve({ref:f.ref})};
 const first=await POST(request(f.path(1),cookies(f)),ctx);expect((await first.json()).state).toBe("pending_staff");expect(first.headers.getSetCookie()).toEqual([]);
 expect((await POST(request(f.path(2),cookies(f)),ctx)).headers.getSetCookie()).toEqual([]);
 const foreign=await POST(request(f.path(3),cookies(other)),ctx);expect((await foreign.json()).state).toBe("needs_enrollment");expect(foreign.headers.getSetCookie()).toEqual([]);
});
it("never renews an expired activity or absolute lifetime; explicit private-link authentication starts a new lifetime",async()=>{
 const f=await fixture();const ctx={params:Promise.resolve({ref:f.ref})};vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime(start*1000);const cookie=cookies(f);
 vi.setSystemTime((start+90*86400)*1000);const expired=await POST(request(f.path(1),cookie),ctx);expect((await expired.json()).state).toBe("needs_enrollment");expect(expired.headers.getSetCookie()).toEqual([]);
 const path=`/api/tap/card/${f.member.cardToken}/session`,bindCtx={params:Promise.resolve({token:f.member.cardToken})};
 expect((await bind(request(path,cookie),bindCtx)).status).toBe(409);
 const explicit=await bind(request(path,cookie,"POST",false,{authenticate:true}),bindCtx);expect(explicit.status).toBe(200);expect(renewed(explicit,f.program.id)?.issued).toBe(start+90*86400);
 vi.setSystemTime((start+350*86400)*1000);const old=cookies(f,start,start+350*86400);
 vi.setSystemTime((start+365*86400)*1000);expect((await POST(request(f.path(2),old),ctx)).headers.getSetCookie()).toEqual([]);
 expect((await bind(request(path,old),bindCtx)).status).toBe(409);
});
it("caps cookie Max-Age at the original absolute deadline and preserves shared choice and Wallet identity",async()=>{
 const f=await fixture();const passId=randomUUID();await db.insert(walletPasses).values({id:passId,tenantId:f.tenant.id,membershipId:f.member.id,provider:"apple",providerObjectId:"passfast:synthetic_renewal",status:"active"});
 vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime((start+350*86400)*1000);const cookie=cookies(f,start,start+300*86400,true);const ctx={params:Promise.resolve({ref:f.ref})};
 const selected=request(f.path(1),cookie);selected.headers.set("x-loynara-card-selected",`K-${f.member.cardLocator}`);
 const response=await POST(selected,ctx);expect(response.status).toBe(200);expect(renewed(response,f.program.id)).toMatchObject({issued:start,active:start+350*86400,shared:true});
 expect(response.headers.getSetCookie().filter(x=>!x.includes("Max-Age=0")).every(x=>x.includes("Max-Age=1296000"))).toBe(true);
 expect((await db.select().from(walletPasses).where(eq(walletPasses.id,passId)))[0]).toMatchObject({membershipId:f.member.id,status:"active"});
 expect((await db.select().from(memberships).where(eq(memberships.id,f.member.id)))[0].cardLocator).toBe(f.member.cardLocator);
});

it("requires shared-device selection when either same-card scope is shared",async()=>{
 const f=await fixture();vi.useFakeTimers({toFake:["Date"]});vi.setSystemTime((start+85*86400)*1000);
 const personal=issueCustomerSession(f.program.id,f.member.cardToken,false,start),shared=issueCustomerSession(f.program.id,f.member.cardToken,true,start);
 const cookie=`${tapCookieName(f.program.id)}=${personal}; ${returningCardCookieName(f.program.id)}=${shared}`,ctx={params:Promise.resolve({ref:f.ref})};
 const info=await GET(request(f.path(1),cookie,"GET"),ctx);expect((await info.json()).requiresSelection).toBe(true);
 const blocked=await POST(request(f.path(1),cookie),ctx);expect(blocked.status).toBe(409);expect(blocked.headers.getSetCookie()).toEqual([]);
 expect((await pool.query("SELECT count(*)::int n FROM tap_requests WHERE membership_id=$1",[f.member.id])).rows[0].n).toBe(0);
});
