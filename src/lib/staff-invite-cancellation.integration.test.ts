import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { auth } from "./auth";
import { createMerchant } from "./product";
import { createStaffInvite, acceptStaffInvite } from "./staff";
import { POST as acceptRoute } from "@/app/api/staff/accept/route";
import { GET as staffGet } from "@/app/api/staff/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Disposable database required");
const origin="http://localhost:3000",password="Synthetic!Invite101Password";
beforeEach(async()=>{await pool.query('TRUNCATE tenants, "user" CASCADE');process.env.PUBLIC_REGISTRATION_ENABLED="true";});
afterAll(async()=>{await pool.end();});
function request(path:string,body?:unknown,cookie="",from=origin){return new Request(origin+path,{method:body===undefined?"GET":"POST",headers:{origin:from,"content-type":"application/json",cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});}
async function identity(){const email=randomUUID()+"@example.test";const result=await auth.api.signUpEmail({body:{name:"Synthetic invite owner",email,password}});const response=await auth.handler(request("/api/auth/sign-in/email",{email,password}));expect(response.status).toBe(200);return {id:result.user.id,email,cookie:response.headers.getSetCookie().map(c=>c.split(";")[0]).join("; ")};}
async function fixture(){const owner=await identity();const shop=await createMerchant({userId:owner.id,businessName:"Synthetic cancellation",city:"Kassel",country:"DE",timezone:"Europe/Berlin",locale:"de",currency:"EUR",programName:"Synthetic",programType:"stamp",rulesText:"One confirmed synthetic award",rewardTitle:"Coffee",rewardCost:5});return{owner,shop};}
it("lists only owner tenant invitations without credential hashes or tokens",async()=>{
 const a=await fixture(),b=await fixture(),candidate=await identity();
 const invite=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:candidate.email,role:"cashier"});
 await createStaffInvite({actorUserId:b.owner.id,locationId:b.shop.locationId,email:"foreign@example.test",role:"manager"});
 const response=await staffGet(request("/api/staff",undefined,a.owner.cookie));expect(response.status).toBe(200);
 const body=await response.json();expect(body.invitations).toEqual([expect.objectContaining({email:candidate.email,role:"cashier",locationId:a.shop.locationId,status:"pending"})]);
 expect(JSON.stringify(body)).not.toContain(invite.token);expect(JSON.stringify(body)).not.toContain("tokenHash");expect(JSON.stringify(body)).not.toContain("foreign@example.test");
 expect((await staffGet(request("/api/staff"))).status).toBe(401);
 await acceptStaffInvite({userId:candidate.id,token:invite.token});
 expect((await staffGet(request("/api/staff",undefined,candidate.cookie))).status).toBe(403);
});

it("cancels only own pending invitation and preserves accepted staff",async()=>{
 const {POST:cancel}=await import("@/app/api/staff/invite/revoke/route");
 const a=await fixture(),b=await fixture(),candidate=await identity();
 const invitation=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:candidate.email,role:"cashier"});
 const id=(await pool.query("SELECT id FROM staff_invites WHERE invited_email=$1",[candidate.email])).rows[0].id;
 const call=(cookie:string,from=origin)=>cancel(request("/api/staff/invite/revoke",{inviteId:id},cookie,from));
 expect((await call("")).status).toBe(401);expect((await call(b.owner.cookie)).status).toBe(404);expect((await call(a.owner.cookie,"https://foreign.example.test")).status).toBe(403);
 for(const response of await Promise.all([call(a.owner.cookie),call(a.owner.cookie)])){expect(response.status).toBe(200);expect(await response.json()).toEqual({inviteId:id,status:"revoked"});}
 await expect(acceptStaffInvite({userId:candidate.id,token:invitation.token})).rejects.toMatchObject({code:"INVALID_INVITE"});
 expect((await pool.query("SELECT action,subject_user_id FROM staff_audit_events WHERE invite_id=$1 ORDER BY created_at",[id])).rows).toEqual([{action:"invite_created",subject_user_id:null},{action:"access_revoked",subject_user_id:null}]);
 expect((await pool.query("SELECT * FROM staff_roles WHERE user_id=$1",[candidate.id])).rows).toHaveLength(0);
 const next=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:candidate.email,role:"cashier"});
 await acceptStaffInvite({userId:candidate.id,token:next.token});
 const accepted=(await pool.query("SELECT id FROM staff_invites WHERE invited_email=$1 AND accepted_at IS NOT NULL",[candidate.email])).rows[0].id;
 const response=await cancel(request("/api/staff/invite/revoke",{inviteId:accepted},a.owner.cookie));expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"INVITE_USED"});
 expect((await pool.query("SELECT active FROM staff_roles WHERE user_id=$1",[candidate.id])).rows).toEqual([{active:true}]);
 expect((await call(candidate.cookie)).status).toBe(403);
});

