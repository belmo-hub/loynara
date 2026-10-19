import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { auth, authPool } from "@/lib/auth";
import { pool } from "@/db";
import { grantAdminRole } from "./admins";
const operator="operator_cli:synthetic";
beforeEach(async()=>{await pool.query('TRUNCATE "user", tenants, rate_limits CASCADE');vi.stubEnv("PUBLIC_REGISTRATION_ENABLED","true");});
afterAll(async()=>{vi.unstubAllEnvs();await authPool.end();await pool.end();});
async function identity(){
 const email=`${randomUUID()}@example.test`;
 const result=await auth.api.signUpEmail({body:{email,password:"Synthetic-console-password-2026!",name:"Synthetic account"}});
 return {email,userId:result.user.id};
}
async function location(){
 const tenant=randomUUID(),location=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Synthetic merchant',$2)",[tenant,tenant]);
 await pool.query("INSERT INTO locations(id,tenant_id,name,city,country,timezone) VALUES($1,$2,'Synthetic cafe','Kassel','DE','Europe/Berlin')",[location,tenant]);
 return {tenant,location};
}
async function expectNoGrant(userId:string){
 expect((await pool.query("SELECT 1 FROM platform_admins WHERE user_id=$1",[userId])).rowCount).toBe(0);
 expect((await pool.query("SELECT 1 FROM admin_audit_events WHERE target_id=$1",[userId])).rowCount).toBe(0);
}
it.each([["owner",true],["owner",false],["cashier",true],["cashier",false]] as const)("refuses a %s account with active=%s without auditing a grant",async(role,active)=>{
 const u=await identity(),l=await location();
 await pool.query("INSERT INTO staff_roles(tenant_id,user_id,role,location_id,active) VALUES($1,$2,$3,$4,$5)",[l.tenant,u.userId,role,role==='owner'?null:l.location,active]);
 await expect(grantAdminRole({email:u.email,role:"support",operator})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expectNoGrant(u.userId);
});
async function invited(status:"pending"|"accepted"|"revoked"|"expired"){
 const u=await identity(),l=await location();
 await pool.query(`INSERT INTO staff_invites(tenant_id,location_id,invited_email,role,token_hash,invited_by_user_id,expires_at,accepted_at,revoked_at)
 VALUES($1,$2,$3,'cashier',$4,$5,$6,$7,$8)`,[l.tenant,l.location,u.email.toUpperCase(),randomUUID(),u.userId,new Date(Date.now()+(status==='expired'?-3600000:3600000)),status==='accepted'?new Date():null,status==='revoked'?new Date():null]);
 return u;
}
it("refuses a pending staff invitation matched case-insensitively without auditing a grant",async()=>{
 const u=await invited("pending");
 await expect(grantAdminRole({email:u.email.toUpperCase(),role:"founder",operator})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 await expectNoGrant(u.userId);
});
it.each(["accepted","revoked","expired"] as const)("does not treat an %s invitation without a staff role as pending",async status=>{
 const u=await invited(status);expect(await grantAdminRole({email:u.email,role:"support",operator})).toBe("granted");
});
it("grants a console-only account and writes exactly one audit row",async()=>{
 const u=await identity();expect(await grantAdminRole({email:u.email,role:"founder",operator})).toBe("granted");
 expect((await pool.query("SELECT role FROM platform_admins WHERE user_id=$1",[u.userId])).rows).toEqual([{role:"founder"}]);
 expect((await pool.query("SELECT action FROM admin_audit_events WHERE target_id=$1",[u.userId])).rows).toEqual([{action:"admin.role_granted"}]);
});
it("the operator refusal explains how to create a separate console account",async()=>{
 const u=await invited("pending");
 const error=await grantAdminRole({email:u.email,role:"founder",operator}).then(()=>null,error=>error);
 expect(error).toMatchObject({code:"INVALID_REQUEST"});
 const {formatAdminOperatorError}=await import("../../../scripts/admin-operator");
 expect(formatAdminOperatorError(error)).toContain("separates Konsolenkonto");
 expect(formatAdminOperatorError(error)).toContain("operator:provision-identity");
 await expectNoGrant(u.userId);
});
