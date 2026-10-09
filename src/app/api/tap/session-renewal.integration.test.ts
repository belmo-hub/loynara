import { randomBytes } from "node:crypto";
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
it("renews only a newly created verified customer request; cashier, polling, GET, replay and pending resume do not renew",async()=>{
 const f=await fixture();
 expect((await GET(f.req(1),f.ctx)).headers.getSetCookie()).toEqual([]);
 const created=await POST(f.req(1,"POST"),f.ctx), body=await created.json();expect(body.state).toBe("pending_staff");
 const cookies=created.headers.getSetCookie().filter(h=>!h.includes("Max-Age=0"));expect(cookies).toHaveLength(2);
 for(const name of [tapCookieName(f.program.id),returningCardCookieName(f.program.id)]){const value=cookies.find(h=>h.startsWith(name+"="))!.split(";")[0].split("=")[1];expect(readCustomerSession(value,f.program.id)).toMatchObject({issued:f.root,shared:false});expect(readCustomerSession(value,f.program.id)!.lastActivity!>f.root).toBe(true);expect(value).not.toBe(f.credential);}
 expect(body).not.toHaveProperty("sessionActivity");
 expect((await POST(f.req(1,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 expect((await POST(f.req(2,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 await confirmTapRequest({userId:f.userId,locationId:f.location.id,requestId:body.requestId});
 const observed=await status(new Request(`${origin}/api/tap/${f.tag.publicRef}/status/${body.requestId}`,{headers:{cookie:`${tapCookieName(f.program.id)}=${f.credential}`}}),{params:Promise.resolve({ref:f.tag.publicRef,requestId:body.requestId})});
 expect((await observed.json()).state).toBe("confirmed");expect(observed.headers.getSetCookie()).toEqual([]);
 expect((await POST(f.req(1,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 expect((await pool.query("SELECT delta FROM ledger_entries WHERE membership_id=$1 AND kind='award'",[f.member.id])).rows).toEqual([{delta:1}]);
});
it("denies missing, expired, tampered and shared-unselected credentials without renewal",async()=>{
 const f=await fixture();
 expect((await POST(new Request(f.req(1).url,{method:"POST",headers:{origin}}),f.ctx)).headers.getSetCookie()).toEqual([]);
 const shared=issueCustomerSession(f.program.id,f.member.cardToken,true,f.root,f.root);
 expect((await POST(f.req(1,"POST",shared),f.ctx)).status).toBe(409);
 const approved=await POST(f.req(1,"POST",shared,{"x-loynara-card-selected":`K-${f.member.cardLocator}`}),f.ctx);
 expect(approved.status).toBe(200);expect(approved.headers.getSetCookie().filter(h=>!h.includes("Max-Age=0"))).toHaveLength(2);for(const c of approved.headers.getSetCookie().filter(h=>!h.includes("Max-Age=0")))expect(readCustomerSession(c.split(";")[0].split("=")[1],f.program.id)?.shared).toBe(true);
 const now=Date.now();vi.spyOn(Date,"now").mockReturnValue(now+10*86400_000);
 expect((await POST(f.req(3,"POST"),f.ctx)).headers.getSetCookie()).toEqual([]);
 expect((await POST(f.req(3,"POST",f.credential+"x"),f.ctx)).headers.getSetCookie()).toEqual([]);
});

it("reconciles a broader signed root and shared flag before selection and renewal",async()=>{
 const f=await fixture(), oldRoot=f.root-20*86400;
 const broad=issueCustomerSession(f.program.id,f.member.cardToken,true,oldRoot,f.root);
 const headers={cookie:`${tapCookieName(f.program.id)}=${f.credential}; ${returningCardCookieName(f.program.id)}=${broad}`};
 await expect((await GET(f.req(1,"GET",f.credential,headers),f.ctx)).json()).resolves.toMatchObject({requiresSelection:true});
 expect((await POST(f.req(1,"POST",f.credential,headers),f.ctx)).status).toBe(409);
 const accepted=await POST(f.req(1,"POST",f.credential,{...headers,"x-loynara-card-selected":`K-${f.member.cardLocator}`}),f.ctx);
 expect(accepted.status).toBe(200);
 for(const c of accepted.headers.getSetCookie().filter(h=>!h.includes("Max-Age=0")))expect(readCustomerSession(c.split(";")[0].split("=")[1],f.program.id)).toMatchObject({issued:oldRoot,shared:true});
});
