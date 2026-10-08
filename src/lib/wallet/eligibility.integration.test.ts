import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll } from "@/lib/product";
import { issueWalletPass } from "./issue";
import { credentialHash, walletCardSnapshot } from "./data";
import { passFastObjectId, passFastConfig, assertPassFastBinding, passFastSerial } from "./passfast";
import { refreshWalletForMembership } from "./refresh";
import { syncPassFastPass } from "./passfast-lifecycle";
import { ownerWalletReadiness } from "./readiness";
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Requires isolated looplocal_test");
let owner: string, merchant: Awaited<ReturnType<typeof createMerchant>>, member: Awaited<ReturnType<typeof enroll>>, second: { id: string; card_token: string }, locationId: string, secondSlug: string;
const template = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", demo_requests, apple_devices, rate_limits CASCADE');
  owner = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [owner,"Synthetic owner",`${owner}@example.test`]);
  merchant = await createMerchant({ userId: owner, businessName: "Synthetic café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Coffee", programType: "stamp", rulesText: "One per purchase", rewardTitle: "Coffee", rewardCost: 5 });
  member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  locationId = randomUUID(); secondSlug = randomUUID();
  await pool.query("INSERT INTO locations(id,tenant_id,name,city,country,timezone) VALUES ($1,$2,'Other location','Kassel','DE','Europe/Berlin')", [locationId, merchant.tenantId]);
  const programId = randomUUID();
  await pool.query("INSERT INTO programs(id,tenant_id,location_id,slug,name,type,rules_text) VALUES ($1,$2,$3,$4,'Other coffee','stamp','One per purchase')", [programId, merchant.tenantId, locationId, secondSlug]);
  second = (await pool.query("INSERT INTO memberships(tenant_id,program_id,scan_code,card_token) VALUES ($1,$2,$3,$4) RETURNING id,card_token", [merchant.tenantId, programId, `sc_${randomUUID()}`, `card_${randomUUID().replaceAll('-','')}`])).rows[0];
  for (const [key, value] of Object.entries({ PASSFAST_ENABLED: "true", PASSFAST_WALLET_TYPES: "apple", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111", PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: merchant.tenantId, locationId: merchant.locationId, templateId: template }]) })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Provider forbidden for denied eligibility"); }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await pool.end(); });
describe("database-resolved managed Wallet scope", () => {
  it("authenticates the bearer and resolves only its database location", async () => {
    const { walletCardEligibility } = await import("./eligibility");
    expect(await walletCardEligibility(member.cardToken)).toMatchObject({ tenantId: merchant.tenantId, locationId: merchant.locationId, membershipId: member.id, credentialHash: credentialHash(member.scanCode), availability: { apple: "available", google: "unavailable" } });
    expect((await walletCardEligibility(second.card_token)).availability).toEqual({ apple: "unavailable", google: "unavailable" });
    await expect(walletCardEligibility("invalid-token")).rejects.toMatchObject({ code: "NOT_FOUND", message: "Card not found" });
    await expect(walletCardEligibility(`card_${"z".repeat(40)}`)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Card not found" });
    await pool.query("UPDATE memberships SET closed_at=now() WHERE id=$1", [member.id]);
    await expect(walletCardEligibility(member.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND", message: "Card not found" });
  });
  it("snapshot carries the actual program location", async () => {
    const snapshot = await walletCardSnapshot(member.id);
    expect(snapshot.open && snapshot.pass.locationId).toBe(merchant.locationId);
  });
  it("issues only the allowlisted location and does not mutate denied scope", async () => {
    await expect(issueWalletPass(member.cardToken, "apple", passFastObjectId)).resolves.toMatchObject({ membershipId: member.id, provider: "apple", status: "pending" });
    await expect(issueWalletPass(second.card_token, "apple", passFastObjectId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await pool.query("SELECT count(*)::int n FROM wallet_passes WHERE membership_id=$1", [second.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int n FROM outbox_jobs WHERE payload->>'membershipId'=$1", [second.id])).rows[0].n).toBe(0);
  });
  it("preserves the same identity and rejects a remapped active projection without writes", async () => {
    const first = await issueWalletPass(member.cardToken, "apple", passFastObjectId);
    expect(passFastSerial(first.providerObjectId)).toBe(first.id);
    expect(() => assertPassFastBinding(first.providerObjectId, passFastConfig(process.env, merchant.tenantId, merchant.locationId))).not.toThrow();
    expect((await issueWalletPass(member.cardToken, "apple", passFastObjectId)).id).toBe(first.id);
    const before = (await pool.query("SELECT to_jsonb(p) AS pass FROM wallet_passes p WHERE id=$1", [first.id])).rows[0].pass;
    vi.stubEnv("PASSFAST_TENANT_TEMPLATES", JSON.stringify([{ tenantId: merchant.tenantId, locationId: merchant.locationId, templateId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }]));
    await expect(issueWalletPass(member.cardToken, "apple", passFastObjectId)).rejects.toThrow("PassFast operation failed");
    await expect(syncPassFastPass(first.id)).rejects.toThrow("PassFast operation failed");
    expect((await pool.query("SELECT to_jsonb(p) AS pass FROM wallet_passes p WHERE id=$1", [first.id])).rows[0].pass).toEqual(before);
    expect((await pool.query("SELECT count(*)::int n FROM wallet_passes")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks a denied location's existing managed projection without a provider call", async () => {
    const passId = randomUUID();
    await pool.query("INSERT INTO wallet_passes(id,tenant_id,membership_id,provider,provider_object_id,status,credential_hash) VALUES ($1,$2,$3,'apple',$4,'pending',$5)", [passId,merchant.tenantId,second.id,passFastObjectId(passId),credentialHash("synthetic")]);
    await expect(syncPassFastPass(passId)).rejects.toThrow();
    expect((await pool.query("SELECT status FROM wallet_passes WHERE id=$1", [passId])).rows[0].status).toBe("pending");
    expect(await refreshWalletForMembership(second.id)).toEqual({ status: "blocked", reason: "Wallet provider unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reports owner readiness for each program location", async () => {
    expect((await ownerWalletReadiness({ actorUserId: owner, programSlug: merchant.programSlug })).apple).toBe("ready");
    expect((await ownerWalletReadiness({ actorUserId: owner, programSlug: secondSlug })).apple).toBe("not_set_up");
  });
  it("blocks a preexisting Google projection before managed provider work and status mutation", async () => {
    const passId = randomUUID();
    await pool.query("INSERT INTO wallet_passes(id,tenant_id,membership_id,provider,provider_object_id,status,credential_hash) VALUES ($1,$2,$3,'google',$4,'pending',$5)", [passId,merchant.tenantId,member.id,passFastObjectId(passId),credentialHash(member.scanCode)]);
    await expect(syncPassFastPass(passId)).rejects.toThrow();
    expect((await pool.query("SELECT status FROM wallet_passes WHERE id=$1", [passId])).rows[0].status).toBe("pending");
    expect(await refreshWalletForMembership(member.id)).toEqual({ status: "blocked", reason: "Wallet provider unavailable" });
    expect(fetch).not.toHaveBeenCalled();
  });
});
