import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { campaignAttempts, campaignDailyUsage, campaignRecipients, campaigns, consentEvents, emailProviderEvents, emailSuppressions, ledgerEntries, locations, membershipContacts, outboxJobs, staffRoles, tenants } from "@/db/schema";
import { updateLocationAddress } from "./locations";
import { createMerchant, enroll } from "./product";
import { type LocalMessage } from "./email";
import { cancelCampaign, createDraftCampaign, dispatchCampaign, deliverCampaignRecipient, editDraftCampaign, getCampaign, listCampaigns, pauseCampaign, previewCampaign, scheduleCampaign } from "./campaigns";
import { award } from "./loyalty";
import { closeCard } from "./card-lifecycle";
import { createUnsubscribeToken, unsubscribeMarketing } from "./unsubscribe";
import { recipientHash, recordMailgunWebhook } from "./transactional-email";
import * as segmentQueries from "./segments";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Campaign tests require looplocal_test");
// Delivery here runs on the wall clock; quiet hours have their own deterministic tests (quiet-hours*.test.ts).
vi.mock("./promotion-policy", async importOriginal => ({ ...(await importOriginal<typeof import("./promotion-policy")>()), quietHoursDeferral: () => null }));

const run = promisify(execFile);

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.MAILGUN_PROMOTIONAL_SEND_APPROVED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-campaign-secret-long-enough-for-tests";
  delete process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT;
  delete process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Stamps", programType: "stamp", rulesText: "One stamp per confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
  return { ownerId, merchant };
}

async function member(slug: string, email: string | null, verified: boolean, consent: boolean) {
  const card = await enroll({ slug, acceptedTerms: true, ...(email ? { email, marketingOptIn: consent } : {}) });
  if (email && verified) await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  return card;
}

const audienceDefinition = { kind: "new" as const, withinDays: 7 };
const draftFields = { title: "Synthetic autumn note", subject: "Local test offer", body: "A short synthetic message for a local test.", audienceDefinition };

