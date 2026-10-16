import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { pool } from "@/db";
import { requireAdmin } from "./guard";
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
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:fixture')",[user.userId]);
 const enabled=await auth.api.enableTwoFactor({headers:user.headers,body:{password}});
 if (enabled.method !== "totp") throw new Error("TOTP enrollment required");
 const encoded=new URL(enabled.totpURI).searchParams.get("secret")!;
 const otp=createOTP(new TextDecoder().decode(base32.decode(encoded)));
 const confirmed=await auth.api.verifyTOTP({headers:user.headers,body:{code:await otp.totp()},returnHeaders:true});
 await pool.query("DELETE FROM platform_admins WHERE user_id=$1",[user.userId]);
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
it("admits a founder with TOTP and a valid assertion",async()=>{const u=await founder();expect(await requireAdmin(await request(u),"home.view")).toMatchObject({userId:u.userId,email:u.email,roles:["founder"]});});
it("refuses without an assertion",async()=>{const u=await founder();await expect(requireAdmin(await request(u,{assertion:false}),"home.view")).rejects.toMatchObject({code:"NOT_FOUND"});});
it("refuses when the Access email differs from the session email",async()=>{const u=await founder();await expect(requireAdmin(await request(u,{email:"other@example.test"}),"home.view")).rejects.toMatchObject({code:"NOT_FOUND"});});
it("refuses a signed-in merchant owner",async()=>{const u=await enrolled();await expect(requireAdmin(await request(u),"home.view")).rejects.toMatchObject({code:"NOT_FOUND"});});
it("refuses an admin without TOTP",async()=>{const u=await identity();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:test')",[u.userId]);await expect(requireAdmin(await request(u),"home.view")).rejects.toMatchObject({code:"NOT_FOUND"});});
it("refuses a capability the role lacks",async()=>{const u=await enrolled();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'sales','operator_cli:test')",[u.userId]);await expect(requireAdmin(await request(u),"support.unlock")).rejects.toMatchObject({code:"NOT_FOUND"});});
it("asks for step-up on step-up capabilities",async()=>{const u=await founder();await expect(requireAdmin(await request(u),"admins.reset_2fa")).rejects.toMatchObject({code:"STEP_UP_REQUIRED"});});
it("refuses a cross-origin POST",async()=>{const u=await founder();await expect(requireAdmin(await request(u,{origin:"http://other.localhost:3000",method:"POST"}),"home.view")).rejects.toMatchObject({code:"INVALID_ORIGIN"});});
it("limits admin password failures to five per account across IPs",async()=>{
 const user=await identity();vi.stubEnv("ADMIN_ORIGIN",adminOrigin);vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 for(let attempt=0;attempt<6;attempt++){
  const result=await auth.handler(new Request(adminOrigin+"/api/auth/sign-in/email",{method:"POST",headers:{origin:adminOrigin,host:"admin.localhost:3000","content-type":"application/json","cf-connecting-ip":`192.0.2.${attempt+1}`},body:JSON.stringify({email:user.email,password:"wrong-password"})}));
  expect(result.status).toBe(attempt<5?401:429);
 }
});
it("limits admin password failures to five per IP across accounts",async()=>{
 vi.stubEnv("ADMIN_ORIGIN",adminOrigin);vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 for(let attempt=0;attempt<6;attempt++){
  const result=await auth.handler(new Request(adminOrigin+"/api/auth/sign-in/email",{method:"POST",headers:{origin:adminOrigin,host:"admin.localhost:3000","content-type":"application/json","cf-connecting-ip":"192.0.2.80"},body:JSON.stringify({email:`${randomUUID()}@example.test`,password:"wrong-password"})}));
  expect(result.status).toBe(attempt<5?401:429);
 }
});
it("refunds successful console passwords and keeps merchant sign-in independent",async()=>{
 const user=await identity();vi.stubEnv("ADMIN_ORIGIN",adminOrigin);vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 const login=(attempt:string,origin=adminOrigin)=>auth.handler(new Request(origin+"/api/auth/sign-in/email",{method:"POST",headers:{origin,host:new URL(origin).host,"content-type":"application/json","cf-connecting-ip":"192.0.2.90"},body:JSON.stringify({email:user.email,password:attempt})}));
 for(let i=0;i<6;i++)expect((await login(password)).status).toBe(200);
 expect((await pool.query("SELECT hits FROM rate_limits WHERE hits>0")).rowCount).toBe(0);
 for(let i=0;i<5;i++)expect((await login("wrong-password")).status).toBe(401);
 expect((await login("wrong-password")).status).toBe(429);
 expect((await login(password,"http://localhost:3000")).status).toBe(200);
});
it("refuses a password-only session left open before enrollment in another browser",async()=>{
 const u=await identity();
 const stale=await auth.api.signInEmail({body:{email:u.email,password},returnHeaders:true});
 const staleHeaders=new Headers({cookie:cookie(stale.headers)});
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:fixture')",[u.userId]);
 const enabled=await auth.api.enableTwoFactor({headers:u.headers,body:{password}});if(enabled.method!=="totp")throw new Error("TOTP required");
 const otp=createOTP(new TextDecoder().decode(base32.decode(new URL(enabled.totpURI).searchParams.get("secret")!)));
 await auth.api.verifyTOTP({headers:u.headers,body:{code:await otp.totp()}});
 await pool.query("DELETE FROM platform_admins WHERE user_id=$1",[u.userId]);
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:test')",[u.userId]);
 await expect(requireAdmin(await request({...u,headers:staleHeaders}),"home.view")).rejects.toMatchObject({code:"UNAUTHENTICATED"});
});
it("refuses factor-secret management from a stale password-only session",async()=>{
 const u=await identity();const stale=await auth.api.signInEmail({body:{email:u.email,password},returnHeaders:true});
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:fixture')",[u.userId]);
 const enabled=await auth.api.enableTwoFactor({headers:u.headers,body:{password}});if(enabled.method!=="totp")throw new Error("TOTP required");
 const otp=createOTP(new TextDecoder().decode(base32.decode(new URL(enabled.totpURI).searchParams.get("secret")!)));
 await auth.api.verifyTOTP({headers:u.headers,body:{code:await otp.totp()}});
 await pool.query("DELETE FROM platform_admins WHERE user_id=$1",[u.userId]);
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:test')",[u.userId]);
 const signed=await access(u.email);
 const result=await auth.handler(new Request(adminOrigin+"/api/auth/two-factor/get-totp-uri",{method:"POST",headers:{origin:adminOrigin,host:"admin.localhost:3000","content-type":"application/json",cookie:cookie(stale.headers),"cf-access-jwt-assertion":signed},body:JSON.stringify({password})}));
 expect(result.status).toBe(404);
});
it("revokes other password-only sessions when initial enrollment completes",async()=>{
 const u=await identity();const stale=await auth.api.signInEmail({body:{email:u.email,password},returnHeaders:true});
 const staleHeaders=new Headers({cookie:cookie(stale.headers)});expect(await auth.api.getSession({headers:staleHeaders})).not.toBeNull();
 await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:fixture')",[u.userId]);
 const enabled=await auth.api.enableTwoFactor({headers:u.headers,body:{password}});if(enabled.method!=="totp")throw new Error("TOTP required");
 const otp=createOTP(new TextDecoder().decode(base32.decode(new URL(enabled.totpURI).searchParams.get("secret")!)));
 const confirmed=await auth.api.verifyTOTP({headers:u.headers,body:{code:await otp.totp()},returnHeaders:true});
 expect(await auth.api.getSession({headers:new Headers({cookie:cookie(confirmed.headers)})})).not.toBeNull();
 expect(await auth.api.getSession({headers:staleHeaders})).toBeNull();
});
it("shares the admin password budget across app and console hosts",async()=>{
 const u=await founder();vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 for(let i=0;i<6;i++){
  const origin=i<5?adminOrigin:"http://localhost:3000";
  const r=await auth.handler(new Request(origin+"/api/auth/sign-in/email",{method:"POST",headers:{origin,host:new URL(origin).host,"content-type":"application/json","cf-connecting-ip":`192.0.2.${100+i}`},body:JSON.stringify({email:u.email,password:"wrong-password"})}));
  expect(r.status).toBe(i<5?401:429);
 }
});
it("shares the admin failure budget across fresh MFA challenges and factors",async()=>{
 const u=await founder();vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 for(let i=0;i<6;i++){
  const login=await auth.api.signInEmail({body:{email:u.email,password},returnHeaders:true});
  const path=i%2?"verify-backup-code":"verify-totp";
  const r=await auth.handler(new Request("http://localhost:3000/api/auth/two-factor/"+path,{method:"POST",headers:{origin:"http://localhost:3000",host:"localhost:3000","content-type":"application/json",cookie:cookie(login.headers),"cf-connecting-ip":`192.0.2.${120+i}`},body:JSON.stringify({code:i===5?u.backupCodes[0]:"wrong"})}));
  expect(r.status).toBe(i<5?401:429);
 }
});
it("shares the MFA IP budget across admin accounts",async()=>{
 const users=[await founder(),await founder()];vi.stubEnv("TRUSTED_INGRESS","cloudflare_tunnel");
 for(let i=0;i<6;i++){
  const u=users[i%2],login=await auth.api.signInEmail({body:{email:u.email,password},returnHeaders:true});
  const r=await auth.handler(new Request(adminOrigin+"/api/auth/two-factor/verify-backup-code",{method:"POST",headers:{origin:adminOrigin,host:"admin.localhost:3000","content-type":"application/json",cookie:cookie(login.headers),"cf-connecting-ip":"192.0.2.140"},body:JSON.stringify({code:i===5?u.backupCodes[0]:"wrong"})}));
  expect(r.status).toBe(i<5?401:429);
 }
});
