import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { claimOutboxJob, markOutboxJob } from "@/lib/outbox";
import { closeCard } from "@/lib/card-lifecycle";
import { reissueCardByStaff } from "@/lib/card-reissue";
import { award, redeem, reverseEntry } from "@/lib/loyalty";
import { updateMerchantBrand } from "@/lib/merchant-brand";
import { createMerchant, enroll, updateProgram, editReward } from "@/lib/product";
import { POST as directGoogleIssue } from "@/app/api/wallet/google/route";
import { POST as walletStatus } from "@/app/api/wallet/status/route";
import { createDownloadTicket } from "./ticket";
import { POST as appleIssue } from "@/app/api/wallet/apple/route";
import { GET as download } from "@/app/api/wallet/apple/download/[ticket]/route";
import { configureReferrals, getCardReferralShare } from "@/lib/referrals";
import { findReturningCard, returningCardCookieHeader } from "@/lib/returning-card";
import { POST as bindCard } from "@/app/api/card/[token]/tap-session/route";
import { GET as readCard } from "@/app/api/card/[token]/route";
import { POST as enrollRoute } from "@/app/api/enroll/route";
import { issueWalletPass } from "./issue";
import { ownerWalletReadiness } from "./readiness";
import { refreshWalletForMembership } from "./refresh";
import { readCustomerSession } from "@/lib/customer-session";
import { passFastObjectId, passFastSerial, passFastStatus } from "./passfast";
import { syncPassFastPass } from "./passfast-lifecycle";
import { syntheticPassFastArchive, seedHistoricalManagedGoogle } from "./test-support";

