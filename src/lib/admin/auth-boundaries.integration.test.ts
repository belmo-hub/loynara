import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { auth, authPool } from "@/lib/auth";
import { pool } from "@/db";
vi.hoisted(() => { process.env.ADMIN_ORIGIN = "http://admin.localhost:3000"; });
const appOrigin="http://localhost:3000", adminOrigin="http://admin.localhost:3000", password="Synthetic-console-password-2026!";
const cookies=(headers: Headers)=>headers.getSetCookie().map(value=>value.split(";")[0]).join("; ");
beforeEach(async()=>{await pool.query('TRUNCATE "user", rate_limits CASCADE');vi.stubEnv("PUBLIC_REGISTRATION_ENABLED","true");});
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
