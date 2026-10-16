import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { pool } from "@/db";
import { touchAdminSession, performStepUp, hasFreshStepUp } from "./session";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
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
async function fixture(){
 const user=await enrolled();const session=await auth.api.getSession({headers:user.headers});if(!session)throw new Error("Session required");
 const input={sessionId:session.session.id,userId:user.userId,sessionCreatedAt:session.session.createdAt,roles:["founder" as const],ip:"192.0.2.1",userAgent:"Synthetic test",now:new Date()};
 return {...user,input};
}
it("starts and records a session once",async()=>{
 const u=await fixture();expect(await touchAdminSession(u.input)).toBe("ok");expect(await touchAdminSession(u.input)).toBe("ok");
 expect((await pool.query("SELECT id FROM admin_audit_events WHERE admin_user_id=$1 AND action='admin.session_started'",[u.userId])).rowCount).toBe(1);
});
it("expires after 1800 s idle",async()=>{
 const u=await fixture();await touchAdminSession(u.input);
 expect(await touchAdminSession({...u.input,now:new Date(u.input.now.getTime()+1801_000)})).toBe("expired");
 expect((await pool.query('SELECT id FROM "session" WHERE id=$1',[u.input.sessionId])).rowCount).toBe(0);
});
it("expires 43200 s after sign-in even when active",async()=>{
 const u=await fixture();await touchAdminSession(u.input);const now=new Date(u.input.sessionCreatedAt.getTime()+43201_000);
 await pool.query("UPDATE admin_session_activity SET last_seen_at=$2 WHERE session_id=$1",[u.input.sessionId,now]);
 expect(await touchAdminSession({...u.input,now})).toBe("expired");
});
it("step-up is valid for 300 s",async()=>{
 const u=await fixture();await touchAdminSession(u.input);await performStepUp({...u.input,password,code:await u.otp.totp()});
 expect(await hasFreshStepUp(u.input.sessionId,new Date(u.input.now.getTime()+299_000))).toBe(true);
 expect(await hasFreshStepUp(u.input.sessionId,new Date(u.input.now.getTime()+300_000))).toBe(false);
});
it("step-up does not carry over to another session",async()=>{
 const u=await fixture();await touchAdminSession(u.input);await performStepUp({...u.input,password,code:await u.otp.totp()});
 const other=randomUUID();await pool.query('INSERT INTO "session"(id,token,"userId","expiresAt","updatedAt") VALUES($1,$1,$2,now()+interval \'1 day\',now())',[other,u.userId]);
 await touchAdminSession({...u.input,sessionId:other});expect(await hasFreshStepUp(other)).toBe(false);
});
it("wrong code is refused and counted",async()=>{
 const u=await fixture();await touchAdminSession(u.input);await expect(performStepUp({...u.input,password,code:"wrong"})).rejects.toMatchObject({code:"FORBIDDEN"});
 expect((await pool.query("SELECT hits FROM rate_limits")).rows.map(r=>r.hits).sort()).toEqual([1,1]);
 expect(await hasFreshStepUp(u.input.sessionId)).toBe(false);
});
it("sixth failed step-up in 900 s is rate limited",async()=>{
 const u=await fixture();await touchAdminSession(u.input);for(let i=0;i<5;i++)await expect(performStepUp({...u.input,password,code:"wrong"})).rejects.toMatchObject({code:"FORBIDDEN"});
 await expect(performStepUp({...u.input,password,code:"wrong"})).rejects.toMatchObject({code:"RATE_LIMIT"});
});
it("does not consume another admin's account budget when the shared IP is blocked",async()=>{
 const a=await fixture(),b=await fixture();await touchAdminSession(a.input);await touchAdminSession(b.input);
 for(let i=0;i<5;i++)await expect(performStepUp({...a.input,password,code:"wrong"})).rejects.toMatchObject({code:"FORBIDDEN"});
 for(let i=0;i<6;i++)await expect(performStepUp({...b.input,password,code:await b.otp.totp()})).rejects.toMatchObject({code:"RATE_LIMIT"});
 await expect(performStepUp({...b.input,ip:"192.0.2.2",password,code:await b.otp.totp()})).resolves.toBeUndefined();
});