/** Historical managed Google lifecycle regression only. This helper is never an application issuance path. */
async function historicalGoogleFixture(request: Request) {
  const { token } = await request.json();
  const member = (await pool.query("SELECT m.id,m.tenant_id,p.location_id FROM memberships m JOIN programs p ON p.id=m.program_id WHERE m.card_token=$1 AND m.closed_at IS NULL", [token])).rows[0];
  if (!member) return new Response(null, { status: 404 });
  if (!passFastStatus(process.env, member.tenant_id, member.location_id).ready) return new Response(null, { status: 503 });
  try {
    const row = await seedHistoricalManagedGoogle(token);
    const { saveUrl } = await syncPassFastPass(row.id);
    return Response.json({ url: saveUrl });
  } catch { return new Response(null, { status: 502 }); }
}

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
const origin = "http://localhost:3000";
const post = (token: string, platform = "google") => new Request(`${origin}/api/wallet/${platform}`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ token }) });
type Remote = { app_id: string; template_id: string; external_id: string; id: string; serial_number: string; wallet_type: string; status: string; dynamic_data: Record<string, unknown>; google_save_url?: string };
let outagePlatform: string | undefined;
let failingVoids = new Set<string>();
let pauseUpdate: (() => Promise<void>) | undefined, pauseDownload: (() => Promise<void>) | undefined;
let rows: Map<string, Remote>, calls: Array<{ path: string; body: Record<string, unknown> | null }>, loseGenerate: boolean, loseVoid: boolean, outage: boolean;
let failedAppleRebuild = false;
let templateBindings: Array<{ tenantId: string; locationId: string; templateId: string }>;
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
    if (!row) { row = { app_id:process.env.PASSFAST_APP_ID!, template_id:String(body?.template_id), external_id:serial, id: randomUUID(), serial_number: serial, wallet_type: platform, status: "active", dynamic_data: body!.data as Record<string, unknown>, ...(platform === "google" ? { google_save_url: "https://pay.google.com/gp/v/save/synthetic" } : {}) }; rows.set(key, row); }
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
async function fixture(locale: "de" | "fr" = "de") {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner,"Synthetic PassFast owner",`${owner}@example.test`]);
  const merchant = await createMerchant({ userId: owner, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale, currency: "EUR", programName: "Coffee", programType: "stamp", rulesText: "One per purchase", rewardTitle: "Coffee", rewardCost: 5 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  templateBindings.push({ tenantId: merchant.tenantId, locationId: merchant.locationId, templateId: randomUUID() });
  vi.stubEnv("PASSFAST_TENANT_TEMPLATES", JSON.stringify(templateBindings));
  return { owner, merchant, member };
}
/** Exercise the durable worker boundary before requesting a fresh ready ticket. */
async function processWalletJobs() {
  for (;;) {
    const job = await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 });
    if (!job) return;
    expect(job.kind).toBe("wallet.refresh");
    try {
      const result = await refreshWalletForMembership(String(job.payload.membershipId), { expectedTenantId: job.tenantId });
      expect(await markOutboxJob(pool, job, result.status, "reason" in result ? result.reason : undefined)).toBe(true);
    } catch (error) {
      await markOutboxJob(pool, job, "retry", "Synthetic provider failure", 60);
      throw error;
    }
  }
}
async function readyApple(f: Awaited<ReturnType<typeof fixture>>) {
  const issued = await appleIssue(post(f.member.cardToken, "apple"));
  expect(issued.status).toBe(202);
  expect(await issued.json()).toEqual({ status: "pending" });
  await processWalletJobs();
  const status = await walletStatus(post(f.member.cardToken, "status"));
  expect(status.status).toBe(200);
  const body = await status.json();
  expect(body.applePass.status).toBe("ready");
  expect(body.applePass.url).toMatch(/^\/api\/wallet\/apple\/download\//);
  return { url: body.applePass.url as string };
}
const reissue = (f: Awaited<ReturnType<typeof fixture>>) => reissueCardByStaff({ actorUserId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, reason: "Synthetic lost phone verification", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
const snapshot = async (member: string) => (await pool.query("SELECT to_jsonb(m) AS member, (SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY id), '[]') FROM ledger_entries l WHERE membership_id=$1) AS ledger FROM memberships m WHERE id=$1", [member])).rows[0];
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE');
  templateBindings = [];
  rows = new Map(); calls = []; loseGenerate = loseVoid = outage = false; pauseUpdate = pauseDownload = undefined; outagePlatform = undefined; failingVoids = new Set(); failedAppleRebuild = false;
  for (const [name,value] of Object.entries({ PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: randomUUID(), PASSFAST_WALLET_TYPES: "both", PASSFAST_TENANT_TEMPLATES: "[]", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", PUBLIC_BASE_URL: origin })) vi.stubEnv(name,value);
  vi.stubGlobal("fetch", vi.fn(fake));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

describe("PassFast Apple and historical managed Google lifecycle through isolated transactions", () => {
  it("refuses new managed Google issuance through the real customer route", async () => {
    const f = await fixture();
    expect((await directGoogleIssue(post(f.member.cardToken))).status).toBe(503);
    expect(calls).toHaveLength(0);
    await expect(issueWalletPass(f.member.cardToken, "google", passFastObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("duplicate issuance shares a serial and one durable pending job", async () => {
    const f = await fixture();
    for (let i=0;i<2;i++) expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(200);
    expect(rows.size).toBe(1);
    expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh' AND status='pending'")).rows[0].n).toBe(1);
  });
  it("shares a generation serial across Apple and Google without sharing local auth tickets", async () => {
    const f=await fixture(); await appleIssue(post(f.member.cardToken,"apple")); await historicalGoogleFixture(post(f.member.cardToken));
    const passes=(await pool.query("SELECT id,provider,provider_object_id FROM wallet_passes ORDER BY provider")).rows;
    expect(passes).toHaveLength(2); expect(passes[0].id).not.toBe(passes[1].id);
    expect(passes[0].provider_object_id).toBe(passes[1].provider_object_id);
    await reissue(f); const after=await seedHistoricalManagedGoogle((await snapshot(f.member.id)).member.card_token);
    expect(after.providerObjectId).not.toBe(passes[0].provider_object_id);
  });
  it("recovers provider success with a lost local response without creating another pass", async () => {
    const f = await fixture(); loseGenerate = true;
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(502);
    expect(rows.size).toBe(1);
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(200);
    expect(rows.size).toBe(1);
    expect(calls.filter(c=>c.path.endsWith("generate-pass"))).toHaveLength(1);
  });
  it("provider outage never undoes award or imports remote balances", async () => {
    const f = await fixture();
    await historicalGoogleFixture(post(f.member.cardToken));
    const result = await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(result.balance).toBe(2);
    const before = await snapshot(f.member.id); outage = true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(await snapshot(f.member.id)).toEqual(before);
    outage = false;
    rows.values().next().value!.dynamic_data.balance = 999;
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(rows.values().next().value!.dynamic_data.balance).toBe("2");
    expect(await snapshot(f.member.id)).toEqual(before);
  });
  it("reissue voids old QR without assigning the replacement credential to its serial", async () => {
    const f = await fixture(); await historicalGoogleFixture(post(f.member.cardToken));
    const old = rows.values().next().value!;
    const locator = (await snapshot(f.member.id)).member.card_locator;
    const afterInitialIssuance = calls.length;
    const next = await reissue(f);
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(404);
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect(old.status).toBe("invalidated"); expect(old.dynamic_data.scanCode).toBe("");
    expect((await historicalGoogleFixture(post(next.cardToken))).status).toBe(200);
    const replacement = [...rows.values()].find(row=>row!==old)!;
    expect(replacement.serial_number).not.toBe(old.serial_number);
    expect(replacement.dynamic_data.scanCode).not.toBe(old.dynamic_data.scanCode);
    expect((await snapshot(f.member.id)).member.card_locator).toBe(locator);
    expect(calls.slice(afterInitialIssuance).filter(c=>c.path.includes(old.serial_number)&&c.body).every(c=>!(c.body?.data as Record<string,unknown>)?.scanCode)).toBe(true);
  });
  it("retries a lost Google void response and preserves closure history", async () => {
    const f = await fixture(); await historicalGoogleFixture(post(f.member.cardToken));
    await closeCard(f.member.cardToken); const before = await snapshot(f.member.id); loseVoid = true;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(await snapshot(f.member.id)).toEqual(before);
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect((await pool.query("SELECT status FROM wallet_passes")).rows[0].status).toBe("revoked");
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(404);
    expect(await snapshot(f.member.id)).toEqual(before);
  });
  it("does not skip uncertain pending Apple revocation after worker creation timeout", async () => {
    const f = await fixture();
    const issued = await appleIssue(post(f.member.cardToken,"apple"));
    expect(issued.status).toBe(202);
    const pass = (await pool.query("SELECT id FROM wallet_passes WHERE membership_id=$1", [f.member.id])).rows[0];
    const ticket = createDownloadTicket(pass.id), url = `/api/wallet/apple/download/${ticket}`;
    loseGenerate = true;
    await expect(processWalletJobs()).rejects.toThrow();
    expect(rows.size).toBe(1);
    const before = calls.length;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(503);
    expect(calls).toHaveLength(before);
    await reissue(f);
    expect((await pool.query("SELECT status FROM wallet_passes")).rows[0].status).toBe("revocation_pending");
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect([...rows.values()][0].dynamic_data.scanCode).toBe("");
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(404);
  });
  it("does not strand issued Google behind an Apple request that never contacted the provider", async () => {
    const f=await fixture(); await appleIssue(post(f.member.cardToken,"apple")); await historicalGoogleFixture(post(f.member.cardToken));
    await closeCard(f.member.cardToken);
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes WHERE status <> 'revoked'")).rows[0].n).toBe(0);
  });
  it("completes the other platform's revocation during a single-platform outage", async () => {
    const f=await fixture(); const {url}=await readyApple(f);
    const ticket=String(url).split("/").at(-1)!;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(200);
    await historicalGoogleFixture(post(f.member.cardToken)); await closeCard(f.member.cardToken); outagePlatform="apple";
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect([...rows.values()].find(row=>row.wallet_type==="google")!.status).toBe("invalidated");
    outagePlatform=undefined;
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
  });
  async function issueBoth(f: Awaited<ReturnType<typeof fixture>>) {
    const {url}=await readyApple(f);
    const ticket=String(url).split("/").at(-1)!;
    expect((await download(new Request(origin+url),{params:Promise.resolve({ticket})})).status).toBe(200);
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(200);
  }
  const rewardLocales = [{ locale: "de", text: "Prämie bereit" }, { locale: "fr", text: "Récompense disponible" }] as const;
  it.each(rewardLocales)("updates and clears $locale reward text on both platforms without changing loyalty", async ({ locale, text }) => {
    const f = await fixture(locale); await issueBoth(f);
    expect([...rows.values()].map(row => row.dynamic_data.rewardReady)).toEqual(["", ""]);
    const entry = await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const awarded = await snapshot(f.member.id);
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    expect([...rows.values()].map(row => row.dynamic_data.rewardReady)).toEqual([text, text]);
    expect(await snapshot(f.member.id)).toEqual(awarded);
    await reverseEntry({ userId: f.owner, locationId: f.merchant.locationId, entryId: entry.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    const reversed = await snapshot(f.member.id);
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    expect([...rows.values()].map(row => row.dynamic_data.rewardReady)).toEqual(["", ""]);
    expect(await snapshot(f.member.id)).toEqual(reversed);
    expect(calls.filter(call => call.body?.data).every(call => typeof (call.body!.data as Record<string, unknown>).rewardReady === "string")).toBe(true);
  });
  it.each(rewardLocales)("clears retired $locale reward text and uses current reward state on replacement and closure", async ({ locale, text }) => {
    const f = await fixture(locale);
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await issueBoth(f); const old = [...rows.values()];
    expect(old.map(row => row.dynamic_data.rewardReady)).toEqual([text, text]);
    const next = await reissue(f);
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    expect(old.map(row => ({ status: row.status, rewardReady: row.dynamic_data.rewardReady }))).toEqual([
      { status: "invalidated", rewardReady: "" }, { status: "invalidated", rewardReady: "" },
    ]);
    await issueBoth({ ...f, member: { ...f.member, cardToken: next.cardToken } });
    expect([...rows.values()].filter(row => row.status === "active").map(row => row.dynamic_data.rewardReady)).toEqual([text, text]);
    const boundary = calls.length;
    for (const row of (await pool.query("SELECT id FROM wallet_passes WHERE status='revoked'")).rows) await syncPassFastPass(row.id);
    expect(calls).toHaveLength(boundary);
    await closeCard(next.cardToken);
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    expect([...rows.values()].every(row => row.status === "invalidated" && row.dynamic_data.rewardReady === "" && row.dynamic_data.scanCode === "")).toBe(true);
  });
  it.each(rewardLocales)("reconciles a stale $locale generation after lost acknowledgement without restoring reward text", async ({ locale, text }) => {
    const f = await fixture(locale);
    const entry = await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    loseGenerate = true;
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(502);
    expect([...rows.values()][0].dynamic_data.rewardReady).toBe(text);
    await reverseEntry({ userId: f.owner, locationId: f.merchant.locationId, entryId: entry.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(200);
    expect(rows.size).toBe(1);
    expect([...rows.values()][0].dynamic_data).toMatchObject({ balance: "0", rewardReady: "" });
    expect(calls.filter(call => call.path.endsWith("generate-pass"))).toHaveLength(1);
  });
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
    expect((await historicalGoogleFixture(post(next.cardToken))).status).toBe(200);
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
    const serial=passFastSerial(old[0].provider_object_id);
    expect([...rows.values()].filter(row=>row.serial_number===serial).every(row=>row.status==="invalidated"&&row.dynamic_data.scanCode==="")).toBe(true);
    expect([...rows.values()].filter(row=>row.status==="active").every(row=>row.serial_number!==serial&&row.dynamic_data.scanCode===after.member.scan_code)).toBe(true);
  });
  it("retires a never-started Google request without blocking an issued Apple pass", async () => {
    const f=await fixture(); const {url}=await readyApple(f);
    const ticket=String(url).split("/").at(-1)!;
    await download(new Request(origin+url),{params:Promise.resolve({ticket})});
    await seedHistoricalManagedGoogle(f.member.cardToken); await closeCard(f.member.cardToken);
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).resolves.toEqual({status:"complete"});
    expect([...rows.values()][0].status).toBe("invalidated");
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes WHERE status<>'revoked'")).rows[0].n).toBe(0);
    expect(calls.every(c=>!c.path.endsWith("wallet_type=google"))).toBe(true);
  });
  it("updates dynamic merchant/programme/reward display without recreating or crossing tenants", async () => {
    const f=await fixture(); const other=await fixture(); await issueBoth(f); await historicalGoogleFixture(post(other.member.cardToken));
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
      expect(row.dynamic_data).toMatchObject({merchantName:"Updated Café",locationName:"Updated Location",programName:"Updated Coffee",rewardTitle:"Updated Reward",rewardCost:"3",rewardReady:"",balance:"2",scanCode:prior.data.scanCode,cardLocator:prior.data.cardLocator});
      expect(row.dynamic_data).not.toHaveProperty("brandColor");
    }
    expect((await ownerWalletReadiness({actorUserId:f.owner,programSlug:f.merchant.programSlug})).logo).toBe("needs_review");
  });
  it("rejects cross-tenant pass lookup before provider contact", async () => {
    const f = await fixture(); const pass = await seedHistoricalManagedGoogle(f.member.cardToken);
    await expect(syncPassFastPass(pass.id,{tenantId:randomUUID()})).rejects.toThrow();
    expect(calls).toHaveLength(0);
    expect(await refreshWalletForMembership(f.member.id,{expectedTenantId:randomUUID()})).toEqual({status:"complete"});
    expect(calls).toHaveLength(0);
  });
  it("provider disabled fails honestly without creating passes or network traffic", async () => {
    const f = await fixture(); vi.stubEnv("PASSFAST_ENABLED","false");
    expect((await directGoogleIssue(post(f.member.cardToken))).status).toBe(503);
    expect((await appleIssue(post(f.member.cardToken,"apple"))).status).toBe(503);
    expect(rows.size).toBe(0); expect(calls).toHaveLength(0);
  });
  it("serializes an old in-flight update with reissue using the pass row lock", async () => {
    const f=await fixture(); await historicalGoogleFixture(post(f.member.cardToken));
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
    expect((await historicalGoogleFixture(post(next.cardToken))).status).toBe(200);
    expect(rows.size).toBe(2);
  });
  it("rejects a pass download if reissue commits while PassFast serves it", async () => {
    const f=await fixture(); const {url}=await readyApple(f);
    pauseDownload=async()=>{await reissue(f);};
    const ticket=String(url).split("/").at(-1)!;
    const result=await download(new Request(origin+url),{params:Promise.resolve({ticket})});
    expect(result.status).toBe(404); expect(result.headers.get("content-type")).not.toBe("application/vnd.apple.pkpass");
  });
  it("readiness excludes unconfirmed requests and does not claim uploaded native assets are published", async () => {
    const f = await fixture(); await appleIssue(post(f.member.cardToken,"apple"));
    const pending = await ownerWalletReadiness({ actorUserId:f.owner,programSlug:f.merchant.programSlug });
    expect(pending.passes).toEqual({apple:0,google:0}); expect(pending.logo).toBe("needs_review");
    await historicalGoogleFixture(post(f.member.cardToken));
    expect((await ownerWalletReadiness({actorUserId:f.owner,programSlug:f.merchant.programSlug})).passes.google).toBe(1);
  });
});


describe("combined remembered browser and PassFast generation security", () => {
  const remembered = (programId: string, token: string) => new Request(`${origin}/api/enroll/existing`, {
    headers: { cookie: returningCardCookieHeader(programId, token, origin)!.split(";")[0] },
  });
  it("projects redemption, correction and referral bonuses on both platforms without provider authority over loyalty", async () => {
    const f = await fixture();
    await historicalGoogleFixture(post(f.member.cardToken));
    const { url } = await readyApple(f);
    const ticket = String(url).split("/").at(-1)!;
    expect((await download(new Request(origin + url), { params: Promise.resolve({ ticket }) })).status).toBe(200);
    const originals = [...rows.values()].map(row => row.serial_number + row.wallet_type);
    const sync = async (balance: number) => {
      await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
      expect([...rows.values()].map(row => row.serial_number + row.wallet_type)).toEqual(originals);
      for (const row of rows.values()) expect(row.dynamic_data.balance).toBe(String(balance));
      expect((await snapshot(f.member.id)).member.balance).toBe(balance);
    };
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await sync(5);
    const rewardVersionId = (await pool.query("SELECT rv.id FROM reward_versions rv JOIN rewards r ON r.id=rv.reward_id WHERE r.program_id=$1", [f.member.programId])).rows[0].id;
    const redeemed = await redeem({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, rewardVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await sync(0);
    await reverseEntry({ userId: f.owner, locationId: f.merchant.locationId, entryId: redeemed.entryId, reason: "Synthetic confirmed correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await sync(5);
    await configureReferrals({ actorUserId: f.owner, programSlug: f.merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const referralCode = new URL((await getCardReferralShare(f.member.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, referralCode });
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await sync(7);
    expect(calls.filter(call => call.path.endsWith("generate-pass"))).toHaveLength(2);
  });
  it("providers OFF keeps join, returning card, cashier loyalty, correction, referrals, display edits, reissue and closure independent of HTTP", async () => {
    vi.stubEnv("PASSFAST_ENABLED", "false");
    vi.stubEnv("APPLE_WALLET_ENABLED", "false");
    vi.stubEnv("GOOGLE_WALLET_ENABLED", "false");
    const f = await fixture();
    expect((await findReturningCard(remembered(f.member.programId, f.member.cardToken), f.merchant.programSlug)).state).toBe("existing");
    await configureReferrals({ actorUserId: f.owner, programSlug: f.merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const code = new URL((await getCardReferralShare(f.member.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, referralCode: code });
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const booked = await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await reverseEntry({ userId: f.owner, locationId: f.merchant.locationId, entryId: booked.entryId, reason: "Synthetic providers off correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await updateProgram({ actorUserId: f.owner, programSlug: f.merchant.programSlug, name: "Providers OFF Card", rulesText: "Confirmed visit only" });
    const reward = (await pool.query("SELECT id FROM rewards WHERE program_id=$1", [f.member.programId])).rows[0];
    await editReward({ actorUserId: f.owner, programSlug: f.merchant.programSlug, rewardId: reward.id, title: "Providers OFF Reward", cost: 3, termsText: "" });
    await updateMerchantBrand({ actorUserId: f.owner, programSlug: f.merchant.programSlug, businessName: "Providers OFF Café", locationName: "Providers OFF Location", brandColor: "#123456" });
    const readiness = await ownerWalletReadiness({ actorUserId: f.owner, programSlug: f.merchant.programSlug });
    expect(readiness).toMatchObject({ apple: "not_set_up", google: "not_set_up", passes: { apple: 0, google: 0 } });
    const next = await reissue(f);
    await closeCard(next.cardToken);
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(0);
    expect(calls).toHaveLength(0);
  });
  it("concurrent returning join and issuance keep the existing card, while a deliberate additional card receives its own projection", async () => {
    const f = await fixture();
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const cookie = remembered(f.member.programId, f.member.cardToken);
    const join = (additionalCard = false) => enrollRoute(new Request(`${origin}/api/enroll`, { method: "POST", headers: { origin, cookie: cookie.headers.get("cookie")!, "content-type": "application/json" }, body: JSON.stringify({ slug: f.merchant.programSlug, acceptedTerms: true, ...(additionalCard ? { additionalCard: true } : {}) }) }));
    const [issued, firstJoin, secondJoin] = await Promise.all([historicalGoogleFixture(post(f.member.cardToken)), join(), join()]);
    expect(issued.status).toBe(200);
    expect(firstJoin.status).toBe(409);
    expect(secondJoin.status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE program_id=$1", [f.member.programId])).rows[0].n).toBe(1);
    const old = await snapshot(f.member.id);
    const deliberate = await join(true);
    expect(deliberate.status).toBe(201);
    const next = await deliberate.json();
    expect((await historicalGoogleFixture(post(next.cardToken))).status).toBe(200);
    expect(new Set([...rows.values()].map(row => row.serial_number)).size).toBe(2);
    const members = (await pool.query("SELECT id,balance,card_locator FROM memberships WHERE program_id=$1", [f.member.programId])).rows;
    expect(members).toHaveLength(2);
    expect(members.find(member => member.id === f.member.id)).toMatchObject({ balance: 2, card_locator: old.member.card_locator });
    expect(members.find(member => member.id !== f.member.id).balance).toBe(0);
    expect((await findReturningCard(remembered(f.member.programId, next.cardToken), f.merchant.programSlug)).state).toBe("existing");
  });
  it("reissue invalidates remembered bearer and issuance ticket while preserving membership, history, balance and locator", async () => {
    const f = await fixture();
    await award({ userId: f.owner, locationId: f.merchant.locationId, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await historicalGoogleFixture(post(f.member.cardToken));
    const { url } = await readyApple(f);
    const ticket = String(url).split("/").at(-1)!;
    expect((await download(new Request(origin + url), { params: Promise.resolve({ ticket }) })).status).toBe(200);
    const old = await snapshot(f.member.id);
    const cookie = remembered(f.member.programId, f.member.cardToken);
    expect((await findReturningCard(cookie, f.merchant.programSlug)).state).toBe("existing");
    const replacement = await reissue(f);
    expect((await findReturningCard(cookie, f.merchant.programSlug)).state).toBe("stale");
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(404);
    expect((await download(new Request(origin + url), { params: Promise.resolve({ ticket }) })).status).toBe(404);
    const read = await readCard(new Request(`${origin}/api/enroll/card/${replacement.cardToken}`, { headers: { "sec-fetch-site": "same-origin" } }), { params: Promise.resolve({ token: replacement.cardToken }) });
    expect(read.status).toBe(200);
    expect(read.headers.getSetCookie()).toEqual([]);
    const binding = await bindCard(new Request(`${origin}/api/tap/card/${replacement.cardToken}/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ authenticate: true }) }), { params: Promise.resolve({ token: replacement.cardToken }) });
    expect(binding.status).toBe(200);
    expect(binding.headers.getSetCookie().some(value => value.includes("Path=/api") && readCustomerSession(value.split(";")[0].split("=")[1], f.member.programId)?.token === replacement.cardToken)).toBe(true);
    expect((await findReturningCard(remembered(f.member.programId, replacement.cardToken), f.merchant.programSlug)).state).toBe("existing");
    expect((await historicalGoogleFixture(post(replacement.cardToken))).status).toBe(200);
    const current = await snapshot(f.member.id);
    expect(current.member.id).toBe(old.member.id);
    expect(current.member.balance).toBe(old.member.balance);
    expect(current.member.card_locator).toBe(old.member.card_locator);
    expect(current.ledger).toEqual(old.ledger);
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    const retired = (await pool.query("SELECT status FROM wallet_passes WHERE membership_id=$1 AND revoked_at IS NOT NULL", [f.member.id])).rows;
    expect(retired).toHaveLength(2);
    expect(retired.every(row => row.status === "revoked")).toBe(true);
    for (const row of rows.values()) if (row.status === "invalidated") expect(row.dynamic_data.scanCode).toBe("");
    expect(new Set([...rows.values()].map(row => row.serial_number)).size).toBe(2);
  });
  it("closure under total provider outage cannot reopen through remembered join, ticket or locator; a later enrollment is new", async () => {
    const f = await fixture();
    await historicalGoogleFixture(post(f.member.cardToken));
    const cookie = remembered(f.member.programId, f.member.cardToken);
    const old = await snapshot(f.member.id);
    outage = true;
    await closeCard(f.member.cardToken);
    expect((await findReturningCard(cookie, f.merchant.programSlug)).state).toBe("stale");
    expect((await historicalGoogleFixture(post(f.member.cardToken))).status).toBe(404);
    expect((await historicalGoogleFixture(post(`K-${old.member.card_locator}`))).status).toBe(404);
    await expect(refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId })).rejects.toThrow();
    expect((await snapshot(f.member.id)).member.closed_at).not.toBeNull();
    expect((await snapshot(f.member.id)).ledger).toEqual(old.ledger);
    const joined = await enrollRoute(new Request(`${origin}/api/enroll`, { method: "POST", headers: { origin, cookie: cookie.headers.get("cookie")!, "content-type": "application/json" }, body: JSON.stringify({ slug: f.merchant.programSlug, acceptedTerms: true, additionalCard: true }) }));
    expect(joined.status).toBe(201);
    const next = await joined.json();
    expect(next.cardToken).not.toBe(f.member.cardToken);
    expect((await pool.query("SELECT id FROM memberships WHERE card_token=$1", [next.cardToken])).rows[0].id).not.toBe(f.member.id);
    outage = false;
    await refreshWalletForMembership(f.member.id, { expectedTenantId: f.merchant.tenantId });
    expect([...rows.values()].every(row => row.status === "invalidated")).toBe(true);
  });
});

describe("server-only merchant template isolation", () => {
  async function bind(fixtures: Awaited<ReturnType<typeof fixture>>[]) {
    const bindings=fixtures.map(f=>({tenantId:f.merchant.tenantId,locationId:f.merchant.locationId,templateId:randomUUID()}));
    templateBindings = bindings;
    vi.stubEnv("PASSFAST_TENANT_TEMPLATES",JSON.stringify(bindings));
    return bindings;
  }
  it("uses each tenant's template even when the request supplies another merchant's template and serial", async () => {
    const a=await fixture(), b=await fixture(); const bindings=await bind([a,b]);
    const request=new Request(`${origin}/api/wallet/google`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify({token:a.member.cardToken,templateId:bindings[1].templateId,serial:b.member.id,apiKey:"customer-supplied"})});
    expect((await historicalGoogleFixture(request)).status).toBe(200);
    expect((await historicalGoogleFixture(post(b.member.cardToken))).status).toBe(200);
    const generated=calls.filter(c=>c.path.endsWith("generate-pass"));
    expect(generated.map(c=>c.body?.template_id)).toEqual(bindings.map(b=>b.templateId));
    expect(generated[0].body?.serial_number).not.toBe(b.member.id);
    expect(generated.every(c=>!JSON.stringify(c.body).includes("customer-supplied"))).toBe(true);
    expect(rows.size).toBe(2);
  });
  it("refuses an unmapped merchant before projection creation or any provider request", async () => {
    const a=await fixture(), b=await fixture(); await bind([a]);
    const before=await snapshot(b.member.id);
    expect((await historicalGoogleFixture(post(b.member.cardToken))).status).toBe(503);
    expect(calls).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(0);
    expect(await snapshot(b.member.id)).toEqual(before);
    expect((await ownerWalletReadiness({actorUserId:b.owner,programSlug:b.merchant.programSlug})).apple).toBe("not_set_up");
  });
  it.each(["app_id","template_id","external_id"])("does not update an existing pass with foreign %s", async field => {
    const f=await fixture(); await bind([f]); await historicalGoogleFixture(post(f.member.cardToken));
    const row=rows.values().next().value!;
    row[field as "app_id"|"template_id"|"external_id"]=randomUUID();
    calls=[]; const before=await snapshot(f.member.id);
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect(calls).toHaveLength(1); expect(calls[0].body).toBeNull();
    expect(await snapshot(f.member.id)).toEqual(before);
    expect(rows.size).toBe(1);
  });
  it("the database rejects a cross-tenant projection/member pointer and worker lookup remains tenant-bound", async () => {
    const a=await fixture(), b=await fixture(); await bind([a,b]);
    await appleIssue(post(a.member.cardToken,"apple"));
    await expect(pool.query("UPDATE wallet_passes SET tenant_id=$1 WHERE membership_id=$2",[b.merchant.tenantId,a.member.id])).rejects.toMatchObject({code:"23503"});
    calls=[];
    expect(await refreshWalletForMembership(a.member.id,{expectedTenantId:b.merchant.tenantId})).toEqual({status:"complete"});
    expect(calls).toHaveLength(0);
  });
  it("a mapping change fails closed without generating a replacement identity", async () => {
    const f=await fixture(); await bind([f]); await historicalGoogleFixture(post(f.member.cardToken));
    const previous=[...rows.values()].map(r=>r.serial_number); await bind([f]); calls=[];
    await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
    expect([...rows.values()].map(r=>r.serial_number)).toEqual(previous);
    expect(calls.some(c=>c.path.endsWith("generate-pass"))).toBe(false);
    expect(calls.every(c=>c.body===null)).toBe(true);
  });
  it("shares one operation budget across Apple and Google", async () => {
    const f=await fixture(); await bind([f]);
    await appleIssue(post(f.member.cardToken,"apple")); await historicalGoogleFixture(post(f.member.cardToken));
    await refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId});
    calls=[]; let now=Date.now();
    vi.spyOn(Date,"now").mockImplementation(()=>now);
    vi.stubGlobal("fetch",async(input:string|URL|Request,init?:RequestInit)=>{
      const response=await fake(input,init);
      if(init?.method==="PATCH") now+=240001;
      return response;
    });
    try {
      await expect(refreshWalletForMembership(f.member.id,{expectedTenantId:f.merchant.tenantId})).rejects.toThrow();
      expect(calls.filter(c=>c.body!==null)).toHaveLength(1);
      expect(calls).toHaveLength(2);
    } finally {vi.restoreAllMocks();}
  });
  it("bounds a pending pass row lock before any provider attempt", async () => {
    const f=await fixture(); await bind([f]);
    const row=await issueWalletPass(f.member.cardToken,"apple",passFastObjectId);
    const lock=await pool.connect();
    await lock.query("BEGIN"); await lock.query("SELECT id FROM wallet_passes WHERE id=$1 FOR UPDATE",[row.id]);
    try {
      const result=syncPassFastPass(row.id,{tenantId:f.merchant.tenantId});
      await expect(result).rejects.toMatchObject({cause:{code:"55P03"}});
      expect(calls).toHaveLength(0);
    } finally {await lock.query("ROLLBACK");lock.release();}
  });
});
