import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { pool } from "@/db";
import { POST as stepUp } from "@/app/api/admin/step-up/route";
import { POST as resetFactor } from "@/app/api/admin/admins/[userId]/reset-2fa/route";
import { hasFreshStepUp } from "./session";
import { sanitizeAdminNext } from "@/components/admin/paths";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
vi.hoisted(() => { process.env.ADMIN_ORIGIN = "http://admin.localhost:3000"; });
const password="Synthetic-console-password-2026!";
const cookie=(headers: Headers)=>headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
beforeEach(async()=>{ await pool.query('TRUNCATE "user", rate_limits CASCADE');vi.stubEnv("PUBLIC_REGISTRATION_ENABLED","true"); });
afterAll(async()=>{vi.unstubAllEnvs();await pool.end();});
async function identity(){
 const email=`${randomUUID()}@example.test`;
 const result=await auth.api.signUpEmail({body:{email,password,name:"Synthetic admin"},returnHeaders:true});
 return {userId:result.response.user.id,email,headers:new Headers({cookie:cookie(result.headers)})};
}
async function enrolled(){
 const user=await identity();
 const enabled=await auth.api.enableTwoFactor({headers:user.headers,body:{password}});
 if (enabled.method !== "totp") throw new Error("TOTP enrollment required");
 const encoded=new URL(enabled.totpURI).searchParams.get("secret")!;
 const otp=createOTP(new TextDecoder().decode(base32.decode(encoded)));
 const confirmed=await auth.api.verifyTOTP({headers:user.headers,body:{code:await otp.totp()},returnHeaders:true});
 return {...user,headers:new Headers({cookie:cookie(confirmed.headers)}),otp,backupCodes:enabled.backupCodes};
}
const adminOrigin="http://admin.localhost:3000";
async function access(email:string){
 const keys=await generateKeyPair("ES256");vi.stubEnv("ADMIN_ORIGIN",adminOrigin);vi.stubEnv("ADMIN_ACCESS_MODE","local_test");vi.stubEnv("ADMIN_ALLOWED_EMAILS",email);vi.stubEnv("ADMIN_ACCESS_TEST_JWKS",JSON.stringify({keys:[await exportJWK(keys.publicKey)]}));
 return new SignJWT({email}).setProtectedHeader({alg:"ES256"}).setIssuer("https://loynara-local-access.invalid").setAudience("loynara-local-admin").setExpirationTime("1h").sign(keys.privateKey);
}
async function request(user:Awaited<ReturnType<typeof identity>>,options:{assertion?:boolean;email?:string;origin?:string;method?:string}={}){
 const signed=await access(options.email??user.email);const headers=new Headers(user.headers);if(options.assertion!==false)headers.set("cf-access-jwt-assertion",signed);if(options.origin)headers.set("origin",options.origin);
 return new Request(adminOrigin+"/api/admin/test",{method:options.method??"GET",headers});
}
async function founder(){const u=await enrolled();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:test')",[u.userId]);return u;}
async function apiRequest(u:Awaited<ReturnType<typeof identity>>,path:string,body:unknown){
 const base=await request(u,{origin:adminOrigin,method:"POST"});const headers=new Headers(base.headers);headers.set("content-type","application/json");return new Request(adminOrigin+path,{method:"POST",headers,body:JSON.stringify(body)});
}
it("step-up endpoint sets a fresh step-up for this session",async()=>{
 const u=await founder();const result=await stepUp(await apiRequest(u,"/api/admin/step-up",{password,code:await u.otp.totp()}));expect(result.status).toBe(200);
 const session=await auth.api.getSession({headers:u.headers});expect(await hasFreshStepUp(session!.session.id)).toBe(true);
});
it("step-up endpoint rejects unknown fields",async()=>{
 const u=await founder();expect((await stepUp(await apiRequest(u,"/api/admin/step-up",{password,code:await u.otp.totp(),extra:true}))).status).toBe(400);
});
it("reset endpoint requires step-up",async()=>{
 const u=await founder();const result=await resetFactor(await apiRequest(u,"/api/admin/admins/other/reset-2fa",{idempotencyKey:randomUUID()}),{params:Promise.resolve({userId:"other"})});expect(result.status).toBe(403);expect(await result.json()).toMatchObject({code:"STEP_UP_REQUIRED"});
});
it("reset endpoint refuses support and sales",async()=>{
 for(const role of ["support","sales"]){const u=await enrolled();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,$2,'operator_cli:test')",[u.userId,role]);
 expect((await resetFactor(await apiRequest(u,"/api/admin/admins/other/reset-2fa",{idempotencyKey:randomUUID()}),{params:Promise.resolve({userId:"other"})})).status).toBe(404);}
});
it("reset endpoint resets once per idempotency key",async()=>{
 const u=await founder(),target=await enrolled();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'support','operator_cli:test')",[target.userId]);
 expect((await stepUp(await apiRequest(u,"/api/admin/step-up",{password,code:await u.otp.totp()}))).status).toBe(200);
 const body={idempotencyKey:randomUUID()};for(let i=0;i<2;i++) {
  const result=await resetFactor(await apiRequest(u,`/api/admin/admins/${target.userId}/reset-2fa`,body),{params:Promise.resolve({userId:target.userId})});
  expect(result.status,JSON.stringify(await result.json())).toBe(200);
 }
 expect(await auth.api.getSession({headers:target.headers})).toBeNull();expect((await pool.query("SELECT id FROM admin_audit_events WHERE target_id=$1 AND action='admin.two_factor_reset'",[target.userId])).rowCount).toBe(1);
});
it("step-up next parameter only accepts relative admin paths",()=>{
 expect(sanitizeAdminNext("/admin/team")).toBe("/admin/team");for(const value of ["https://evil.example","//evil","/merchant","/admin/../../merchant","/admin\\..\\merchant"])expect(sanitizeAdminNext(value)).toBe("/admin");
});
