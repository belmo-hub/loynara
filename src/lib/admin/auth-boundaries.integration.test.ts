import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { auth, authPool } from "@/lib/auth";
import { pool } from "@/db";
vi.hoisted(() => { process.env.ADMIN_ORIGIN = "http://admin.localhost:3000"; });
const appOrigin="http://localhost:3000", adminOrigin="http://admin.localhost:3000", password="Synthetic-console-password-2026!";
const cookies=(headers: Headers)=>headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
beforeEach(async()=>{vi.stubEnv("ADMIN_ORIGIN",adminOrigin);await pool.query('TRUNCATE "user", rate_limits CASCADE');vi.stubEnv("PUBLIC_REGISTRATION_ENABLED","true");});
afterAll(async()=>{vi.unstubAllEnvs();await authPool.end();await pool.end();});
async function identity(){
 const email=`${randomUUID()}@example.test`;
 const result=await auth.api.signUpEmail({body:{email,password,name:"Synthetic account"},returnHeaders:true});
 return {email,userId:result.response.user.id,cookie:cookies(result.headers)};
}
function post(path:string,body:unknown,cookie:string,origin=appOrigin){
 return auth.handler(new Request(origin+"/api/auth"+path,{method:"POST",headers:{origin,host:new URL(origin).host,"content-type":"application/json",cookie},body:JSON.stringify(body)}));
}
async function merchant(){
 const u=await identity(),tenant=randomUUID();
 await pool.query("INSERT INTO tenants(id,name,slug) VALUES($1,'Synthetic merchant',$2)",[tenant,tenant]);
 await pool.query("INSERT INTO staff_roles(tenant_id,user_id,role) VALUES($1,$2,'owner')",[tenant,u.userId]);
 return u;
}
it("merchant owner cannot enable a second factor or change password sign-in",async()=>{
 const u=await merchant();
 const enabled=await post("/two-factor/enable",{password},u.cookie);
 expect(enabled.status).toBe(404);
 expect((await pool.query('SELECT "twoFactorEnabled" FROM "user" WHERE id=$1',[u.userId])).rows[0].twoFactorEnabled).toBe(false);
 expect((await pool.query('SELECT id FROM "twoFactor" WHERE "userId"=$1',[u.userId])).rowCount).toBe(0);
 const login=await post("/sign-in/email",{email:u.email,password},"");
 expect(login.status).toBe(200);expect(await login.json()).toHaveProperty("token");
});
it.each(["disable","get-totp-uri","generate-backup-codes","verify-totp","verify-backup-code","send-otp","verify-otp"])("refuses merchant access to /two-factor/%s",async path=>{
 const u=await merchant();const response=await post("/two-factor/"+path,{password,code:"123456"},u.cookie);
 expect(response.status).toBe(404);
});
it("refuses factor verification for a merchant resolved from a signed challenge",async()=>{
 const u=await merchant();
 // Rehearse an account with legacy factor state, without granting it a console role.
 await pool.query('UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1',[u.userId]);
 const challenge=await post("/sign-in/email",{email:u.email,password},"");
 expect(challenge.status).toBe(200);expect(await challenge.json()).toMatchObject({twoFactorRedirect:true});
 const response=await post("/two-factor/verify-totp",{code:"123456"},cookies(challenge.headers));
 expect(response.status).toBe(404);
});
async function consoleAccount(){
 const u=await identity();await pool.query("INSERT INTO platform_admins(user_id,role,granted_by) VALUES($1,'founder','operator_cli:test')",[u.userId]);return u;
}
it("refuses an admin password on the app host without creating sessions or spending the admin budget",async()=>{
 const u=await consoleAccount(),m=await merchant();
 const wrong=await post("/sign-in/email",{email:m.email,password:"wrong-password"},"");
 const generic=await wrong.json();expect(wrong.status).toBe(401);
 const before=(await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId"=$1',[u.userId])).rows[0].n;
 for(let i=0;i<6;i++){
  const response=await post("/sign-in/email",{email:u.email,password},"");
  expect(response.status).toBe(401);expect(await response.json()).toEqual(generic);
 }
 expect((await pool.query('SELECT count(*)::int AS n FROM "session" WHERE "userId"=$1',[u.userId])).rows[0].n).toBe(before);
 expect((await pool.query("SELECT hits FROM rate_limits WHERE hits>0")).rowCount).toBe(0);
 const accepted=await post("/sign-in/email",{email:u.email,password},"",adminOrigin);
 expect(accepted.status).toBe(200);expect(await accepted.json()).toHaveProperty("token");
 expect((await post("/sign-in/email",{email:m.email,password},"")).status).toBe(200);
});
it("refuses admin password sign-in when ADMIN_ORIGIN is unset",async()=>{
 const u=await consoleAccount();vi.stubEnv("ADMIN_ORIGIN","");
 const response=await post("/sign-in/email",{email:u.email,password},"",adminOrigin);
 expect(response.status).toBe(401);expect(await response.json()).toMatchObject({message:"Invalid email or password"});
 expect((await pool.query("SELECT hits FROM rate_limits WHERE hits>0")).rowCount).toBe(0);
});
it.each([["verify-totp",false],["verify-backup-code",false],["verify-totp",true],["verify-backup-code",true]] as const)("refuses admin /two-factor/%s off-host or without configuration (unset=%s)",async (path,unset)=>{
 const u=await consoleAccount();await pool.query('UPDATE "user" SET "twoFactorEnabled"=true WHERE id=$1',[u.userId]);
 const challenge=await post("/sign-in/email",{email:u.email,password},"",adminOrigin);
 expect(challenge.status).toBe(200);
 if(unset)vi.stubEnv("ADMIN_ORIGIN","");
 const response=await post("/two-factor/"+path,{code:"123456"},cookies(challenge.headers));
 expect(response.status).toBe(401);expect(await response.json()).toMatchObject({message:"Invalid email or password"});
 expect((await pool.query("SELECT hits FROM rate_limits WHERE hits>0")).rowCount).toBe(0);
});
