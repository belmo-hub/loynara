import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { db, pool } from "@/db";
import { recordAdminEvent, listAdminEvents } from "./audit";
import { withAdminIdempotency } from "./idempotency";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost","127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");
afterAll(()=>pool.end());
const event=(user:string)=>({actor:"console" as const,adminUserId:user,roles:["founder" as const],action:"admin.two_factor_reset" as const,summary:"Synthetic second factor reset"});
it("writes the event inside the caller's transaction",async()=>{
 const user=randomUUID();await expect(db.transaction(async tx=>{await recordAdminEvent(tx,event(user));throw new Error("rollback");})).rejects.toThrow("rollback");
 expect(await listAdminEvents({viewerUserId:user,viewAll:false,limit:50})).toEqual([]);
});
it("lists only own events unless viewAll",async()=>{
 const own=randomUUID(),other=randomUUID();await db.transaction(async tx=>{await recordAdminEvent(tx,event(own));await recordAdminEvent(tx,event(other));});
 expect((await listAdminEvents({viewerUserId:own,viewAll:false,limit:50})).map(e=>e.adminUserId)).toEqual([own]);
 const all=await listAdminEvents({viewerUserId:own,viewAll:true,limit:200});expect(all.some(e=>e.adminUserId===other)).toBe(true);
});
it("same idempotency key returns the first result and writes one audit row",async()=>{
 const user=randomUUID(),key=randomUUID();let runs=0;
 const call=()=>db.transaction(tx=>withAdminIdempotency(tx,{adminUserId:user,key,action:"admin.two_factor_reset"},async()=>{runs++;await recordAdminEvent(tx,event(user));return {reset:true};}));
 expect(await Promise.all([call(),call()])).toEqual([{reset:true},{reset:true}]);expect(runs).toBe(1);
 expect(await listAdminEvents({viewerUserId:user,viewAll:false,limit:50})).toHaveLength(1);
});
it("rejects a reused key for another action",async()=>{
 const user=randomUUID(),key=randomUUID();await db.transaction(tx=>withAdminIdempotency(tx,{adminUserId:user,key,action:"admin.role_granted"},async()=>({ok:true})));
 await expect(db.transaction(tx=>withAdminIdempotency(tx,{adminUserId:user,key,action:"admin.role_revoked"},async()=>({ok:false})))).rejects.toMatchObject({code:"INVALID_REQUEST"});
});
it("replays a write without a return value",async()=>{
 const user=randomUUID(),key=randomUUID();let runs=0;
 const call=()=>db.transaction(tx=>withAdminIdempotency(tx,{adminUserId:user,key,action:"admin.two_factor_reset"},async()=>{runs++;}));
 expect(await call()).toBeNull();expect(await call()).toBeNull();expect(runs).toBe(1);
});