describe("local campaign core", () => {
  it("sends one approved external fixture message with merchant identity and unsubscribe, then suppresses the next campaign", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug, "owner-controlled@example.test", true, true);
    process.env.PUBLIC_BASE_URL = "https://test.example.test";
    process.env.EXTERNAL_EMAIL_ENABLED = "true";
    process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "true";
    process.env.MAILGUN_PROMOTIONAL_SEND_APPROVED = "true";
    process.env.MAILGUN_SEND_APPROVED = "true";
    process.env.MAILGUN_EU_DOMAIN = "mail.example.test";
    process.env.MAILGUN_FROM_EMAIL = "service@mail.example.test";
    process.env.MAILGUN_EU_API_KEY = "synthetic-key";
    process.env.MAILGUN_EU_WEBHOOK_SIGNING_KEY = "synthetic-signing-key-long-enough";
    process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT = "100";
    process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS = "24";
    process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN = "https://unsubscribe.example.test";
    process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET = "synthetic-dedicated-unsubscribe-secret-long-enough";
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async (message: LocalMessage) => {
      expect(message.to).toBe("owner-controlled@example.test");
      expect(message.unsubscribeUrl).toContain("https://unsubscribe.example.test/unsubscribe#token=");
      expect(message.fromName).toBe("Synthetic Café via Loynara");
      // Legal's footer, verbatim, with every optional part filled (the automations test has them empty).
      expect(message.body).toBe(`${draftFields.body}\n\nDiese E-Mail kommt von Synthetic Café, GmbH, vertreten durch Erika Muster, Friedrich-Ebert-Straße 12, 34117 Kassel. Kontakt: hallo@synthetic-cafe.example.test, 0561 123456. Amtsgericht Kassel, HRB 12345. DE123456789\nDu bekommst diese E-Mail, weil du auf deiner Karte E-Mails von Synthetic Café bestellt hast. Abmelden: ${message.unsubscribeUrl} · Datenschutz: https://test.example.test/datenschutz`);
      expect(message.body).not.toContain(card.cardToken);
      return { state: "accepted" as const, messageId: "<synthetic-promo@example.test>" };
    }) };
    await updateLocationAddress(f.ownerId, { locationId: f.merchant.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactEmail: " hallo@synthetic-cafe.example.test ", contactPhone: "0561 123456", legalForm: "GmbH", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 12345", vatId: "de 123 456 789" });
    const first = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: first.id, scheduledAt: when });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ queuedCount: 1 });
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    expect(await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, undefined, provider)).toMatchObject({ status: "complete" });
    expect(await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 2 }, undefined, provider)).toMatchObject({ status: "complete" });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const webhookToken = randomBytes(25).toString("hex");
    const event = { signature: { timestamp, token: webhookToken, signature: createHmac("sha256", process.env.MAILGUN_EU_WEBHOOK_SIGNING_KEY!).update(timestamp + webhookToken).digest("hex") }, "event-data": { id: randomUUID(), event: "delivered", recipient: "owner-controlled@example.test", "user-variables": { job_id: job.id } } };
    expect(await recordMailgunWebhook(event)).toEqual({ accepted: true });
    expect(await recordMailgunWebhook(event)).toEqual({ accepted: true });
    expect(await db.select().from(emailProviderEvents)).toHaveLength(1);
    expect(await getCampaign({ actorUserId: f.ownerId, campaignId: first.id })).toMatchObject({ summary: { delivered: 1 }, attempts: [{ providerStatus: "delivered" }] });
    const link = provider.send.mock.calls[0][0].unsubscribeUrl!;
    await unsubscribeMarketing(new URLSearchParams(new URL(link).hash.slice(1)).get("token")!);
    const second = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: second.id, scheduledAt: when });
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    const next = jobs.at(-1)!;
    expect(await dispatchCampaign({ id: next.id, tenantId: next.tenantId, payload: next.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ queuedCount: 0 });
    expect(provider.send).toHaveBeenCalledTimes(1);
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: first.id })).summary.sent).toBe(1);
    expect(card.cardToken.startsWith("card_")).toBe(true);
  });

  it("suppresses a second promotional message within the customer frequency window", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "repeat@example.test", true, true);
    const send = vi.fn(async (message: LocalMessage) => { expect(message.to).toBe("repeat@example.test"); });
    for (let index = 0; index < 2; index++) {
      const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
      const when = new Date(Date.now() + 1_000);
      await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
      const dispatch = (await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"))).at(-1)!;
      await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000));
      const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
      const queued = jobs.at(-1);
      if (queued && (index === 0 || jobs.length > 1)) {
        const result = await deliverCampaignRecipient({ id: queued.id, tenantId: queued.tenantId, payload: queued.payload, attempts: 1 }, send);
        expect(result.status).toBe(index === 0 ? "complete" : "suppressed");
      }
    }
    expect(send).toHaveBeenCalledTimes(1);
    const previews = await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition });
    expect(previews.excludedCountsByReason.frequency).toBe(1);
  });

  it("enforces a configured location monthly reservation limit before queueing", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "first@example.test", true, true);
    await member(f.merchant.programSlug, "second@example.test", true, true);
    process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT = "1";
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: job.id, tenantId: job.tenantId, payload: job.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "blocked", reason: "Monthly location promotional quota exceeded" });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
  });

  it("suppresses cross-tenant, revoked-owner and closed-card delivery attempts", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug, "limited@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000));
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverCampaignRecipient({ id: job.id, tenantId: randomUUID(), payload: job.payload, attempts: 1 }, send)).toMatchObject({ status: "suppressed" });
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, f.ownerId));
    expect(await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send)).toMatchObject({ status: "suppressed", reason: "Queueing owner no longer authorized" });
    expect(send).not.toHaveBeenCalled();
    await closeCard(card.cardToken);
    expect((await db.select().from(campaignRecipients))[0].status).toBe("suppressed");
  });
  it("previews only verified, consented synthetic contacts and enforces owner scope", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "eligible@example.test", true, true);
    await member(f.merchant.programSlug, "unverified@example.test", false, true);
    await member(f.merchant.programSlug, "no-consent@example.test", true, false);
    await member(f.merchant.programSlug, "real@example.com", true, true);
    const preview = await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition });
    expect(preview).toMatchObject({ total: 4, eligibleCount: 1, excludedCountsByReason: { unverified: 1, noConsent: 1, nonSynthetic: 1, closed: 0, quota: 0 }, localOnly: true, dailyQuota: 100 });
    expect(JSON.stringify(preview)).not.toContain("@example");
    const cashierId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [cashierId, "Synthetic cashier", `${cashierId}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: f.merchant.tenantId, userId: cashierId, role: "cashier", locationId: f.merchant.locationId });
    await expect(createDraftCampaign({ actorUserId: cashierId, programSlug: f.merchant.programSlug, ...draftFields })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("edits drafts, versions schedule jobs, and keeps paused jobs stale", async () => {
    const f = await fixture();
    const created = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const edited = await editDraftCampaign({ actorUserId: f.ownerId, campaignId: created.id, ...draftFields, title: "Synthetic edited note" });
    expect(edited.title).toBe("Synthetic edited note");
    const when = new Date(Date.now() + 60_000);
    const scheduled = await scheduleCampaign({ actorUserId: f.ownerId, campaignId: created.id, scheduledAt: when });
    expect(scheduled).toMatchObject({ campaignId: created.id, status: "scheduled", scheduledAt: when });
    const firstJobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(firstJobs).toHaveLength(1);
    expect(firstJobs[0].payload).toMatchObject({ campaignId: created.id, scheduleRevision: "1" });
    await expect(editDraftCampaign({ actorUserId: f.ownerId, campaignId: created.id, ...draftFields })).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });
    expect(await pauseCampaign({ actorUserId: f.ownerId, campaignId: created.id })).toMatchObject({ campaignId: created.id, status: "paused" });
    expect(await dispatchCampaign({ id: firstJobs[0].id, tenantId: f.merchant.tenantId, payload: firstJobs[0].payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "suppressed" });
    const resumed = await scheduleCampaign({ actorUserId: f.ownerId, campaignId: created.id, scheduledAt: new Date(Date.now() + 120_000) });
    expect(resumed.status).toBe("scheduled");
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(jobs.map(job => job.payload.scheduleRevision)).toEqual(["1", "3"]);
  });

  it("reserves quota and queues one local outbox job per eligible member, then rechecks withdrawal", async () => {
    const f = await fixture();
    const first = await member(f.merchant.programSlug, "first@example.test", true, true);
    const second = await member(f.merchant.programSlug, "second@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatchJob] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatchJob.id, tenantId: f.merchant.tenantId, payload: dispatchJob.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "complete", queuedCount: 2 });
    expect(await db.select().from(campaignRecipients)).toHaveLength(2);
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    const emailJobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    expect(emailJobs).toHaveLength(2);
    expect(JSON.stringify(emailJobs)).not.toContain("@example.test");
    await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: second.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    for (const job of emailJobs) {
      await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "first@example.test" });
    expect(send.mock.calls[0][0].body).toContain("Abmelden:");
    expect((await db.select().from(campaignRecipients)).map(row => row.status).sort()).toEqual(["complete", "suppressed"]);
    expect(await db.select().from(campaignAttempts)).toHaveLength(2);
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).summary).toMatchObject({ sent: 1, suppressed: 1, queued: 0 });
    expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(2);
    expect([first.id, second.id].sort()).toEqual((await db.select().from(campaignRecipients)).map(row => row.membershipId).sort());
  });

  it("refuses to schedule while a required sender field is missing, naming it, and suppresses what was queued before", async () => {
    const where = (f: Awaited<ReturnType<typeof fixture>>) => eq(locations.id, f.merchant.locationId);
    const drops: Array<[string, (f: Awaited<ReturnType<typeof fixture>>) => Promise<unknown>]> = [
      ["Name des Geschäfts", f => db.update(tenants).set({ name: " " }).where(eq(tenants.id, f.merchant.tenantId))],
      ["Straße und Hausnummer", f => db.update(locations).set({ street: null }).where(where(f))],
      ["PLZ", f => db.update(locations).set({ postalCode: null }).where(where(f))],
      ["Stadt", f => db.update(locations).set({ city: "" }).where(where(f))],
      ["Vertreten durch", f => db.update(locations).set({ representative: null }).where(where(f))],
      ["Kontakt (E-Mail oder Telefon)", f => db.update(locations).set({ contactEmail: null, contactPhone: null }).where(where(f))],
    ];
    for (const [label, drop] of drops) {
      await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
      const f = await fixture();
      await member(f.merchant.programSlug, "first@example.test", true, true);
      const queued = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
      const when = new Date(Date.now() + 1_000);
      await scheduleCampaign({ actorUserId: f.ownerId, campaignId: queued.id, scheduledAt: when });
      const [dispatchJob] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
      await dispatchCampaign({ id: dispatchJob.id, tenantId: f.merchant.tenantId, payload: dispatchJob.payload }, new Date(when.getTime() + 1_000));
      await drop(f);
      const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
      await expect(scheduleCampaign({ actorUserId: f.ownerId, campaignId: draft.id, scheduledAt: when }), label).rejects.toMatchObject({ code: "ADDRESS_REQUIRED", message: expect.stringContaining(label) });
      expect((await listCampaigns({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug })).find(row => row.id === draft.id)?.status, label).toBe("draft");
      const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
      const send = vi.fn(async (message: LocalMessage) => { void message; });
      expect(await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send), label).toEqual({ status: "suppressed", reason: "Shop address missing" });
      expect(send, label).not.toHaveBeenCalled();
    }
  });

  it("suppresses a queued message when the member leaves the selected audience before delivery", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug, "reward-gap@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields,
      audienceDefinition: { kind: "close_to_reward", maxRemaining: 8 } });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ queuedCount: 1 });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverCampaignRecipient({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).toMatchObject({ status: "suppressed", reason: "No longer in selected audience" });
    expect(send).not.toHaveBeenCalled();
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).summary).toMatchObject({ sent: 0, suppressed: 1, queued: 0 });
  });

  it("blocks an over-quota batch before any recipients are queued", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "first@example.test", true, true);
    await member(f.merchant.programSlug, "second@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    await db.insert(campaignDailyUsage).values({ tenantId: f.merchant.tenantId, day: new Date().toISOString().slice(0, 10), queued: 99 });
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: job.id, tenantId: job.tenantId, payload: job.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "blocked" });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(99);
    expect((await db.select().from(campaigns))[0].status).toBe("blocked");
  });

  it("dispatches a due contact-free campaign through the real worker without sending", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, null, false, false);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: new Date() });
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), env: process.env, timeout: 10_000 });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(dispatch.status).toBe("complete");
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: "complete", audienceCount: 1, queuedCount: 0 });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))).toHaveLength(0);
  });
});

describe("win-back and announcement workflow", () => {
  const DAY = 86_400_000;
  async function checkoutAt(f: Awaited<ReturnType<typeof fixture>>, membershipId: string, at: Date) {
    await db.insert(ledgerEntries).values({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, membershipId, actorUserId: f.ownerId, createdAt: at,
      requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1 });
  }
  const winback = { kind: "inactive" as const, daysSinceLast: 30 };

  it("counts zero, one and many lapsed cards and follows eligibility changes", async () => {
    const f = await fixture();
    const preview = () => previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition: winback });
    const regular = await member(f.merchant.programSlug, "regular@example.test", true, true);
    await checkoutAt(f, regular.id, new Date(Date.now() - 2 * DAY));
    await member(f.merchant.programSlug, "never@example.test", true, true);
    expect(await preview()).toMatchObject({ total: 0, eligibleCount: 0 });

    const lapsed = await member(f.merchant.programSlug, "lapsed@example.test", true, true);
    await checkoutAt(f, lapsed.id, new Date(Date.now() - 45 * DAY));
    expect(await preview()).toMatchObject({ total: 1, eligibleCount: 1 });

    for (let index = 0; index < 4; index++) {
      const card = await member(f.merchant.programSlug, `lapsed-${index}@example.test`, true, index % 2 === 0);
      await checkoutAt(f, card.id, new Date(Date.now() - (40 + index) * DAY));
    }
    expect(await preview()).toMatchObject({ total: 5, eligibleCount: 3, excludedCountsByReason: { noConsent: 2 } });

    // Coming back moves a card out of the win-back audience.
    // Use the database clock: a host timestamp a few milliseconds ahead is correctly excluded as future activity.
    const databaseNow = (await pool.query<{ at: Date }>("SELECT clock_timestamp() AS at")).rows[0].at;
    await checkoutAt(f, lapsed.id, databaseNow);
    expect(await preview()).toMatchObject({ total: 4, eligibleCount: 2 });
  });

  it("saves a complete win-back draft when delivery is disabled but refuses to schedule it", async () => {
    process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "true"; // enabled flag without an approved provider means: disabled
    const f = await fixture();
    expect(await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition: winback })).toMatchObject({ deliveryMode: "disabled", localOnly: false });
    const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: winback });
    await expect(scheduleCampaign({ actorUserId: f.ownerId, campaignId: draft.id, scheduledAt: new Date(Date.now() + 60_000) })).rejects.toMatchObject({ code: "EMAIL_DISABLED" });
    const listed = await listCampaigns({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug });
    expect(listed).toEqual([expect.objectContaining({ id: draft.id, status: "draft", audienceDefinition: winback, queuedCount: 0 })]);
    expect(await db.select().from(outboxJobs)).toHaveLength(0);
  });

  it("returns the existing draft for an identical double submit, but not for a changed one", async () => {
    const f = await fixture();
    const input = { actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: winback };
    const [first, second] = await Promise.all([createDraftCampaign(input), createDraftCampaign(input)]);
    expect(second.id).toBe(first.id);
    const changed = await createDraftCampaign({ ...input, audienceDefinition: { kind: "inactive", daysSinceLast: 60 } });
    expect(changed.id).not.toBe(first.id);
    expect(await db.select().from(campaigns)).toHaveLength(2);
  });

  it("keeps drafts, previews and details inside the owner's tenant and rejects invalid audiences", async () => {
    const f = await fixture();
    const other = await fixture();
    const draft = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: winback });
    await expect(getCampaign({ actorUserId: other.ownerId, campaignId: draft.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(editDraftCampaign({ actorUserId: other.ownerId, campaignId: draft.id, ...draftFields })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(previewCampaign({ actorUserId: other.ownerId, programSlug: f.merchant.programSlug, audienceDefinition: winback })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDraftCampaign({ actorUserId: other.ownerId, programSlug: f.merchant.programSlug, ...draftFields })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: { kind: "inactive", daysSinceLast: 0 } })).rejects.toThrow();
    await expect(createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: { kind: "all", extra: true } as unknown as typeof winback })).rejects.toThrow();
    await expect(createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, subject: "Line\nbreak" })).rejects.toThrow();
  });

  it("announces to all open cards and reports, without attribution, who came back after the send", async () => {
    const f = await fixture();
    const back = await member(f.merchant.programSlug, "back@example.test", true, true);
    await member(f.merchant.programSlug, "quiet@example.test", true, true);
    const closed = await member(f.merchant.programSlug, "closed@example.test", true, true);
    await closeCard(closed.cardToken);
    const all = { kind: "all" as const };
    expect(await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition: all })).toMatchObject({ total: 2, eligibleCount: 2 });
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields, audienceDefinition: all });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatchJob] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatchJob.id, tenantId: f.merchant.tenantId, payload: dispatchJob.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "complete", queuedCount: 2 });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    for (const job of await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))) {
      await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send);
    }
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).outcome).toEqual({ sent: 2, returnedAfterSend: 0 });
    await checkoutAt(f, back.id, new Date(Date.now() + 1_000));
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).outcome).toEqual({ sent: 2, returnedAfterSend: 1 });
  });
});


it.each([499, 500, 501, 1001])("queues an eligible recipient beyond paginated membership boundaries (%i cards) without duplicates or foreign recipients", async count => {
  const f = await fixture();
  const foreign = await fixture();
  const foreignCard = await member(foreign.merchant.programSlug, "foreign@example.test", true, true);
  const { rows: [program] } = await pool.query<{ id: string }>("SELECT id FROM programs WHERE slug = $1", [f.merchant.programSlug]);
  await pool.query(`INSERT INTO memberships (tenant_id, program_id, scan_code, card_token)
    SELECT $1::uuid, $2::uuid, 'sc_' || gen_random_uuid()::text,
      'card_' || replace(gen_random_uuid()::text, '-', '') || '12345678'
    FROM generate_series(1, $3::int)`, [f.merchant.tenantId, program.id, count]);
  const { rows: [last, suppressed, withdrawn] } = await pool.query<{ id: string }>("SELECT id FROM memberships WHERE tenant_id = $1 ORDER BY id DESC LIMIT 3", [f.merchant.tenantId]);
  for (const row of [last, suppressed, withdrawn]) {
    await db.insert(membershipContacts).values({ tenantId: f.merchant.tenantId, membershipId: row.id, email: `${row.id}@example.test`, emailVerified: true });
    await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: row.id, channel: "email", purpose: "marketing", granted: row !== withdrawn, noticeVersion: "synthetic", source: "enrollment" });
  }
  await db.insert(emailSuppressions).values({ recipientHash: recipientHash(`${suppressed.id}@example.test`), reason: "complained" });
  const ids: string[] = [];
  let cursor: string | null = null;
  let asOf: Date | undefined;
  do {
    const page = await segmentQueries.selectAudience({ actorUserId: f.ownerId, programId: program.id, definition: audienceDefinition, limit: 500, ...(cursor ? { afterMembershipId: cursor } : {}), ...(asOf ? { asOf } : {}) });
    expect(page.total).toBe(count);
    ids.push(...page.membershipIds); cursor = page.nextCursor; asOf = new Date(page.asOf);
  } while (cursor);
  expect(ids).toHaveLength(count);
  expect(new Set(ids).size).toBe(count);
  expect(ids).toEqual([...ids].sort());
  expect(ids.at(-1)).toBe(last.id);
  expect(ids).not.toContain(foreignCard.id);
  if (count === 1001) {
    const original = segmentQueries.selectAudience;
    let pages = 0;
    const spy = vi.spyOn(segmentQueries, "selectAudience").mockImplementation(async input => {
      if (++pages === 2) throw new Error("Synthetic page interruption");
      return original(input);
    });
    try {
      await expect(previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition })).rejects.toThrow("Synthetic page interruption");
    } finally { spy.mockRestore(); }
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))).toHaveLength(0);
  }
  const preview = await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition });
  expect(preview).toMatchObject({ total: count, eligibleCount: 1, dailyQuota: 100, excludedCountsByReason: { unverified: count - 3, suppressed: 1, noConsent: 1, quota: 0 } });
  const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
  const when = new Date(Date.now() + 1000);
  await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
  const input = { id: job.id, tenantId: job.tenantId, payload: job.payload };
  expect(await dispatchCampaign(input, new Date(when.getTime() + 1000))).toMatchObject({ status: "complete", queuedCount: 1 });
  expect(await dispatchCampaign(input, new Date(when.getTime() + 1000))).toMatchObject({ status: "suppressed" });
  const recipients = await db.select().from(campaignRecipients);
  expect(recipients).toHaveLength(1);
  expect(recipients[0]).toMatchObject({ tenantId: f.merchant.tenantId, campaignId: campaign.id, membershipId: last.id });
  expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))).toHaveLength(1);
  expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(1);
});


it.each(["cancel", "reschedule"] as const)("suppresses stale dispatch after concurrent %s before authoritative campaign claim", async operation => {
  const f = await fixture(); const foreign = await fixture();
  const ownCard = await member(f.merchant.programSlug, "schedule@example.test", true, true);
  await member(foreign.merchant.programSlug, "foreign@example.test", true, true);
  const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
  const when = new Date(Date.now() + 1000);
  await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
  const [originalJob] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
  const input = { id: originalJob.id, tenantId: originalJob.tenantId, payload: originalJob.payload };
  let ready!: () => void; const read = new Promise<void>(resolve => { ready = resolve; });
  let release!: () => void; const resume = new Promise<void>(resolve => { release = resolve; });
  const original = segmentQueries.selectAudience;
  let paused = false;
  const spy = vi.spyOn(segmentQueries, "selectAudience").mockImplementation(async selection => {
    const rows = await original(selection);
    if (!paused && selection.programId === f.merchant.programId) { paused = true; ready(); await resume; }
    return rows;
  });
  let pending: ReturnType<typeof dispatchCampaign> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    pending = dispatchCampaign(input, new Date(when.getTime() + 1000));
    await Promise.race([read, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Actual audience read gate not reached")), 2000); })]);
    await expect(cancelCampaign({ actorUserId: foreign.ownerId, campaignId: campaign.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const replacement = new Date(when.getTime() + 60_000);
    if (operation === "cancel") await cancelCampaign({ actorUserId: f.ownerId, campaignId: campaign.id });
    else {
      await pauseCampaign({ actorUserId: f.ownerId, campaignId: campaign.id });
      await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: replacement });
    }
    release();
    expect(await pending).toMatchObject({ status: "suppressed", reason: "Campaign schedule changed" });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect(await db.select().from(campaignDailyUsage)).toHaveLength(0);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))).toHaveLength(0);
    if (operation === "reschedule") {
      const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
      const replacementJob = jobs.find(job => job.payload.scheduleRevision === "3")!;
      const replacementInput = { id: replacementJob.id, tenantId: replacementJob.tenantId, payload: replacementJob.payload };
      const results = await Promise.all([dispatchCampaign(replacementInput, new Date(replacement.getTime() + 1000)), dispatchCampaign(replacementInput, new Date(replacement.getTime() + 1000))]);
      expect(results.map(result => result.status).sort()).toEqual(["complete", "suppressed"]);
      const recipients = await db.select().from(campaignRecipients);
      expect(recipients).toHaveLength(1);
      expect(recipients[0]).toMatchObject({ tenantId: f.merchant.tenantId, campaignId: campaign.id, membershipId: ownCard.id });
      const deliveries = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({ tenantId: f.merchant.tenantId, payload: { campaignId: campaign.id, recipientId: recipients[0].id, membershipId: ownCard.id } });
      expect((await db.select().from(campaignDailyUsage))[0]).toMatchObject({ tenantId: f.merchant.tenantId, queued: 1 });
      expect(await dispatchCampaign(replacementInput, new Date(replacement.getTime() + 1000))).toMatchObject({ status: "suppressed" });
    }
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).campaign.status).toBe(operation === "cancel" ? "cancelled" : "dispatching");
  } finally {
    if (timeout) clearTimeout(timeout);
    release(); await Promise.allSettled([pending]); spy.mockRestore();
  }
});


it("keeps campaign summary and outcomes in one snapshot while a real recipient delivery commits", async () => {
  const f = await fixture();
  await member(f.merchant.programSlug, "snapshot@example.test", true, true);
  const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
  const when = new Date(Date.now() + 1_000);
  await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
  const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
  await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000));
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
  let readReady!: () => void; let release!: () => void;
  const read = new Promise<void>(resolve => { readReady = resolve; });
  const resume = new Promise<void>(resolve => { release = resolve; });
  let captured = false; let hold = true;
  const original = Client.prototype.query;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (hold && text?.startsWith("select") && text.includes('from "campaign_attempts"')) {
      if (typeof args.at(-1) === "function") { void resume.then(() => Reflect.apply(original, this, args)); return; }
      return resume.then(() => Reflect.apply(original, this, args));
    }
    if (captured || !text?.startsWith("select") || !text.includes('from "campaign_recipients"')) return Reflect.apply(original, this, args);
    captured = true;
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (...result: unknown[]) => { if (!result[0]) readReady(); Reflect.apply(callback, undefined, result); };
      return Reflect.apply(original, this, args);
    }
    return (Reflect.apply(original, this, args) as Promise<unknown>).then(result => { readReady(); return result; });
  }) as typeof original);
  let pending: ReturnType<typeof getCampaign> | undefined; let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    pending = getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id });
    await Promise.race([read, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Actual recipient report read not reached")), 2000); })]);
    // Ordinary production transition commits on another client while the report
    // is open. Synthetic sender performs no network/provider communication.
    const send = vi.fn(async () => {});
    await expect(deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send)).resolves.toMatchObject({ status: "complete" });
    expect(send).toHaveBeenCalledTimes(1);
    hold = false; release();
    const report = await pending;
    expect(report.summary.sent).toBe(report.outcome.sent);
    expect(report).toMatchObject({ campaign: { status: "dispatching" }, summary: { queued: 1, sent: 0, delivered: 0 }, attempts: [], outcome: { sent: 0, returnedAfterSend: 0 } });
    const fresh = await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id });
    expect(fresh).toMatchObject({ campaign: { status: "complete" }, summary: { queued: 0, sent: 1, delivered: 0 }, attempts: [{ status: "complete" }], outcome: { sent: 1, returnedAfterSend: 0 } });
  } finally {
    if (timeout) clearTimeout(timeout);
    hold = false; release(); await Promise.allSettled([pending]); spy.mockRestore();
  }
});


it("does not turn failed campaign reads into zero data and releases a reusable read-write connection", async () => {
  const f = await fixture();
  await member(f.merchant.programSlug, "failure@example.test", true, true);
  const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
  expect(await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).toMatchObject({
    summary: { queued: 0, sent: 0, delivered: 0, providerFailed: 0, suppressed: 0, failed: 0 }, attempts: [], outcome: { sent: 0, returnedAfterSend: 0 },
  });
  const when = new Date(Date.now() + 1_000);
  await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
  const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
  await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000));
  const original = Client.prototype.query;
  const captured: { client?: Client } = {};
  let rollbackObserved = false;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!captured.client && text?.startsWith("select") && text.includes('from "campaign_attempts"')) {
      captured.client = this;
      return Reflect.apply(original, this, ["select 1 / 0"]);
    }
    if (this === captured.client && text?.toLowerCase() === "rollback") rollbackObserved = true;
    return Reflect.apply(original, this, args);
  }) as typeof original);
  try {
    await expect(getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).rejects.toMatchObject({ cause: { code: "22012" } });
    expect(rollbackObserved).toBe(true);
    const client = await pool.connect();
    try {
      expect(client).toBe(captured.client);
      expect((await client.query("show transaction_read_only")).rows[0].transaction_read_only).toBe("off");
      await expect(client.query("select 1 as healthy")).resolves.toMatchObject({ rows: [{ healthy: 1 }] });
    } finally { client.release(); }
    const fresh = await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id });
    expect(fresh.summary.queued).toBe(1);
    await expect(getCampaign({ actorUserId: randomUUID(), campaignId: campaign.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  } finally { spy.mockRestore(); }
});


it("rechecks a real opt-out on the second audience page after preview and before queue reservation", async () => {
  const f = await fixture();
  await pool.query(`INSERT INTO memberships (tenant_id,program_id,scan_code,card_token)
    SELECT $1::uuid,$2::uuid,'sc_'||gen_random_uuid()::text,'card_'||replace(gen_random_uuid()::text,'-','')||'12345678'
    FROM generate_series(1,501)`, [f.merchant.tenantId,f.merchant.programId]);
  const boundary = (await pool.query("SELECT id FROM memberships WHERE tenant_id=$1 ORDER BY id DESC LIMIT 2",[f.merchant.tenantId])).rows;
  for (const row of boundary) {
    await db.insert(membershipContacts).values({tenantId:f.merchant.tenantId,membershipId:row.id,email:`${row.id}@example.test`,emailVerified:true});
    await db.insert(consentEvents).values({tenantId:f.merchant.tenantId,membershipId:row.id,channel:"email",purpose:"marketing",granted:true,noticeVersion:"synthetic",source:"enrollment"});
  }
  const preview=()=>previewCampaign({actorUserId:f.ownerId,programSlug:f.merchant.programSlug,audienceDefinition:{kind:"all"}});
  expect(await preview()).toMatchObject({total:501,eligibleCount:2});
  const token=createUnsubscribeToken({tenantId:f.merchant.tenantId,membershipId:boundary[0].id,email:`${boundary[0].id}@example.test`});
  expect(await unsubscribeMarketing(token)).toEqual({status:"complete"});
  expect(await preview()).toMatchObject({total:501,eligibleCount:1,excludedCountsByReason:{unsubscribed:1}});
  const campaign=await createDraftCampaign({actorUserId:f.ownerId,programSlug:f.merchant.programSlug,...draftFields});
  const when=new Date(Date.now()+1000);await scheduleCampaign({actorUserId:f.ownerId,campaignId:campaign.id,scheduledAt:when});
  const [dispatch]=await db.select().from(outboxJobs).where(eq(outboxJobs.kind,"campaign.dispatch"));
  const job={id:dispatch.id,tenantId:dispatch.tenantId,payload:dispatch.payload};
  expect(await dispatchCampaign(job,new Date(when.getTime()+1000))).toMatchObject({status:"complete",queuedCount:1});
  expect(await dispatchCampaign(job,new Date(when.getTime()+1000))).toMatchObject({status:"suppressed"});
  expect(await db.select().from(campaignRecipients)).toEqual([expect.objectContaining({tenantId:f.merchant.tenantId,membershipId:boundary[1].id})]);
  expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind,"email.campaign"))).toHaveLength(1);
  expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(1);
});
