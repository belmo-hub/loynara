import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { closeCard } from "@/lib/card-lifecycle";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { award } from "@/lib/loyalty";
import { updateMerchantBrand } from "@/lib/merchant-brand";
import { createMerchant, enroll, updateProgram, editReward } from "@/lib/product";
import { POST as googleIssue } from "@/app/api/wallet/google/route";
import { POST as appleIssue } from "@/app/api/wallet/apple/route";
import { GET as download } from "@/app/api/wallet/apple/download/[ticket]/route";
import { issueWalletPass } from "./issue";
import { ownerWalletReadiness } from "./readiness";
import { refreshWalletForMembership } from "./refresh";
import { passFastObjectId } from "./passfast";
import { syncPassFastPass } from "./passfast-lifecycle";
import { syntheticPassFastArchive } from "./test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const origin = "http://localhost:3000";
const post = (token: string, platform = "google") => new Request(`${origin}/api/wallet/${platform}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
type Remote = { id: string; serial_number: string; wallet_type: string; status: string; dynamic_data: Record<string, unknown>; google_save_url?: string };
let outagePlatform: string | undefined;
let failingVoids = new Set<string>();
let pauseUpdate: (() => Promise<void>) | undefined, pauseDownload: (() => Promise<void>) | undefined;
let rows: Map<string, Remote>, calls: Array<{ path: string; body: Record<string, unknown> | null }>, loseGenerate: boolean, loseVoid: boolean, outage: boolean;
let failedAppleRebuild = false;
const pkpass = (row: Remote) => new Response(new Uint8Array(syntheticPassFastArchive({serialNumber:row.serial_number,
  voided:row.status==="invalidated"&&!failedAppleRebuild,barcodes:row.dynamic_data.scanCode?[{message:row.dynamic_data.scanCode}]:[]})),
  { headers: { "Content-Type": "application/vnd.apple.pkpass" } });
async function fake(input: string | URL | Request, options?: RequestInit): Promise<Response> {
  const url = new URL(String(input));
  if (url.origin !== "https://api.passfa.st") throw new Error("Real network forbidden");
  const body = options?.body ? JSON.parse(String(options.body)) as Record<string, unknown> : null;
  calls.push({ path: url.pathname + url.search, body });
  if (outage || (outagePlatform && url.searchParams.get("wallet_type") === outagePlatform)) return Response.json({ error: "synthetic outage" }, { status: 503 });
  if (url.pathname.endsWith("/generate-pass")) {
    const serial = String(body?.serial_number), platform = String(body?.wallet_type), key = serial + platform;
    let row = rows.get(key);
    if (!row) { row = { id: randomUUID(), serial_number: serial, wallet_type: platform, status: "active", dynamic_data: body!.data as Record<string, unknown>, ...(platform === "google" ? { google_save_url: "https://pay.google.com/gp/v/save/synthetic" } : {}) }; rows.set(key, row); }
    if (loseGenerate) { loseGenerate = false; throw new DOMException("Synthetic timeout after create", "TimeoutError"); }
    return platform === "apple" ? pkpass(row) : Response.json({ save_url: row.google_save_url }, { status: 201 });
  }
  const serial = url.pathname.split("/")[5], platform = url.searchParams.get("wallet_type")!;
  const row = rows.get(serial + platform);
  if (!row) return Response.json({ error: "missing" }, { status: 404 });
  if (options?.method === "PATCH") {
    if (row.status !== "active") return Response.json({ error: "not_active" }, { status: 409 });
    if (pauseUpdate && (body?.data as Record<string,unknown>)?.scanCode) await pauseUpdate();
    Object.assign(row.dynamic_data, body?.data);
    return Response.json({ id: row.id, status: row.status });
  }
  if (url.pathname.endsWith("/void")) {
    if (failingVoids.has(platform)) return Response.json({error:"synthetic void outage"},{status:503});
    if (row.status === "invalidated") return Response.json({ error: "already_voided" }, { status: 409 });
    row.status = "invalidated";
    if (loseVoid) { loseVoid = false; throw new DOMException("Synthetic timeout after void", "TimeoutError"); }
    return Response.json({ id: row.id, status: row.status, pkpass_rebuilt: !failedAppleRebuild });
  }
  if (url.pathname.endsWith("/download")) { if (pauseDownload) await pauseDownload(); return pkpass(row); }
  return Response.json(row);
}
async function fixture() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner,"Synthetic PassFast owner",`${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Coffee", programType: "stamp", rulesText: "One per purchase", rewardTitle: "Coffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { owner, merchant, member };
}
const reissue = (f: Awaited<ReturnType<typeof fixture>>) => reissueCardByStaff({ actorUserId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, reason: "Synthetic lost phone verification", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
const snapshot = async (member: string) => (await pool.query("SELECT to_jsonb(m) AS member, (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM ledger_entries l WHERE membership_id=$1) AS ledger FROM memberships m WHERE id=$1", [member])).rows[0];
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE');
  rows = new Map(); calls = []; loseGenerate = loseVoid = outage = false; pauseUpdate = pauseDownload = undefined; outagePlatform = undefined; failingVoids = new Set(); failedAppleRebuild = false;
  for (const [name,value] of Object.entries({ PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: randomUUID(), PASSFAST_TEMPLATE_ID: randomUUID(), PUBLIC_BASE_URL: origin })) vi.stubEnv(name,value);
  vi.stubGlobal("fetch", vi.fn(fake));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

describe("PassFast projection through real isolated transactions and fake HTTP", () => {
  it("duplicate issuance shares a serial and one durable pending job", async () => {
    const f = await fixture();
    for (let i=0;i<2;i++) expect((await googleIssue(post(f.member.cardToken))).status).toBe(200);
    expect(rows.size).toBe(1);
    expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh' AND status='pending'")).rows[0].n).toBe(1);
  });
  it("shares a generation serial across Apple and Google without sharing local auth tickets", async () => {
    const f=await fixture(); await appleIssue(post(f.member.cardToken,"apple")); await googleIssue(post(f.member.cardToken));
    const passes=(await pool.query("SELECT id,provider,provider_object_id FROM wallet_passes ORDER BY provider")).rows;
    expect(passes).toHaveLength(2); expect(passes[0].id).not.toBe(passes[1].id);
    expect(passes[0].provider_object_id).toBe(passes[1].provider_object_id);
    await reissue(f); const after=await issueWalletPass((await snapshot(f.member.id)).member.card_token,"google",passFastObjectId);
    expect(after.providerObjectId).not.toBe(passes[0].provider_object_id);
  });
  it("recovers provider success with a lost local response without creating another pass", async () => {
    const f = await fixture(); loseGenerate = true;
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(502);
    expect(rows.size).toBe(1);
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(200);
    expect(rows.size).toBe(1);
    expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
  });
  it("provider outage never undoes award or imports remote balances", async () => {
    const f = await fixture();
    await googleIssue(post(f.member.cardToken));
    const result = await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(result.balance).toBe(2);
    const before = await snapshot(f.member.id); outage = true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(await snapshot(f.member.id)).toEqual(before);
    outage = false;
    rows.values().next().value!.dynamic_data.balance = 999;
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(rows.values().next().value!.dynamic_data.balance).toBe(2);
    expect(await snapshot(f.member.id)).toEqual(before);
  });
  it("reissue voids old QR without assigning the replacement credential to its serial", async () => {
    const f = await fixture(); await googleIssue(post(f.member.cardToken));
    const old = rows.values().next().value!;
    const locator = (await snapshot(f.member.id)).member.card_locator;
    const afterInitialIssuance = calls.length;
    const next = await reissue(f);
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(404);
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(old.status).toBe("invalidated"); expect(old.dynamic_data.scanCode).toBe("");
    expect((await googleIssue(post(next.cardToken))).status).toBe(200);
    const replacement = [...rows.values()].find(row=>row!==old)!;
    expect(replacement.serial_number).not.toBe(old.serial_number);
    expect(replacement.dynamic_data.scanCode).not.toBe(old.dynamic_data.scanCode);
    expect((await snapshot(f.member.id)).member.card_locator).toBe(locator);
    expect(calls.slice(afterInitialIssuance).filter(c=>c.path.includes(old.serial_number)&&c.body).every(c=>!(c.body?.data as Record<string,unknown>)?.scanCode)).toBe(true);
  });
  it("retries a lost Google void response and preserves closure history", async () => {
    const f = await fixture(); await googleIssue(post(f.member.cardToken));
    await closeCard(f.member.cardToken); const before = await snapshot(f.member.id); loseVoid = true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(await snapshot(f.member.id)).toEqual(before);
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect((await pool.query("SELECT status FROM wallet_passes")).rows[0].status).toBe("revoked");
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(404);
    expect(await snapshot(f.member.id)).toEqual(before);
  });
  it("does not skip uncertain pending Apple revocation after creation timeout", async () => {
    const f = await fixture();
    const issued = await appleIssue(post(f.member.cardToken,"apple"));
    const { url } = await issued.json(); loseGenerate = true;
    const ticket = String(url).split("/").at(-1)!;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(502);
    await reissue(f);
    expect((await pool.query("SELECT status FROM wallet_passes")).rows[0].status).toBe("revocation_pending");
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect([...rows.values()][0].dynamic_data.scanCode).toBe("");
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(404);
  });
  it("does not strand issued Google behind an Apple request that never contacted the provider", async () => {
    const f=await fixture(); await appleIssue(post(f.member.cardToken,"apple")); await googleIssue(post(f.member.cardToken));
    await closeCard(f.member.cardToken);
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes WHERE status <> 'revoked'")).rows[0].n).toBe(0);
  });
  it("completes the other platform's revocation during a single-platform outage", async () => {
    const f=await fixture(); const {url}=await (await appleIssue(post(f.member.cardToken,"apple"))).json();
    const ticket=String(url).split("/").at(-1)!;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(200);
    await googleIssue(post(f.member.cardToken)); await closeCard(f.member.cardToken); outagePlatform="apple";
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect([...rows.values()].find(row=>row.wallet_type==="google")!.status).toBe("invalidated");
    outagePlatform=undefined;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
  });
  async function issueBoth(f: Awaited<ReturnType<typeof fixture>>) {
    const {url}=await (await appleIssue(post(f.member.cardToken,"apple"))).json();
    const ticket=String(url).split("/").at(-1)!;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(200);
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(200);
  }
  it.each([{failed:[]},{failed:["apple"]},{failed:["google"]},{failed:["apple","google"]}])("attempts and tracks each platform independently when void fails for $failed", async ({failed}) => {
    const f=await fixture(); await issueBoth(f); await closeCard(f.member.cardToken);
    const before=await snapshot(f.member.id); failingVoids=new Set(failed);
    if (failed.length) await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    else await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    const states=(await pool.query("SELECT provider,status FROM wallet_passes")).rows;
    for (const platform of ["apple","google"]) {
      expect(states.find(row=>row.provider===platform).status).toBe(failingVoids.has(platform)?"revocation_pending":"revoked");
      expect(calls.some(c=>c.path.endsWith("/void?wallet_type="+platform))).toBe(true);
    }
    expect(await snapshot(f.member.id)).toEqual(before);
    const succeeded=new Set(states.filter(row=>row.status==="revoked").map(row=>row.provider));
    const boundary=calls.length; failingVoids.clear();
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect(calls.slice(boundary).every(c=>![...succeeded].some(platform=>c.path.includes("wallet_type="+platform)))).toBe(true);
    expect(rows.size).toBe(2); expect([...rows.values()].every(row=>row.status==="invalidated" && row.dynamic_data.scanCode==="")).toBe(true);
  });
  it("recovers a lost Apple void acknowledgement without rebuilding or generating the retired serial",async()=>{
    const f=await fixture(); await issueBoth(f); await closeCard(f.member.cardToken); loseVoid=true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    const before=await snapshot(f.member.id); const boundary=calls.length;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect(await snapshot(f.member.id)).toEqual(before); expect(rows.size).toBe(2);
    expect(calls.slice(boundary).some(c=>c.path.endsWith("generate-pass")||c.body?.data)).toBe(false);
  });
  it("retains a failed Apple archive rebuild and reconciles only after the same retired archive is provably void",async()=>{
    const f=await fixture(); await issueBoth(f); const oldSerial=[...rows.values()][0].serial_number;
    const next=await reissue(f); failedAppleRebuild=true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    const oldStates=(await pool.query("SELECT provider,status FROM wallet_passes ORDER BY provider")).rows;
    expect(oldStates).toEqual([{provider:"apple",status:"revocation_pending"},{provider:"google",status:"revoked"}]);
    expect((await googleIssue(post(next.cardToken))).status).toBe(200);
    const boundary=calls.length;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(calls.slice(boundary).filter(c=>c.path.includes(oldSerial)).every(c=>!c.body)).toBe(true);
    // Model external provider repair of its archive, never an invented Loynara API repair/create.
    failedAppleRebuild=false;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect(rows.size).toBe(3);
    expect([...rows.values()].filter(row=>row.serial_number===oldSerial).every(row=>row.dynamic_data.scanCode===""&&row.status==="invalidated")).toBe(true);
  });
  it("reissues both platforms with fresh identity and leaves stale old jobs unable to resurrect them",async()=>{
    const f=await fixture(); await issueBoth(f);
    await award({userId:f.owner,locationId:f.merchant.locationId,membershipId:f.member.id,quantity:2,idempotencyKey:randomUUID(),requestId:randomUUID()});
    const before=await snapshot(f.member.id); const old=(await pool.query("SELECT id,provider_object_id FROM wallet_passes")).rows;
    const next=await reissue(f); const after=await snapshot(f.member.id);
    expect(after.member.id).toBe(before.member.id); expect(after.member.balance).toBe(before.member.balance);
    expect(after.member.card_locator).toBe(before.member.card_locator); expect(after.ledger).toEqual(before.ledger);
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    await issueBoth({...f,member:{...f.member,cardToken:next.cardToken}});
    const boundary=calls.length;
    for(const row of old) await syncPassFastPass(row.id,{tenantId:f.merchant.tenantId});
    expect(calls).toHaveLength(boundary);
    const serial=old[0].provider_object_id.slice("passfast:".length);
    expect([...rows.values()].filter(row=>row.serial_number===serial).every(row=>row.status==="invalidated"&&row.dynamic_data.scanCode==="")).toBe(true);
    expect([...rows.values()].filter(row=>row.status==="active").every(row=>row.serial_number!==serial&&row.dynamic_data.scanCode===after.member.scan_code)).toBe(true);
  });
  it("retires a never-started Google request without blocking an issued Apple pass", async () => {
    const f=await fixture(); const {url}=await (await appleIssue(post(f.member.cardToken,"apple"))).json();
    const ticket=String(url).split("/").at(-1)!;
    await download(new Request(origin+url),{params:Promise.resolve({ticket})});
    await issueWalletPass(f.member.cardToken,"google",passFastObjectId); await closeCard(f.member.cardToken);
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes WHERE status<>'revoked'")).rows[0].n).toBe(0);
    expect(calls.every(c=>!c.path.endsWith("wallet_type=google"))).toBe(true);
  });
  it("updates dynamic merchant/programme/reward display without recreating or crossing tenants", async () => {
    const f=await fixture(); const other=await fixture(); await issueBoth(f); await googleIssue(post(other.member.cardToken));
    await award({userId:f.owner,locationId:f.merchant.locationId,membershipId:f.member.id,quantity:2,idempotencyKey:randomUUID(),requestId:randomUUID()});
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    const originals=[...rows.values()].map(row=>({serial:row.serial_number,platform:row.wallet_type,data:{...row.dynamic_data}}));
    await updateMerchantBrand({actorUserId:f.owner,programSlug:f.merchant.programSlug,businessName:"Updated Café",locationName:"Updated Location",brandColor:"#123456"});
    await updateProgram({actorUserId:f.owner,programSlug:f.merchant.programSlug,name:"Updated Coffee",rulesText:"One stamp per approved purchase"});
    const reward=(await pool.query("SELECT id FROM rewards WHERE program_id=$1",[f.merchant.programId])).rows[0];
    await editReward({actorUserId:f.owner,programSlug:f.merchant.programSlug,rewardId:reward.id,title:"Updated Reward",cost:3,termsText:""});
    const before=await snapshot(f.member.id); const boundary=calls.length;
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(await snapshot(f.member.id)).toEqual(before);
    expect(calls.slice(boundary).some(c=>c.path.endsWith("generate-pass"))).toBe(false);
    const ownSerial=originals[0].serial;
    for(const row of rows.values()) {
      const prior=originals.find(old=>old.serial===row.serial_number&&old.platform===row.wallet_type)!;
      if(row.serial_number!==ownSerial) {expect(row.dynamic_data).toEqual(prior.data);continue;}
      expect(row.dynamic_data).toMatchObject({merchantName:"Updated Café",locationName:"Updated Location",programName:"Updated Coffee",rewardTitle:"Updated Reward",rewardCost:3,rewardReady:false,balance:2,scanCode:prior.data.scanCode,cardLocator:prior.data.cardLocator});
      expect(row.dynamic_data).not.toHaveProperty("brandColor");
    }
    expect((await ownerWalletReadiness({actorUserId:f.owner,programSlug:f.merchant.programSlug})).logo).toBe("needs_review");
  });
  it("rejects cross-tenant pass lookup before provider contact", async () => {
    const f = await fixture(); const pass = await issueWalletPass(f.member.cardToken,"google",passFastObjectId);
    await expect(syncPassFastPass(pass.id,{tenantId:randomUUID()})).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(await refreshWalletForMembership(f.member.id,{expectedTenantId:randomUUID()})).toEqual({status:"complete"});
    expect(calls).toHaveLength(0);
  });
  it("provider disabled fails honestly without creating passes or network traffic", async () => {
    const f = await fixture(); vi.stubEnv("PASSFAST_ENABLED","false");
    expect((await googleIssue(post(f.member.cardToken))).status).toBe(503);
    expect((await appleIssue(post(f.member.cardToken,"apple"))).status).toBe(503);
    expect(rows.size).toBe(0); expect(calls).toHaveLength(0);
  });
  it("serializes an old in-flight update with reissue using the pass row lock", async () => {
    const f=await fixture(); await googleIssue(post(f.member.cardToken));
    const [{id:passId}]=(await pool.query("SELECT id FROM wallet_passes")).rows;
    let started!:()=>void, release!:()=>void;
    const entered=new Promise<void>(done=>{started=done;});
    const gate=new Promise<void>(done=>{release=done;});
    pauseUpdate=async()=>{started();await gate;};
    const updating=syncPassFastPass(passId);
    await entered;
    const rotating=reissue(f);
    try {
      const deadline=Date.now()+5000;
      for(;;){
        const waiting=(await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND cardinality(pg_blocking_pids(pid))>0 AND query ILIKE '%wallet_passes%') AS waiting")).rows[0].waiting;
        if(waiting)break;
        if(Date.now()>deadline)throw new Error("Expected real lifecycle/pass lock contention");
        await new Promise(done=>setTimeout(done,10));
      }
    } finally { release(); }
    const [,next]=await Promise.all([updating,rotating]);
    pauseUpdate=undefined;
    const old=[...rows.values()][0];
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(old.status).toBe("invalidated"); expect(old.dynamic_data.scanCode).toBe("");
    expect((await googleIssue(post(next.cardToken))).status).toBe(200);
    expect(rows.size).toBe(2);
  });
  it("rejects a pass download if reissue commits while PassFast serves it", async () => {
    const f=await fixture(); const response=await appleIssue(post(f.member.cardToken,"apple")); const {url}=await response.json();
    pauseDownload=async()=>{await reissue(f);};
    const ticket=String(url).split("/").at(-1)!;
    const result=await download(new Request(origin+url),{params:Promise.resolve({ticket})});
    expect(result.status).toBe(404); expect(result.headers.get("content-type")).not.toBe("application/vnd.apple.pkpass");
  });
  it("readiness excludes unconfirmed requests and does not claim uploaded native assets are published", async () => {
    const f = await fixture(); await appleIssue(post(f.member.cardToken,"apple"));
    const pending = await ownerWalletReadiness({ actorUserId:f.owner,programSlug:f.merchant.programSlug });
    expect(pending.passes).toEqual({apple:0,google:0}); expect(pending.logo).toBe("needs_review");
    await googleIssue(post(f.member.cardToken));
    expect((await ownerWalletReadiness({actorUserId:f.owner,programSlug:f.merchant.programSlug})).passes.google).toBe(1);
  });
});