it.each(["revoke","accept"] as const)("serializes actual concurrent invitation operations when %s wins",async winner=>{
 const {POST:cancel}=await import("@/app/api/staff/invite/revoke/route");
 const a=await fixture(),candidate=await identity();
 const invite=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:candidate.email,role:"manager"});
 const id=(await pool.query("SELECT id FROM staff_invites WHERE invited_email=$1",[candidate.email])).rows[0].id;
 const revoke=()=>cancel(request("/api/staff/invite/revoke",{inviteId:id},a.owner.cookie));
 const accept=()=>acceptRoute(request("/api/staff/accept",{token:invite.token},candidate.cookie));
 let ready!:()=>void,release!:()=>void;
 const locked=new Promise<void>(resolve=>{ready=resolve;}),resume=new Promise<void>(resolve=>{release=resolve;});
 const original=Client.prototype.query;const barrier:{client?:Client;pid?:number}={};
 const spy=vi.spyOn(Client.prototype,"query").mockImplementation((function(this:Client,...args:unknown[]){
  const config=args[0],text=typeof config==="string"?config:(config as {text?:string}|undefined)?.text;
  if(!barrier.client&&text?.includes('from "staff_invites"')&&text.endsWith('for update')){
   barrier.client=this;
   return Reflect.apply(original,this,args).then(async(result:unknown)=>{
    barrier.pid=(await Reflect.apply(original,this,["SELECT pg_backend_pid() AS pid"])).rows[0].pid;ready();await resume;return result;
   });
  }
  return Reflect.apply(original,this,args);
 }) as typeof original);
 const first=winner==="revoke"?revoke():accept();let second:Promise<Response>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await Promise.race([locked,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Invite lock barrier not reached")),2000);})]);
  expect((await pool.query("SELECT state FROM pg_stat_activity WHERE pid=$1",[barrier.pid])).rows).toEqual([{state:"idle in transaction"}]);
  second=winner==="revoke"?accept():revoke();
  await vi.waitFor(async()=>{expect(Number((await pool.query("SELECT count(*) FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE '%staff_invites%' AND pid<>$1",[barrier.pid])).rows[0].count)).toBe(1);},{timeout:2000,interval:10});
  release();expect((await first).status).toBe(200);const losing=await second;expect(losing.status).toBe(400);expect(await losing.json()).toMatchObject({code:winner==="revoke"?"INVALID_INVITE":"INVITE_USED"});
  const rows=(await pool.query("SELECT active,role FROM staff_roles WHERE user_id=$1",[candidate.id])).rows;
  expect(rows).toEqual(winner==="revoke"?[]:[{active:true,role:"manager"}]);
  const events=(await pool.query("SELECT action FROM staff_audit_events WHERE invite_id=$1 ORDER BY created_at,id",[id])).rows.map(row=>row.action);
  expect(events).toEqual(["invite_created",winner==="revoke"?"access_revoked":"invite_accepted"]);
 }finally{if(timer)clearTimeout(timer);release();await Promise.allSettled([first,...(second?[second]:[])]);spy.mockRestore();}
});
it("rolls back cancellation when audit persistence fails and keeps expiry authoritative",async()=>{
 const {POST:cancel}=await import("@/app/api/staff/invite/revoke/route");const a=await fixture();
 const invite=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:"rollback@example.test",role:"cashier"});
 const id=invite.id;const original=Client.prototype.query;
 const spy=vi.spyOn(Client.prototype,"query").mockImplementation((function(this:Client,...args:unknown[]){const c=args[0],text=typeof c==="string"?c:(c as {text?:string}|undefined)?.text;return Reflect.apply(original,this,text?.startsWith('insert into "staff_audit_events"')?["SELECT 1/0"]:args);}) as typeof original);
 try{const response=await cancel(request("/api/staff/invite/revoke",{inviteId:id},a.owner.cookie));expect(response.status).toBe(500);expect(await response.json()).toEqual({error:"Internal error"});}finally{spy.mockRestore();}
 expect((await pool.query("SELECT revoked_at FROM staff_invites WHERE id=$1",[id])).rows).toEqual([{revoked_at:null}]);
 expect((await pool.query("SELECT count(*)::int AS count FROM staff_audit_events WHERE invite_id=$1",[id])).rows).toEqual([{count:1}]);
 await pool.query("UPDATE staff_invites SET expires_at='2000-01-01' WHERE id=$1",[id]);
 const response=await cancel(request("/api/staff/invite/revoke",{inviteId:id},a.owner.cookie));expect(response.status).toBe(400);expect(await response.json()).toMatchObject({code:"INVALID_INVITE"});
 expect((await pool.query("SELECT revoked_at FROM staff_invites WHERE id=$1",[id])).rows).toEqual([{revoked_at:null}]);
 const view=await staffGet(request("/api/staff",undefined,a.owner.cookie));expect((await view.json()).invitations).toEqual([expect.objectContaining({id,status:"expired"})]);
});

it.each(["cashier","manager"] as const)("denies %s invitation cancellation and metadata access",async role=>{
 const {POST:cancel}=await import("@/app/api/staff/invite/revoke/route");const a=await fixture(),staff=await identity();
 const assigned=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:staff.email,role});await acceptStaffInvite({userId:staff.id,token:assigned.token});
 const pending=await createStaffInvite({actorUserId:a.owner.id,locationId:a.shop.locationId,email:"unassigned@example.test",role:"cashier"});
 expect((await staffGet(request("/api/staff",undefined,staff.cookie))).status).toBe(403);
 expect((await cancel(request("/api/staff/invite/revoke",{inviteId:pending.id},staff.cookie))).status).toBe(403);
 expect((await pool.query("SELECT revoked_at FROM staff_invites WHERE id=$1",[pending.id])).rows).toEqual([{revoked_at:null}]);
});
