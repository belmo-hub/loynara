import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import { auth } from "@/lib/auth";
import { db, pool } from "@/db";
import { hasSecondFactor, resetSecondFactor, verifyAdminPassword, verifyAdminSecondFactor } from "./second-factor";
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
 return {...user,headers:new Headers({host:"admin.localhost:3000",cookie:cookie(confirmed.headers)}),otp,backupCodes:enabled.backupCodes};
}
it("requires the TOTP after the password once enabled",async()=>{
 const u=await enrolled();const result=await auth.api.signInEmail({headers:{host:"admin.localhost:3000"},body:{email:u.email,password}});
 expect(result).toMatchObject({twoFactorRedirect:true});expect(result).not.toHaveProperty("token");
});
it("verifies a current TOTP and rejects a wrong one",async()=>{
 const u=await enrolled();expect(await verifyAdminSecondFactor(u.userId,await u.otp.totp())).toBe(true);expect(await verifyAdminSecondFactor(u.userId,"wrong")).toBe(false);
});
it("verifies the password and rejects a wrong one",async()=>{
 const u=await identity();expect(await verifyAdminPassword(u.userId,password)).toBe(true);expect(await verifyAdminPassword(u.userId,"wrong")).toBe(false);
});
it("backup code signs in once",async()=>{
 const u=await enrolled();expect(u.backupCodes).toHaveLength(10);
 const login=()=>auth.api.signInEmail({headers:{host:"admin.localhost:3000"},body:{email:u.email,password},returnHeaders:true});
 const first=await login();const headers=new Headers({host:"admin.localhost:3000",cookie:cookie(first.headers)});
 expect(await auth.api.verifyBackupCode({headers,body:{code:u.backupCodes[0]}})).toHaveProperty("token");
 const second=await login();await expect(auth.api.verifyBackupCode({headers:new Headers({host:"admin.localhost:3000",cookie:cookie(second.headers)}),body:{code:u.backupCodes[0]}})).rejects.toThrow();
});
it("resetSecondFactor removes the factor and the sessions",async()=>{
 const u=await enrolled();expect(await hasSecondFactor(u.userId)).toBe(true);
 await db.transaction(tx=>resetSecondFactor(tx,u.userId));expect(await hasSecondFactor(u.userId)).toBe(false);
 expect((await pool.query('SELECT id FROM "session" WHERE "userId"=$1',[u.userId])).rowCount).toBe(0);
 expect((await pool.query('SELECT id FROM "twoFactor" WHERE "userId"=$1',[u.userId])).rowCount).toBe(0);
});
it("merchant sign-in is unchanged",async()=>{const u=await identity();expect(await auth.api.signInEmail({headers:{host:"admin.localhost:3000"},body:{email:u.email,password}})).toHaveProperty("token");});
it("refuses trusted-device bypass for console second factors",async()=>{
 const u=await enrolled();await expect(auth.api.verifyTOTP({headers:u.headers,body:{code:await u.otp.totp(),trustDevice:true}})).rejects.toThrow();
});
