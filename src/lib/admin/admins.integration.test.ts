import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { pool } from "@/db";
import { hasSecondFactor } from "./second-factor";
import { grantAdminRole, revokeAdminRole, listAdmins, resetAdminSecondFactor } from "./admins";
import { touchAdminSession, performStepUp } from "./session";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
vi.hoisted(() => { process.env.ADMIN_ORIGIN = "http://admin.localhost:3000"; });
const password="Synthetic-console-password-2026!";
const cookie=(headers: Headers)=>headers.getSetCookie().map(c=>c.split(";")[0]).join("; ");
beforeEach(async()=>{ await pool.query('TRUNCATE "user", rate_limits CASCADE');vi.stubEnv("PUBLIC_REGISTRATION_ENABLED","true"); });
afterAll(async()=>{vi.unstubAllEnvs();await pool.end();});
async function identity(){
 const email=`${randomUUID()}@example.test`;
 const result=await auth.api.signUpEmail({body:{email,password,name:"Synthetic admin"},returnHeaders:true});
 return {userId:result.response.user.id,email,headers:new Headers({host:"admin.localhost:3000",cookie:cookie(result.headers)})};
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
 return {...user,headers:new Headers({host:"admin.localhost:3000",cookie:cookie(confirmed.headers)}),otp,backupCodes:enabled.backupCodes};
}
const operator="operator_cli:synthetic";
async function founder(){
 const u=await enrolled();await grantAdminRole({email:u.email,role:"founder",operator});
 const session=await auth.api.getSession({headers:u.headers});if(!session)throw new Error("Session required");
 const input={sessionId:session.session.id,userId:u.userId,roles:["founder" as const],ip:null,userAgent:null};
 await touchAdminSession({...input,sessionCreatedAt:session.session.createdAt});await performStepUp({...input,password,code:await u.otp.totp()});
 return {...u,ctx:{...input,email:u.email}};
}
it("grants support and sales to one person",async()=>{
 const u=await identity();await grantAdminRole({email:u.email,role:"support",operator});await grantAdminRole({email:u.email,role:"sales",operator});
 expect((await listAdmins()).find(a=>a.userId===u.userId)?.roles.sort()).toEqual(["sales","support"]);
});
it("granting twice is reported as already",async()=>{const u=await identity();expect(await grantAdminRole({email:u.email,role:"support",operator})).toBe("granted");expect(await grantAdminRole({email:u.email,role:"support",operator})).toBe("already");});
it("refuses to revoke the last founder",async()=>{const u=await identity();await grantAdminRole({email:u.email,role:"founder",operator});await expect(revokeAdminRole({email:u.email,role:"founder",operator})).rejects.toMatchObject({code:"INVALID_REQUEST"});});
it("each grant and revoke writes one operator_cli audit row",async()=>{
 const u=await identity();await grantAdminRole({email:u.email,role:"support",operator});await revokeAdminRole({email:u.email,role:"support",operator});
 const result=await pool.query("SELECT actor,action FROM admin_audit_events WHERE target_id=$1 ORDER BY at,id",[u.userId]);expect(result.rows.map(r=>r.actor)).toEqual(["operator_cli","operator_cli"]);expect(result.rows.map(r=>r.action).sort()).toEqual(["admin.role_granted","admin.role_revoked"]);
});
it("reset-2fa clears the factor and writes an audit row",async()=>{
 const u=await enrolled();await grantAdminRole({email:u.email,role:"support",operator});await resetAdminSecondFactor({targetUserId:u.userId,by:{actor:"operator_cli",operator}});
 expect(await hasSecondFactor(u.userId)).toBe(false);expect((await pool.query("SELECT id FROM admin_audit_events WHERE target_id=$1 AND action='admin.two_factor_reset'",[u.userId])).rowCount).toBe(1);
});
it("founder cannot reset their own factor from the console",async()=>{const u=await founder();await expect(resetAdminSecondFactor({targetUserId:u.userId,by:{actor:"console",ctx:u.ctx,idempotencyKey:randomUUID()}})).rejects.toMatchObject({code:"INVALID_REQUEST"});});
it("same idempotency key resets once",async()=>{
 const actor=await founder(),target=await enrolled();await grantAdminRole({email:target.email,role:"support",operator});const key=randomUUID();
 const input={targetUserId:target.userId,by:{actor:"console" as const,ctx:actor.ctx,idempotencyKey:key}};await resetAdminSecondFactor(input);await resetAdminSecondFactor(input);
 expect((await pool.query("SELECT id FROM admin_audit_events WHERE target_id=$1 AND action='admin.two_factor_reset'",[target.userId])).rowCount).toBe(1);
});
it("concurrent revocations preserve one founder",async()=>{
 const first=await identity(),second=await identity();for(const u of [first,second])await grantAdminRole({email:u.email,role:"founder",operator});
 const results=await Promise.allSettled([revokeAdminRole({email:first.email,role:"founder",operator}),revokeAdminRole({email:second.email,role:"founder",operator})]);
 expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect((await listAdmins()).filter(a=>a.roles.includes("founder"))).toHaveLength(1);
});
it("refuses a reset from a context whose founder role was revoked",async()=>{
 const actor=await founder(),remaining=await identity(),target=await enrolled();await grantAdminRole({email:remaining.email,role:"founder",operator});await grantAdminRole({email:target.email,role:"support",operator});await revokeAdminRole({email:actor.email,role:"founder",operator});
 await expect(resetAdminSecondFactor({targetUserId:target.userId,by:{actor:"console",ctx:actor.ctx,idempotencyKey:randomUUID()}})).rejects.toMatchObject({code:"NOT_FOUND"});expect(await hasSecondFactor(target.userId)).toBe(true);
});
it("returns the last activity as a date for localized team display",async()=>{
 const u=await founder();const admin=(await listAdmins()).find(a=>a.userId===u.userId);expect(admin?.lastSeenAt).toBeInstanceOf(Date);expect(admin?.lastSeenAt?.toISOString()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});
