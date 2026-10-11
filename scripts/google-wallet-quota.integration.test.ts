import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "../src/db";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { award } from "../src/lib/loyalty";
import { POST as issue } from "../src/app/api/wallet/google/route";
import { approveSyntheticGoogleScope, fakeGoogleApi, googleFixture, withEnv } from "../src/lib/wallet/test-support";
const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(target.hostname) || target.pathname !== "/looplocal_test" || target.username !== "looplocal") throw new Error("Owned synthetic Google database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => { vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });
it.each([429, 503])("keeps a rejected Google update recoverable and converges after a later legitimate award (%s)", async status => {
  const google = googleFixture("demo"), own = await nfcFixture(), foreign = await nfcFixture();
  const dir = mkdtempSync(path.join(tmpdir(), "loynara-google-quota-"));
  const stateFile = path.join(dir, "state.json"), preload = path.join(dir, "transport.cjs");
  // Every child request is handled here. There is no fallback to a real transport.
  writeFileSync(preload, String.raw`const fs=require('node:fs');
  globalThis.fetch=async(input,init={})=>{
    const url=new URL(String(input)),s=JSON.parse(fs.readFileSync(process.env.GOOGLE_QUOTA_STATE,'utf8'));
    if(url.origin==='https://oauth2.googleapis.com'&&url.pathname==='/token')return Response.json({access_token:'synthetic-google-access-token'});
    if(url.origin!=='https://walletobjects.googleapis.com')throw Error('External HTTP forbidden');
    const m=url.pathname.match(/\/(loyaltyClass|loyaltyObject)\/([^/]+)$/);if(!m)throw Error('Unexpected Google request');
    const id=decodeURIComponent(m[2]),store=m[1]==='loyaltyClass'?s.classes:s.objects;
    s.calls.push({kind:m[1],method:init.method,id});
    if(init.method==='PATCH'&&m[1]==='loyaltyObject'&&s.failure){fs.writeFileSync(process.env.GOOGLE_QUOTA_STATE,JSON.stringify(s));return Response.json({error:'synthetic-private-provider-details'},{status:s.failure});}
    if(init.method==='PATCH')store[id]={...store[id],...JSON.parse(init.body)};
    fs.writeFileSync(process.env.GOOGLE_QUOTA_STATE,JSON.stringify(s));return Response.json(store[id]);
  };`);
  try {
    await withEnv({ ...google.env, PUBLIC_BASE_URL: "https://wallet.example.test", PASSFAST_ENABLED: "false", APPLE_WALLET_ENABLED: "false" }, async () => {
      approveSyntheticGoogleScope({tenantId:own.tenant.id,locationId:own.location.id,programId:own.program.id});
      const api=fakeGoogleApi();vi.stubGlobal("fetch",api.fetcher);
      expect((await issue(new Request("https://wallet.example.test/api/wallet/google",{method:"POST",headers:{origin:"https://wallet.example.test","content-type":"application/json"},body:JSON.stringify({token:own.member.cardToken})}))).status).toBe(200);
      const objectId=[...api.objects.keys()][0];
      writeFileSync(stateFile,JSON.stringify({classes:Object.fromEntries(api.classes),objects:Object.fromEntries(api.objects),calls:[],failure:0}),{mode:0o600});
      const runWorker=()=>{
        const env:NodeJS.ProcessEnv={NODE_ENV:"test"};
        for(const key of ["PATH","HOME","TMPDIR","LANG","DATABASE_URL","BETTER_AUTH_SECRET","BETTER_AUTH_URL","PUBLIC_BASE_URL",...Object.keys(google.env),"GOOGLE_WALLET_LOCATION_CLASSES"])if(process.env[key]!==undefined)env[key]=process.env[key];
        Object.assign(env,{PASSFAST_ENABLED:"false",APPLE_WALLET_ENABLED:"false",EXTERNAL_EMAIL_ENABLED:"false",TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED:"false",PROMOTIONAL_EXTERNAL_EMAIL_ENABLED:"false",LIVE_BILLING_ENABLED:"false",GOOGLE_QUOTA_STATE:stateFile});
        const result=spawnSync(process.execPath,["--require",preload,"--import","tsx","scripts/worker.ts","--once"],{cwd:path.resolve(__dirname,".."),env,encoding:"utf8",timeout:15000});
        expect(result.error).toBeUndefined();expect(result.status,result.stdout+result.stderr).toBe(0);
        expect(result.stdout+result.stderr).not.toMatch(/synthetic-private-provider-details|synthetic-google-access-token|card_|sc_/);
      };
      const state=()=>JSON.parse(readFileSync(stateFile,"utf8"));
      const updateFailure=(failure:number)=>writeFileSync(stateFile,JSON.stringify({...state(),failure}));
      runWorker();
      const add=()=>award({userId:own.userId,locationId:own.location.id,membershipId:own.member.id,quantity:1,requestId:randomUUID(),idempotencyKey:randomUUID()});
      await add();updateFailure(status);runWorker();
      const [retry]=(await pool.query("SELECT id,status,attempts,next_attempt_at,last_error FROM outbox_jobs WHERE status='retry'")).rows;
      expect(retry).toMatchObject({status:"retry",attempts:1,last_error:"Wallet provider update failed or is uncertain"});
      expect(retry.next_attempt_at.getTime()-Date.now()).toBeGreaterThan(50000);
      expect(state().objects[objectId].loyaltyPoints.balance.string).toBe("0 / 8");
      // No retry timestamp or attempt is reset. New authorized work queues normally.
      await add();updateFailure(0);runWorker();
      expect(Object.keys(state().objects)).toEqual([objectId]);expect(state().objects[objectId].loyaltyPoints.balance.string).toBe("2 / 8");
      expect((await pool.query("SELECT status,attempts FROM outbox_jobs WHERE id=$1",[retry.id])).rows[0]).toEqual({status:"retry",attempts:1});
      expect((await pool.query("SELECT id,balance FROM memberships ORDER BY id")).rows).toEqual(expect.arrayContaining([{id:own.member.id,balance:2},{id:foreign.member.id,balance:0}]));
    });
  } finally {google.cleanup();rmSync(dir,{recursive:true,force:true});}
});
