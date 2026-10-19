import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool } from "@/db";
import { campaignRecipients, campaigns, ledgerEntries, membershipContacts, memberships, outboxJobs, staffRoles } from "@/db/schema";
import { updateLocationAddress } from "./locations";
import { createMerchant, createReward, enroll } from "./product";
import { getRetentionSummary } from "./retention";
import { selectAudience } from "./segments";
import { buildInsights } from "@/components/owner/retention-insights";
import { createDraftCampaign, deliverCampaignRecipient, dispatchCampaign, getCampaign } from "./campaigns";
import { promotionalEmailMode, promotionalProvider } from "./transactional-email";

// The HTTP boundary gets a synthetic authenticated identity; all service authorization, ingress,
// body parsing, rate limits, database writes and worker/provider guards below are real.
const session = vi.hoisted(() => ({ actorId: "" }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: session.actorId } }) } } }));
import { GET as list, POST as mutate } from "@/app/api/merchant/campaigns/route";
import { POST as preview } from "@/app/api/merchant/campaigns/preview/route";
import { GET as detail } from "@/app/api/merchant/campaigns/[id]/route";

const testDatabase = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (!["localhost", "127.0.0.1"].includes(testDatabase.hostname) || testDatabase.pathname !== "/looplocal_test") throw new Error("Production safety tests require a loopback looplocal_test database");
const ORIGIN = "https://synthetic.example.test";
const content = { title: "Synthetic safe draft", subject: "Synthetic preview", body: "Prepared synthetic content only.", audienceDefinition: { kind: "all" as const } };
const send = vi.fn(async () => ({ state: "accepted" as const }));
const fetchSpy = vi.fn(async () => { throw new Error("Network I/O is forbidden in this test"); });

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
  vi.clearAllMocks();
  for (const [key, value] of Object.entries({
    NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production", TRUSTED_INGRESS: "cloudflare_tunnel", TRUST_PROXY_CLIENT_IP: "false",
    PUBLIC_REGISTRATION_ENABLED: "false", STAFF_INVITE_SIGNUP_ENABLED: "true", NFC_ENABLED: "false",
    APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", LIVE_BILLING_ENABLED: "false", BILLING_FIXTURE_MODE: "false",
    EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
    MAILGUN_PROMOTIONAL_SEND_APPROVED: "false", MAILGUN_SEND_APPROVED: "false", PUBLIC_BASE_URL: ORIGIN, SMTP_HOST: "localhost",
    BETTER_AUTH_SECRET: "synthetic-production-safety-secret-over-32-characters",
    // Even with a complete synthetic provider configuration, the false approvals must win.
    MAILGUN_EU_API_KEY: "synthetic-not-a-real-key", MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "safe@mail.example.test",
    MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic-signing-key-over-32-characters",
    PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
    PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.example.test", PROMOTIONAL_UNSUBSCRIBE_SECRET: "synthetic-unsubscribe-secret-over-32-characters",
  })) vi.stubEnv(key, value);
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => { expect(send).not.toHaveBeenCalled(); expect(fetchSpy).not.toHaveBeenCalled(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

function request(path: string, payload?: Record<string, unknown>) {
  return new Request(`${ORIGIN}${path}`, { method: payload ? "POST" : "GET", headers: { Origin: ORIGIN, "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.10" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
}
async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Safe Café", city: "Berlin", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per checkout.", rewardTitle: "Coffee", rewardCost: 8 });
  await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Teststraße 1", postalCode: "34117", city: "Kassel" });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "synthetic-customer@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  session.actorId = ownerId;
  return { ownerId, merchant, card };
}
const campaignJobs = () => db.select().from(outboxJobs).where(inArray(outboxJobs.kind, ["campaign.dispatch", "email.campaign"]));

describe("production-equivalent campaign draft-only safety", () => {
  it("previews and idempotently creates only a draft; direct schedule and mode manipulation remain blocked", async () => {
    const f = await fixture();
    expect(promotionalEmailMode()).toBe("disabled");
    expect(promotionalProvider()).toBeNull();
    const inspected = await preview(request("/api/merchant/campaigns/preview", { programSlug: f.merchant.programSlug, audienceDefinition: content.audienceDefinition }));
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ total: 1, eligibleCount: 1, deliveryMode: "disabled" });
    const create = () => mutate(request("/api/merchant/campaigns", { action: "create", programSlug: f.merchant.programSlug, ...content }));
    const responses = await Promise.all([create(), create()]);
    expect(responses.map(response => response.status)).toEqual([201, 201]);
    const [first, second] = await Promise.all(responses.map(response => response.json()));
    expect(second.campaign.id).toBe(first.campaign.id);
    expect(await db.select().from(campaigns)).toHaveLength(1);
    expect(first.campaign).toMatchObject({ status: "draft", queuedCount: 0, audienceCount: 0 });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect(await campaignJobs()).toHaveLength(0);
    const schedule = { action: "schedule", campaignId: first.campaign.id, scheduledAt: new Date(Date.now() + 60_000).toISOString() };
    const blocked = await mutate(request("/api/merchant/campaigns", schedule));
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ code: "EMAIL_DISABLED" });
    expect((await mutate(request("/api/merchant/campaigns", { ...schedule, deliveryMode: "mailgun_eu", promotionalExternalEmailEnabled: true }))).status).toBe(400);
    expect(await campaignJobs()).toHaveLength(0);
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
  });

  it("blocks pre-existing dispatch and recipient jobs before recipients, outbox work or provider calls", async () => {
    const f = await fixture();
    const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...content });
    const due = new Date(Date.now() - 1000);
    await db.update(campaigns).set({ status: "scheduled", scheduledAt: due, audienceAsOf: due, scheduleRevision: 1 }).where(eq(campaigns.id, draft.id));
    expect(await dispatchCampaign({ id: randomUUID(), tenantId: f.merchant.tenantId, payload: { campaignId: draft.id, scheduleRevision: "1" } })).toMatchObject({ status: "blocked" });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect(await campaignJobs()).toHaveLength(0);
    await db.update(campaigns).set({ status: "dispatching" }).where(eq(campaigns.id, draft.id));
    const [recipient] = await db.insert(campaignRecipients).values({ tenantId: f.merchant.tenantId, campaignId: draft.id, membershipId: f.card.id }).returning();
    const [job] = await db.insert(outboxJobs).values({ tenantId: f.merchant.tenantId, kind: "email.campaign", payload: { campaignId: draft.id, recipientId: recipient.id, membershipId: f.card.id } }).returning();
    const localSend = vi.fn(async () => {});
    expect(await deliverCampaignRecipient({ ...job, attempts: 1 }, localSend, { name: "mailgun_eu", send })).toMatchObject({ status: "blocked" });
    expect(localSend).not.toHaveBeenCalled();
    expect(await db.select().from(campaignRecipients)).toEqual([expect.objectContaining({ status: "queued", sentAt: null })]);
  });

  it.each(["manager", "cashier"] as const)("rejects %s campaign creation, edit, preview, list and detail", async role => {
    const f = await fixture();
    const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...content });
    const actorId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [actorId, "Synthetic staff", `${actorId}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, userId: actorId, role });
    session.actorId = actorId;
    expect((await mutate(request("/api/merchant/campaigns", { action: "create", programSlug: f.merchant.programSlug, ...content }))).status).toBe(403);
    expect((await mutate(request("/api/merchant/campaigns", { action: "edit", campaignId: draft.id, ...content }))).status).toBe(403);
    expect((await preview(request("/api/merchant/campaigns/preview", { programSlug: f.merchant.programSlug, audienceDefinition: content.audienceDefinition }))).status).toBe(403);
    expect((await list(request(`/api/merchant/campaigns?programSlug=${f.merchant.programSlug}`))).status).toBe(403);
    expect((await detail(request(`/api/merchant/campaigns/${draft.id}`), { params: Promise.resolve({ id: draft.id }) })).status).toBe(403);
    expect(await db.select().from(campaigns)).toHaveLength(1);
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect(await campaignJobs()).toHaveLength(0);
  });

  it("preserves the cheapest-reward retention count through the overview reminder and campaign preview", async () => {
    const f = await fixture();
    await createReward({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, title: "Synthetic larger reward", cost: 12 });
    await db.update(memberships).set({ balance: 6 }).where(eq(memberships.id, f.card.id));
    const alreadyReady = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true });
    await db.update(memberships).set({ balance: 10 }).where(eq(memberships.id, alreadyReady.id));
    const summary = await getRetentionSummary(f.ownerId, { locationId: f.merchant.locationId });
    expect(summary).toMatchObject({ nearReward: 1, rewardReady: 1, nearRewardMaxRemaining: 2 });
    // Generic audiences intentionally consider any not-yet-affordable reward. A card with ten stamps is
    // ready for Coffee (eight), but is also two short of the larger reward (twelve).
    expect(await selectAudience({ actorUserId: f.ownerId, programId: f.merchant.programId, definition: { kind: "close_to_reward", maxRemaining: 2 } })).toMatchObject({ total: 2 });
    const reminder = buildInsights({ summary, unit: "Stempel", isOwner: true, campaigns: true, referrals: [] })
      .find(insight => insight.id === "near-reward")?.actions.find(action => action.href.startsWith("/merchant/campaigns"));
    expect(reminder).toBeDefined();
    const params = new URL(reminder!.href, ORIGIN).searchParams;
    const rewardId = params.get("rewardId");
    expect(rewardId).not.toBeNull();
    const inspected = await preview(request("/api/merchant/campaigns/preview", { programSlug: f.merchant.programSlug,
      audienceDefinition: { kind: "close_to_reward", maxRemaining: Number(params.get("maxRemaining")), ...(rewardId ? { rewardId } : {}) } }));
    expect(inspected.status).toBe(200);
    expect(await inspected.json()).toMatchObject({ total: summary.nearReward, deliveryMode: "disabled" });
  });

  it("observes unique contacted cards only after legitimate unreversed checkout activity", async () => {
    const f = await fixture();
    const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...content });
    const sentAt = new Date(Date.now() - 60_000);
    await db.insert(campaignRecipients).values({ tenantId: f.merchant.tenantId, campaignId: draft.id, membershipId: f.card.id, status: "complete", sentAt });
    const entry = (source: string, createdAt: Date, requestId = randomUUID()) => db.insert(ledgerEntries).values({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, membershipId: f.card.id, actorUserId: f.ownerId, delta: 1, kind: "award", source, createdAt, requestId, idempotencyKey: randomUUID() }).returning();
    await entry("staff_online", new Date(sentAt.getTime() - 1));
    for (const source of ["referral_bonus", "staff_correction", "synthetic_seed"]) await entry(source, new Date());
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: draft.id })).outcome).toEqual({ sent: 1, returnedAfterSend: 0 });
    const requestId = randomUUID();
    const [first] = await entry("staff_online", new Date(), requestId);
    const [second] = await entry("staff_offline", new Date(), requestId);
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: draft.id })).outcome).toEqual({ sent: 1, returnedAfterSend: 1 });
    for (const original of [first, second]) await db.insert(ledgerEntries).values({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, membershipId: f.card.id, actorUserId: f.ownerId, delta: -1, kind: "reversal", source: "staff_correction", reversalOfId: original.id, requestId: randomUUID(), idempotencyKey: randomUUID() });
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: draft.id })).outcome).toEqual({ sent: 1, returnedAfterSend: 0 });
    expect(await db.select().from(campaignRecipients).where(and(eq(campaignRecipients.campaignId, draft.id), eq(campaignRecipients.status, "complete")))).toHaveLength(1);
  });
});
