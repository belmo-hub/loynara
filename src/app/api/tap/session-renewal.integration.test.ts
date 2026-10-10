import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { nfcFixture } from "@/lib/nfc-test-db";
import { activateSecureTag, provisionSecureTag, tapCookieName, confirmTapRequest } from "@/lib/secure-tap";
import { returningCardCookieName } from "@/lib/returning-card";
import { issueCustomerSession, readCustomerSession } from "@/lib/customer-session";
import { deriveVerificationKeys, parseMaster } from "@/lib/nfc-keys";
import { sdmFor } from "@/lib/nfc-test-support";
import { GET, POST } from "./[ref]/route";
import { GET as status } from "./[ref]/status/[requestId]/route";
vi.mock("next/server",()=>({after:vi.fn()}));
const origin="http://localhost:3069", master="7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
if(!process.env.DATABASE_URL?.endsWith("/looplocal_test"))throw new Error("Isolated database required");
beforeEach(async()=>{vi.stubEnv("BETTER_AUTH_SECRET","synthetic-returning-customer-secret-at-least-32");vi.stubEnv("PUBLIC_BASE_URL",origin);vi.stubEnv("NFC_KEY_PROVIDER","derived_v1");vi.stubEnv("NFC_VERIFY_MASTER_KEY",master);vi.stubEnv("VERIFIED_RECOVERY_BEFORE_FIRST_AWARD","false");await pool.query('TRUNCATE TABLE tenants, "user", rate_limits CASCADE');});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});afterAll(()=>pool.end());
async function fixture(){
 const f=await nfcFixture({cooldownSeconds:1});const uid=`04${randomBytes(6).toString("hex")}`,keyRef=`dv1_${randomBytes(9).toString("base64url")}`;
 const tag=await provisionSecureTag({actorUserId:f.userId,programId:f.program.id,uid,keyRef,configVersion:1});await activateSecureTag({actorUserId:f.userId,tagId:tag.id});
 const keys=deriveVerificationKeys(parseMaster(master),keyRef,uid), ctx={params:Promise.resolve({ref:tag.publicRef})};
 const root=Math.floor(Date.now()/1000)-85*86400;
 const credential=issueCustomerSession(f.program.id,f.member.cardToken,false,root,root);
 const req=(counter:number,method="GET",value=credential,headers:Record<string,string>={})=>{const fields=sdmFor({uid,counter,keys});return new Request(`${origin}/api/tap/${tag.publicRef}?e=${fields.encrypted}&c=${fields.mac}`,{method,headers:{origin,cookie:`${tapCookieName(f.program.id)}=${value}`,...headers}});};
 return{...f,tag,ctx,root,credential,req};
}
async function finish(f: Awaited<ReturnType<typeof fixture>>, requestId: string, credential=f.credential, extra:Record<string,string>={}) {
 const {POST: done} = await import("./[ref]/status/[requestId]/done/route");
 return done(new Request(`${origin}/api/tap/${f.tag.publicRef}/status/${requestId}/done`,{method:"POST",headers:{origin,cookie:`${tapCookieName(f.program.id)}=${credential}`,...extra}}),{params:Promise.resolve({ref:f.tag.publicRef,requestId})});
}
function issuedCookies(response:Response){return response.headers.getSetCookie().filter(h=>!h.includes("Max-Age=0"));}
function cookieSession(cookie:string, programme:string){return readCustomerSession(cookie.split(";")[0].split("=")[1],programme)!;}
it("renews only on explicit Done after a committed cashier award; pending/GET/poll/approval/replay do not renew",async()=>{
 const f=await fixture();
 expect((await GET(f.req(1),f.ctx)).headers.getSetCookie()).toEqual([]);
 const created=await POST(f.req(1,"POST"),f.ctx), body=await created.json();expect(body.state).toBe("pending_staff");
 expect(created.headers.getSetCookie()).toEqual([]);
 expect((await finish(f,body.requestId)).status).toBe(404);
 expect((await POST(f.req(1,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 expect((await POST(f.req(2,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId:body.requestId});
 const observed=await status(new Request(`${origin}/api/tap/${f.tag.publicRef}/status/${body.requestId}`,{headers:{cookie:`${tapCookieName(f.program.id)}=${f.credential}`}}),{params:Promise.resolve({ref:f.tag.publicRef,requestId:body.requestId})});
 expect(await observed.json()).toMatchObject({state:"confirmed",requestId:body.requestId,statusRef:f.tag.publicRef});expect(observed.headers.getSetCookie()).toEqual([]);
 expect((await POST(f.req(1,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 const awardedAt=(await pool.query("SELECT created_at FROM ledger_entries WHERE membership_id=$1 AND kind='award'",[f.member.id])).rows[0].created_at as Date;
 const response=await finish(f,body.requestId);expect(response.status).toBe(200);expect(await response.json()).toEqual({renewed:true});
 const cookies=issuedCookies(response);expect(cookies).toHaveLength(2);
 for(const c of cookies)expect(cookieSession(c,f.program.id)).toMatchObject({issued:f.root,lastActivity:Math.floor(awardedAt.getTime()/1000),shared:false});
 const renewed=cookies.find(c=>c.startsWith(tapCookieName(f.program.id)+"="))!.split(";")[0].split("=")[1];
 const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+4*86400_000);
 const repeated=await finish(f,body.requestId,renewed);expect(await repeated.json()).toEqual({renewed:false});expect(repeated.headers.getSetCookie()).toEqual([]);
 const oldCookieReplay=await finish(f,body.requestId);expect(oldCookieReplay.status).toBe(200);
 for(const c of issuedCookies(oldCookieReplay))expect(cookieSession(c,f.program.id).lastActivity).toBe(Math.floor(awardedAt.getTime()/1000));
 expect((await pool.query("SELECT delta FROM ledger_entries WHERE membership_id=$1 AND kind='award'",[f.member.id])).rows).toEqual([{delta:1}]);
});
it("requires valid current membership, committed cashier status and same-origin identity",async()=>{
 const f=await fixture();const response=await POST(f.req(1,"POST"),f.ctx);expect(response.headers.getSetCookie()).toEqual([]);const {requestId}=await response.json();
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId});
 expect((await finish(f,requestId,f.credential,{origin:"https://foreign.example.test"})).status).toBe(403);
 expect((await finish(f,requestId,f.credential+"x")).headers.getSetCookie()).toEqual([]);
 const other=await fixture();expect((await finish(f,requestId,other.credential)).status).toBe(404);
 for(const state of ["pending_staff","cancelled","expired","cooldown","awarded"]){await pool.query("UPDATE tap_requests SET status=$2 WHERE id=$1",[requestId,state]);expect((await finish(f,requestId)).status).toBe(404);}
 await pool.query("UPDATE tap_requests SET status='confirmed' WHERE id=$1",[requestId]);
 await pool.query("UPDATE memberships SET closed_at=now() WHERE id=$1",[f.member.id]);expect((await finish(f,requestId)).status).toBe(404);
});
it("keeps the earliest root and shared selection across both cookie scopes on Done",async()=>{
 const f=await fixture(),oldRoot=f.root-20*86400;
 const broad=issueCustomerSession(f.program.id,f.member.cardToken,true,oldRoot,f.root);
 const headers={cookie:`${tapCookieName(f.program.id)}=${f.credential}; ${returningCardCookieName(f.program.id)}=${broad}`};
 await expect((await GET(f.req(1,"GET",f.credential,headers),f.ctx)).json()).resolves.toMatchObject({requiresSelection:true});
 const created=await POST(f.req(1,"POST",f.credential,{...headers,"x-loynara-card-selected":`K-${f.member.cardLocator}`}),f.ctx);expect(created.headers.getSetCookie()).toEqual([]);const {requestId}=await created.json();
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId});
 expect((await finish(f,requestId,f.credential,headers)).status).toBe(409);
 const accepted=await finish(f,requestId,f.credential,{...headers,"x-loynara-card-selected":`K-${f.member.cardLocator}`});expect(accepted.status).toBe(200);expect(issuedCookies(accepted)).toHaveLength(2);
 for(const c of issuedCookies(accepted))expect(cookieSession(c,f.program.id)).toMatchObject({issued:oldRoot,shared:true});
});
it("cannot revive inactivity or absolute expiry, or a reissued membership",async()=>{
 const f=await fixture(),{requestId}=await (await POST(f.req(1,"POST"),f.ctx)).json();await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId});
 const now=Date.now(),absolute=issueCustomerSession(f.program.id,f.member.cardToken,false,Math.floor(now/1000)-355*86400,Math.floor(now/1000));
 const clock=vi.spyOn(Date,"now").mockReturnValue(now+10*86400_000);
 expect((await finish(f,requestId)).status).toBe(404);expect((await finish(f,requestId,absolute)).status).toBe(404);
 clock.mockReturnValue(now);await pool.query("UPDATE memberships SET card_token=$2 WHERE id=$1",[f.member.id,`card_${randomBytes(32).toString("base64url")}`]);expect((await finish(f,requestId)).status).toBe(404);
});

it.each(["request_id","source","delta"] as const)("rejects a confirmed request with incompatible committed ledger %s",async column=>{
 const f=await fixture(),{requestId}=await (await POST(f.req(1,"POST"),f.ctx)).json();
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId});
 // Ledger history is append-only. Seed a separate incompatible event and misbind the request fixture;
 // never disable the production ledger trigger to manufacture this negative case.
 const ledgerId=randomUUID();
 await pool.query("INSERT INTO ledger_entries(id,tenant_id,location_id,membership_id,delta,kind,source,actor_user_id,request_id,idempotency_key) VALUES($1,$2,$3,$4,$5,'award',$6,$7,$8,$9)",[ledgerId,f.tenant.id,f.location.id,f.member.id,column==="delta"?2:1,column==="source"?"staff_offline":"staff_online",f.userId,column==="request_id"?randomUUID():requestId,randomUUID()]);
 await pool.query("UPDATE tap_requests SET ledger_entry_id=$2 WHERE id=$1",[requestId,ledgerId]);
 const response=await finish(f,requestId);expect(response.status).toBe(404);expect(response.headers.getSetCookie()).toEqual([]);
});
