import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { nfcFixture } from "./nfc-test-db";
import { claimOutboxJob, completeWalletOutboxJob } from "./outbox";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost","127.0.0.1"].includes(database.hostname) || database.pathname !== "/looplocal_test" || database.username !== "looplocal") throw new Error("Synthetic Wallet database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });
const claim = () => claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 });
async function seed(tenant: string, member: string, options: { kind?: string; status?: string; age?: number; expired?: boolean } = {}) {
  const id = randomUUID();
  await pool.query(`INSERT INTO outbox_jobs(id,tenant_id,kind,payload,status,attempts,claim_token,created_at,next_attempt_at)
    VALUES($1,$2,$3,jsonb_build_object('membershipId',$4::text),$5,5,$6,clock_timestamp()-$7::int*interval '1 second',clock_timestamp()+$8::int*interval '1 second')`,
    [id,tenant,options.kind??"wallet.refresh",member,options.status??"processing",randomUUID(),options.age??60,options.expired===false?300:-1]);
  return id;
}
const states = async () => (await pool.query("SELECT id,status,attempts,claim_token FROM outbox_jobs ORDER BY id")).rows;
it("suppresses only expired Wallet claims covered by a same-tenant same-card equal/newer completion",async()=>{
  const own=await nfcFixture(),foreign=await nfcFixture();
  await seed(own.tenant.id,own.member.id,{status:"complete",age:30});
  const covered=await seed(own.tenant.id,own.member.id);
  const unrelated=await seed(own.tenant.id,randomUUID());
  const foreignJob=await seed(foreign.tenant.id,own.member.id);
  const nonWallet=await seed(own.tenant.id,own.member.id,{kind:"email.transactional"});
  const newer=await seed(own.tenant.id,own.member.id,{age:0});
  const active=await seed(own.tenant.id,own.member.id,{expired:false});
  const before=(await states()).find(row=>row.id===active);
  expect(await claim()).toBeNull();
  const rows=await states();
  expect(rows.find(row=>row.id===covered)).toMatchObject({status:"suppressed",attempts:5});
  for(const id of [unrelated,foreignJob,nonWallet,newer]) expect(rows.find(row=>row.id===id)).toMatchObject({status:"failed",attempts:5});
  expect(rows.find(row=>row.id===active)).toEqual(before);
});
it.each(["sweep-first","completion-first"])("converges across concurrent completion/expiry row contention (%s)",async order=>{
  const own=await nfcFixture();
  await pool.query("INSERT INTO outbox_jobs(tenant_id,kind,payload) VALUES($1,'wallet.refresh',jsonb_build_object('membershipId',$2::text))",[own.tenant.id,own.member.id]);
  const fresh=(await claim())!;expect(fresh).toBeTruthy();
  // Persisted crash-state fixture: a stopped older owner at its final expired attempt.
  const expired=await seed(own.tenant.id,own.member.id);
  const locker=await pool.connect();let swept:ReturnType<typeof claim>|undefined,completed:ReturnType<typeof completeWalletOutboxJob>|undefined;
  try {
    await locker.query("BEGIN");await locker.query("SELECT id FROM outbox_jobs WHERE id=$1 FOR UPDATE",[expired]);
    if(order==="sweep-first"){swept=claim();completed=completeWalletOutboxJob(pool,fresh);}else{completed=completeWalletOutboxJob(pool,fresh);swept=claim();}
    const deadline=Date.now()+2000;let blocked=0;
    while(blocked<2&&Date.now()<deadline){
      blocked=(await pool.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database()
        AND wait_event_type='Lock' AND (query LIKE '%UPDATE outbox_jobs AS expired%' OR query LIKE '%UPDATE outbox_jobs AS older%')`)).rows[0].n;
      if(blocked<2)await new Promise(resolve=>setTimeout(resolve,10));
    }
    expect(blocked).toBe(2);await locker.query("COMMIT");
    expect(await completed).toBe(true);expect(await swept).toBeNull();
    const rows=await states();expect(rows.find(row=>row.id===fresh.id)).toMatchObject({status:"complete",attempts:1});
    expect(rows.find(row=>row.id===expired)).toMatchObject({status:"suppressed",attempts:5});
  }finally{
    await locker.query("ROLLBACK");locker.release();await Promise.allSettled([swept,completed].filter(Boolean));
  }
});
