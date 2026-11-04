import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { emailDeliveries, emailProviderEvents, emailSuppressions, emailUnsubscribes, outboxJobs, tenants } from "@/db/schema";
import { emailTransportMode, mailgunEuProvider, promotionalEmailMode, promotionalProvider, pruneEmailSuppressions, recordMailgunWebhook, recipientHash, sendPromotional, sendTransactional, verifyMailgunWebhook } from "./transactional-email";
import { POST as webhookPost } from "../app/api/email/mailgun/webhook/route";
import { productionConfigIssues } from "../../scripts/config-check";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Email adapter tests require looplocal_test");
const original = { ...process.env };
const secret = "synthetic-mailgun-api-key-not-real";
const signing = "synthetic-mailgun-signing-key-not-real";
const config: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", PUBLIC_BASE_URL: "https://test.example.test", EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_SEND_APPROVED: "true", MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "service@mail.example.test", MAILGUN_EU_API_KEY: secret, MAILGUN_EU_WEBHOOK_SIGNING_KEY: signing };
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE email_provider_events, email_suppressions, email_unsubscribes, tenants, "user", demo_requests CASCADE');
  process.env.BETTER_AUTH_SECRET = "synthetic-email-hashing-secret-long-enough-for-tests";
  process.env.PUBLIC_BASE_URL = "https://test.example.test";
  process.env.EXTERNAL_EMAIL_ENABLED = "true";
  process.env.MAILGUN_SEND_APPROVED = "true";
  process.env.MAILGUN_EU_DOMAIN = "mail.example.test";
  process.env.MAILGUN_FROM_EMAIL = "service@mail.example.test";
  process.env.MAILGUN_EU_API_KEY = secret;
  process.env.MAILGUN_EU_WEBHOOK_SIGNING_KEY = signing;
});
afterAll(async () => { for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key]; Object.assign(process.env, original); await pool.end(); });

async function job() {
  const [tenant] = await db.insert(tenants).values({ name: "Synthetic email tenant", slug: randomUUID() }).returning();
  const [queued] = await db.insert(outboxJobs).values({ tenantId: tenant.id, kind: "email.verify", payload: {} }).returning();
  return queued;
}
function signed(event: string, jobId: string, id = randomUUID()) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const token = randomBytes(25).toString("hex");
  const signature = createHmac("sha256", signing).update(timestamp + token).digest("hex");
  return { signature: { timestamp, token, signature }, "event-data": { id, event, recipient: "holder@example.test", "user-variables": { job_id: jobId } } };
}

describe("disabled by default Mailgun EU transactional adapter", () => {
  it("keeps promotional sending independent of a working transactional provider", async () => {
    expect(emailTransportMode(config)).toBe("mailgun_eu");
    expect(promotionalEmailMode(config)).toBe("disabled");
    const approved = { ...config, PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_PROMOTIONAL_SEND_APPROVED: "true", PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24", PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.example.test", PROMOTIONAL_UNSUBSCRIBE_SECRET: "synthetic-unsubscribe-secret-long-enough" };
    expect(promotionalEmailMode({ ...approved, PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "" })).toBe("disabled");
    expect(promotionalEmailMode({ ...approved, PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "" })).toBe("disabled");
    expect(promotionalEmailMode({ ...approved, PROMOTIONAL_UNSUBSCRIBE_ORIGIN: config.PUBLIC_BASE_URL })).toBe("disabled");
    expect(promotionalEmailMode(approved)).toBe("mailgun_eu");
    const saved = { external: process.env.EXTERNAL_EMAIL_ENABLED, base: process.env.PUBLIC_BASE_URL, smtp: process.env.SMTP_HOST };
    try {
      process.env.EXTERNAL_EMAIL_ENABLED = "false";
      process.env.PUBLIC_BASE_URL = "http://localhost:3000";
      process.env.SMTP_HOST = "localhost";
      process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "true";
      delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
      expect(promotionalEmailMode()).toBe("disabled");
    } finally {
      process.env.EXTERNAL_EMAIL_ENABLED = saved.external;
      process.env.PUBLIC_BASE_URL = saved.base;
      if (saved.smtp === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = saved.smtp;
      delete process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED;
    }
    const production = { ...approved, DATABASE_URL: "postgresql://real:unique@db.example.test/app", BETTER_AUTH_URL: "https://test.example.test", BETTER_AUTH_SECRET: "a".repeat(40) };
    expect(productionConfigIssues({ ...production, MAILGUN_PROMOTIONAL_SEND_APPROVED: "false" })).toContain("Promotional email requires separate approval, public unsubscribe origin and configured location/customer safety limits");
    expect(productionConfigIssues({ ...production, PROMOTIONAL_UNSUBSCRIBE_ORIGIN: config.PUBLIC_BASE_URL })).toContain("Promotional email requires separate approval, public unsubscribe origin and configured location/customer safety limits");
    const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
      const body = options?.body as FormData;
      expect(body.get("o:tracking")).toBe("no");
      expect(body.get("h:List-Unsubscribe")).toContain("/unsubscribe#token=");
      return Response.json({ id: "<promo@example.test>" });
    });
    expect(await promotionalProvider(approved, request as typeof fetch)?.send({ to: "holder@example.test", subject: "Synthetic offer", body: "Synthetic message", jobId: randomUUID(), unsubscribeUrl: "https://test.example.test/unsubscribe#token=synthetic" })).toEqual({ state: "accepted", messageId: "<promo@example.test>" });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not resend a promotional job after accepted or ambiguous provider outcome", async () => {
    const queued = await job();
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "ambiguous" as const })) };
    const message = { to: "holder@example.test", subject: "Synthetic offer", body: "Synthetic message", jobId: queued.id };
    expect(await sendPromotional(message, provider)).toMatchObject({ status: "blocked" });
    expect(await sendPromotional(message, provider)).toMatchObject({ status: "blocked" });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("requires explicit approval and complete EU configuration", () => {
    expect(emailTransportMode({ ...config, MAILGUN_SEND_APPROVED: "false" })).toBe("disabled");
    expect(mailgunEuProvider({ ...config, MAILGUN_EU_API_KEY: "" })).toBeNull();
    expect(productionConfigIssues({ ...config, DATABASE_URL: "postgresql://real:unique@db.example.test/app", BETTER_AUTH_URL: "https://test.example.test", BETTER_AUTH_SECRET: "a".repeat(40), MAILGUN_SEND_APPROVED: "false" })).toContain("External email requires approved Mailgun EU sender, domain, API key and webhook signing key");
    expect(mailgunEuProvider(config)?.name).toBe("mailgun_eu");
    expect(verifyMailgunWebhook(signed("delivered", randomUUID()), { ...config, EXTERNAL_EMAIL_ENABLED: "false" })).not.toBeNull();
  });

  it("uses only the EU endpoint, returns acceptance, handles hard reject and uncertain outcomes without logging secrets", async () => {
    const request = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      expect(String(url)).toBe("https://api.eu.mailgun.net/v3/mail.example.test/messages");
      expect(options?.method).toBe("POST");
      return Response.json({ id: "<accepted@example.test>" });
    });
    const message = { to: "holder@example.test", subject: "Verify", body: "Synthetic message", jobId: randomUUID() };
    expect(await mailgunEuProvider(config, request as typeof fetch)!.send(message)).toEqual({ state: "accepted", messageId: "<accepted@example.test>" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(await mailgunEuProvider(config, vi.fn(async () => new Response(null, { status: 400 })) as typeof fetch)!.send(message)).toEqual({ state: "permanent_failure" });
    expect(await mailgunEuProvider(config, vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch)!.send(message)).toEqual({ state: "ambiguous" });
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await mailgunEuProvider(config, vi.fn(async () => { throw new Error(secret); }) as typeof fetch)!.send(message)).toEqual({ state: "ambiguous" });
    expect(logged).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  it("sends from the configured address, with the shop's display name only when one is given and never a second header line", async () => {
    const froms: unknown[] = [];
    const request = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => { froms.push((options?.body as FormData).get("from")); return Response.json({ id: "<from@example.test>" }); });
    const provider = mailgunEuProvider(config, request as typeof fetch)!;
    const message = { to: "holder@example.test", subject: "Offer", body: "Synthetic message", jobId: randomUUID() };
    await provider.send(message);
    await provider.send({ ...message, fromName: "Café Müller via Loynara" });
    await provider.send({ ...message, fromName: 'Bad "Shop"\\\r\nBcc: x@example.test via Loynara' });
    expect(froms).toEqual(["service@mail.example.test", '"Café Müller via Loynara" <service@mail.example.test>', '"Bad \\"Shop\\"\\\\  Bcc: x@example.test via Loynara" <service@mail.example.test>']);
  });

  it("records accepted sends once and idempotent signed delivery/complaint events, then suppresses future sends", async () => {
    const queued = await job();
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: "<synthetic@example.test>" })) };
    const message = { to: "holder@example.test", subject: "Recover", body: "Synthetic content", jobId: queued.id };
    expect(await sendTransactional(message, provider)).toEqual({ status: "complete" });
    expect(await sendTransactional(message, provider)).toMatchObject({ status: "blocked" });
    expect(provider.send).toHaveBeenCalledTimes(1);
    const wrongRecipient = signed("complained", queued.id);
    await recordMailgunWebhook({ ...wrongRecipient, "event-data": { ...wrongRecipient["event-data"], recipient: "other@example.test" } });
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    await recordMailgunWebhook(signed("temporary_fail", queued.id));
    expect((await db.select().from(emailDeliveries))[0].status).toBe("temporary_failure");
    await recordMailgunWebhook(signed("accepted", queued.id));
    expect((await db.select().from(emailDeliveries))[0].status).toBe("temporary_failure");
    const delivered = signed("delivered", queued.id);
    expect(verifyMailgunWebhook(delivered)).not.toBeNull();
    expect(await recordMailgunWebhook(delivered)).toEqual({ accepted: true });
    expect(await recordMailgunWebhook(delivered)).toEqual({ accepted: true });
    expect(await recordMailgunWebhook({ ...delivered, "event-data": { ...delivered["event-data"], id: randomUUID(), event: "complained" } })).toEqual({ accepted: true });
    expect((await db.select().from(emailProviderEvents))).toHaveLength(3);
    expect((await db.select().from(emailDeliveries))[0].status).toBe("delivered");
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    await recordMailgunWebhook(signed("complained", queued.id));
    expect((await db.select().from(emailSuppressions).where(eq(emailSuppressions.recipientHash, recipientHash(message.to))))).toHaveLength(1);
    const another = await job();
    expect(await sendTransactional({ ...message, jobId: another.id }, provider)).toMatchObject({ status: "suppressed" });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it("rejects forged, stale and malformed webhook signatures", async () => {
    const queued = await job();
    const event = signed("permanent_fail", queued.id);
    expect(verifyMailgunWebhook({ ...event, signature: { ...event.signature, signature: "0".repeat(64) } })).toBeNull();
    expect(verifyMailgunWebhook({ ...event, signature: { ...event.signature, timestamp: "1000000000" } })).toBeNull();
    expect(await recordMailgunWebhook({ ...event, signature: { ...event.signature, signature: "0".repeat(64) } })).toEqual({ accepted: false });
    expect(await db.select().from(emailProviderEvents)).toHaveLength(0);
  });

  it("does not treat a marketing unsubscribe event as withdrawal of requested recovery mail", async () => {
    const first = await job();
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: "<synthetic@example.test>" })) };
    await sendTransactional({ to: "holder@example.test", subject: "Verify", body: "Synthetic", jobId: first.id }, provider);
    await recordMailgunWebhook(signed("unsubscribed", first.id));
    const second = await job();
    expect(await sendTransactional({ to: "holder@example.test", subject: "Recovery", body: "Synthetic", jobId: second.id }, provider)).toEqual({ status: "complete" });
  });

  it("preserves a webhook delivery that arrives before the sending response", async () => {
    const queued = await job();
    const provider = { name: "mailgun_eu" as const, async send() {
      await recordMailgunWebhook(signed("delivered", queued.id));
      return { state: "accepted" as const, messageId: "<race@example.test>" };
    } };
    expect(await sendTransactional({ to: "holder@example.test", subject: "Recovery", body: "Synthetic", jobId: queued.id }, provider)).toEqual({ status: "complete" });
    const [recorded] = await db.select().from(emailDeliveries);
    expect(recorded.status).toBe("delivered");
    expect(recorded.providerMessageId).toBe("<race@example.test>");
  });
});


function failure(severity: unknown, jobId: string, eventId = randomUUID()) {
  const payload = signed("failed", jobId, eventId);
  return { ...payload, "event-data": { ...payload["event-data"], severity } };
}
async function sentJob(messageId = `<${randomUUID()}@example.test>`, address = "holder@example.test") {
  const queued = await job();
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId })) };
  await sendTransactional({ to: address, subject: "Synthetic", body: "Synthetic", jobId: queued.id }, provider);
  return { queued, provider, messageId };
}

describe("LOY-139 documented Mailgun failure payloads", () => {
  it.each(["temporary", "permanent"] as const)("normalizes authenticated %s failure and records one canonical event", async severity => {
    const { queued, provider } = await sentJob();
    const event = failure(severity, queued.id);
    const kind = severity === "temporary" ? "temporary_fail" : "permanent_fail";
    expect(verifyMailgunWebhook(event)?.["event-data"].event).toBe(kind);
    expect(await recordMailgunWebhook(event)).toEqual({ accepted: true });
    expect(await recordMailgunWebhook(event)).toEqual({ accepted: true });
    expect(await db.select().from(emailProviderEvents)).toEqual([expect.objectContaining({ event: kind, jobId: queued.id })]);
    expect((await db.select().from(emailDeliveries))[0].status).toBe(severity === "temporary" ? "temporary_failure" : "permanent_failure");
    expect(await db.select().from(emailSuppressions)).toHaveLength(severity === "temporary" ? 0 : 1);
    expect(await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: queued.id }, provider)).not.toEqual({ status: "complete" });
    expect(provider.send).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, "", "future", null, 42])("rejects failed events with invalid severity %s without mutations", async severity => {
    const event = failure(severity, randomUUID());
    expect(verifyMailgunWebhook(event)).toBeNull();
    expect(await recordMailgunWebhook(event)).toEqual({ accepted: false });
    expect(await db.select().from(emailProviderEvents)).toHaveLength(0);
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  });

  it("rejects forged/stale real failures and nonempty variable arrays", async () => {
    const event = failure("permanent", randomUUID());
    for (const payload of [
      { ...event, signature: { ...event.signature, signature: "0".repeat(64) } },
      { ...event, signature: { ...event.signature, timestamp: "1000000000" } },
      { ...event, "event-data": { ...event["event-data"], "user-variables": [{ job_id: randomUUID() }] } },
    ]) {
      expect(await recordMailgunWebhook(payload)).toEqual({ accepted: false });
    }
    expect(await db.select().from(emailProviderEvents)).toHaveLength(0);
  });

  it("correlates documented empty variables by bracket-independent provider message ID", async () => {
    const { queued, messageId } = await sentJob();
    const event = failure("permanent", queued.id);
    const payload = { ...event, "event-data": { ...event["event-data"], "user-variables": [], message: { headers: { "message-id": messageId.slice(1, -1) } } } };
    expect(await recordMailgunWebhook(payload)).toEqual({ accepted: true });
    expect((await db.select().from(emailDeliveries))[0].status).toBe("permanent_failure");
    expect((await db.select().from(emailProviderEvents))[0].jobId).toBe(queued.id);
  });

  it("does not correlate unmatched, contradictory, or wrong-recipient events to another tenant", async () => {
    const first = await sentJob();
    const second = await sentJob(); // same customer, distinct tenant and job
    const event = failure("permanent", first.queued.id);
    await recordMailgunWebhook({ ...event, "event-data": { ...event["event-data"], message: { headers: { "message-id": second.messageId } } } });
    const unmatched = failure("permanent", randomUUID());
    await recordMailgunWebhook(unmatched);
    const wrong = failure("permanent", first.queued.id);
    await recordMailgunWebhook({ ...wrong, "event-data": { ...wrong["event-data"], recipient: "other@example.test" } });
    expect((await db.select().from(emailDeliveries)).map(row => row.status)).toEqual(["accepted", "accepted"]);
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    expect((await db.select().from(emailProviderEvents)).filter(row => row.jobId !== null)).toHaveLength(0);
  });

  it("does not guess a tenant when provider message IDs are ambiguous", async () => {
    const messageId = `<shared-${randomUUID()}@example.test>`;
    await sentJob(messageId);
    await sentJob(messageId);
    const event = failure("permanent", randomUUID());
    await recordMailgunWebhook({ ...event, "event-data": { ...event["event-data"], "user-variables": [], message: { headers: { "message-id": messageId } } } });
    expect((await db.select().from(emailDeliveries)).map(row => row.status)).toEqual(["accepted", "accepted"]);
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  });

  it("keeps terminal permanent failure after late accepted, temporary and delivered events", async () => {
    const { queued } = await sentJob();
    await recordMailgunWebhook(failure("temporary", queued.id));
    await recordMailgunWebhook(failure("permanent", queued.id));
    await recordMailgunWebhook(failure("temporary", queued.id));
    await recordMailgunWebhook(signed("accepted", queued.id));
    await recordMailgunWebhook(signed("delivered", queued.id));
    expect((await db.select().from(emailDeliveries))[0]).toMatchObject({ status: "permanent_failure", retryAt: null });
    expect(await db.select().from(emailSuppressions)).toHaveLength(1);
  });

  it("deduplicates both event ID and signature token, including concurrent redelivery", async () => {
    const { queued } = await sentJob();
    const event = failure("temporary", queued.id);
    await Promise.all([recordMailgunWebhook(event), recordMailgunWebhook(event)]);
    await recordMailgunWebhook({ ...event, "event-data": { ...event["event-data"], id: randomUUID(), severity: "permanent" } });
    const another = failure("permanent", queued.id, event["event-data"].id);
    await recordMailgunWebhook(another);
    expect(await db.select().from(emailProviderEvents)).toHaveLength(1);
    expect((await db.select().from(emailDeliveries))[0].status).toBe("temporary_failure");
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  });
});


it("requires a recipient on real failure events even when outbound sending is paused", async () => {
  const event = failure("permanent", randomUUID());
  const data: Record<string, unknown> = { ...event["event-data"] };
  delete data.recipient;
  expect(verifyMailgunWebhook({ ...event, "event-data": data })).toBeNull();
  expect(verifyMailgunWebhook(event, { ...config, EXTERNAL_EMAIL_ENABLED: "false" })?.["event-data"].event).toBe("permanent_fail");
});

it("does not downgrade a delivered message on a late temporary failure", async () => {
  const { queued } = await sentJob();
  await recordMailgunWebhook(signed("delivered", queued.id));
  await recordMailgunWebhook(failure("temporary", queued.id));
  expect((await db.select().from(emailDeliveries))[0].status).toBe("delivered");
  expect(await db.select().from(emailSuppressions)).toHaveLength(0);
});

it("real temporary delivery failure clears sender-throttling retry and cannot resend", async () => {
  const queued = await job();
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "rate_limited" as const, retryAt: new Date(Date.now() + 60_000) })) };
  const message = { to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: queued.id };
  expect(await sendPromotional(message, provider)).toMatchObject({ status: "retry" });
  await recordMailgunWebhook(failure("temporary", queued.id));
  expect((await db.select().from(emailDeliveries))[0]).toMatchObject({ status: "temporary_failure", retryAt: null });
  expect(await sendPromotional(message, provider)).toMatchObject({ status: "blocked" });
  expect(provider.send).toHaveBeenCalledTimes(1);
});


it("rejects cross-tenant message correlation before the sending job obtains its provider ID", async () => {
  const other = await sentJob();
  const queued = await job();
  const provider = { name: "mailgun_eu" as const, async send() {
    const event = failure("permanent", queued.id);
    await recordMailgunWebhook({ ...event, "event-data": { ...event["event-data"], message: { headers: { "message-id": other.messageId } } } });
    return { state: "accepted" as const, messageId: `<pending-${randomUUID()}@example.test>` };
  } };
  expect(await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: queued.id }, provider)).toEqual({ status: "complete" });
  expect((await db.select().from(emailDeliveries)).map(row => row.status)).toEqual(["accepted", "accepted"]);
  expect(await db.select().from(emailSuppressions)).toHaveLength(0);
});

it("preserves a legitimate real failure arriving before the provider response", async () => {
  const queued = await job();
  const messageId = `<early-${randomUUID()}@example.test>`;
  const provider = { name: "mailgun_eu" as const, async send() {
    const event = failure("permanent", queued.id);
    await recordMailgunWebhook({ ...event, "event-data": { ...event["event-data"], message: { headers: { "message-id": messageId.slice(1, -1) } } } });
    return { state: "accepted" as const, messageId };
  } };
  await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: queued.id }, provider);
  expect((await db.select().from(emailDeliveries))[0]).toMatchObject({ status: "permanent_failure", providerMessageId: messageId });
  expect(await db.select().from(emailSuppressions)).toHaveLength(1);
});


it.each(["complained", "permanent_fail"] as const)("preserves %s suppression after a later unsubscribe from another delivery", async hardReason => {
  const first = await job(); const second = await job();
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
  const message = { to: "holder@example.test", subject: "Synthetic recovery", body: "Synthetic only" };
  await sendTransactional({ ...message, jobId: first.id }, provider);
  await sendTransactional({ ...message, jobId: second.id }, provider);
  await recordMailgunWebhook(signed(hardReason, first.id));
  const unsubscribe = signed("unsubscribed", second.id);
  await recordMailgunWebhook(unsubscribe);
  await recordMailgunWebhook(unsubscribe);
  expect((await db.select().from(emailSuppressions))[0].reason).toBe(hardReason);
  expect(await db.select().from(emailProviderEvents)).toHaveLength(2);
  expect(await sendTransactional({ ...message, jobId: (await job()).id }, provider)).toMatchObject({ status: "suppressed" });
  expect(await sendPromotional({ ...message, jobId: (await job()).id }, provider)).toMatchObject({ status: "suppressed" });
  expect(provider.send).toHaveBeenCalledTimes(2);
});

it("records a provider unsubscribe for the sending job's shop only, and leaves recovery mail and other shops alone (ENG-170)", async () => {
  const first = await job(); const other = await job();
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
  const message = { to: "holder@example.test", subject: "Synthetic", body: "Synthetic only" };
  await sendTransactional({ ...message, jobId: first.id }, provider);
  // The payload names another job's tenant nowhere: the shop comes from our own job row.
  await recordMailgunWebhook(signed("unsubscribed", first.id));
  expect(await db.select().from(emailUnsubscribes)).toEqual([expect.objectContaining({ tenantId: first.tenantId, recipientHash: recipientHash(message.to) })]);
  expect(await db.select().from(emailSuppressions)).toHaveLength(0);
  expect(await sendTransactional({ ...message, jobId: (await job()).id }, provider)).toMatchObject({ status: "complete" });
  expect((await db.select().from(emailUnsubscribes)).some(row => row.tenantId === other.tenantId)).toBe(false);
});

it("migration 0048 moves an old global unsubscribe to every shop that mailed the address and keeps one no mail explains as a global marketing block", async () => {
  // Shop A mailed holder@ and got the unsubscribe event; shop B mailed holder@ too, without one. Nobody mailed orphan@.
  const { queued: a } = await sentJob();
  await recordMailgunWebhook(signed("unsubscribed", a.id));
  const { queued: b } = await sentJob();
  const [mapped, orphan, hard] = [recipientHash("holder@example.test"), recipientHash("orphan@example.test"), recipientHash("hard@example.test")];
  await db.delete(emailUnsubscribes);
  // The rows as the old code wrote them.
  await db.insert(emailSuppressions).values([{ recipientHash: mapped, reason: "unsubscribed" }, { recipientHash: orphan, reason: "unsubscribed" }, { recipientHash: hard, reason: "complained" }]);
  const statements = readFileSync(join(process.cwd(), "drizzle/0048_shop_unsubscribes.sql"), "utf8").split("--> statement-breakpoint").map(part => part.trim()).filter(part => /^(--[^\n]*\n)*(UPDATE|INSERT|DELETE)/.test(part));
  expect(statements).toHaveLength(3);
  for (const statement of statements) await pool.query(statement);
  expect((await db.select().from(emailUnsubscribes)).map(row => [row.tenantId, row.recipientHash]).sort()).toEqual([[a.tenantId, mapped], [b.tenantId, mapped]].sort());
  expect((await db.select().from(emailSuppressions)).map(row => [row.recipientHash, row.reason]).sort()).toEqual([[hard, "complained"], [orphan, "unsubscribed"]].sort());
  // The kept orphan still blocks marketing, never requested recovery mail.
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
  const orphanMail = { to: "orphan@example.test", subject: "Synthetic", body: "Synthetic only" };
  expect(await sendPromotional({ ...orphanMail, jobId: (await job()).id }, provider)).toMatchObject({ status: "suppressed" });
  expect(await sendTransactional({ ...orphanMail, jobId: (await job()).id }, provider)).toMatchObject({ status: "complete" });
});

it("keeps an address blocked through the switch to SUPPRESSION_HASH_SECRET and writes new rows under the new key (ENG-170)", async () => {
  const previous = process.env.SUPPRESSION_HASH_SECRET;
  delete process.env.SUPPRESSION_HASH_SECRET;
  try {
    // Before the switch: a delivery and its complaint, both hashed with the login secret.
    const { queued } = await sentJob();
    await recordMailgunWebhook(signed("complained", queued.id));
    const oldHash = recipientHash("holder@example.test");
    process.env.SUPPRESSION_HASH_SECRET = "synthetic-suppression-hash-key-0123456789";
    const newHash = recipientHash("holder@example.test");
    expect(newHash).not.toBe(oldHash);
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
    expect(await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic only", jobId: (await job()).id }, provider)).toMatchObject({ status: "suppressed" });
    expect(provider.send).not.toHaveBeenCalled();
    // A late event for the old-key delivery still matches it, and its row is written under the new key.
    await recordMailgunWebhook(signed("unsubscribed", queued.id));
    expect((await db.select().from(emailUnsubscribes)).map(row => row.recipientHash)).toEqual([newHash]);
    await recordMailgunWebhook(signed("permanent_fail", queued.id));
    expect((await db.select().from(emailSuppressions)).map(row => row.recipientHash).sort()).toEqual([oldHash, newHash].sort());
  } finally {
    if (previous === undefined) delete process.env.SUPPRESSION_HASH_SECRET; else process.env.SUPPRESSION_HASH_SECRET = previous;
  }
});

it("keeps old-key rows matching through a BETTER_AUTH_SECRET rotation once the old value sits in SUPPRESSION_LEGACY_HASH_SECRET (ENG-170 G-1)", async () => {
  const saved = { auth: process.env.BETTER_AUTH_SECRET, key: process.env.SUPPRESSION_HASH_SECRET, legacy: process.env.SUPPRESSION_LEGACY_HASH_SECRET };
  delete process.env.SUPPRESSION_HASH_SECRET; delete process.env.SUPPRESSION_LEGACY_HASH_SECRET;
  try {
    // A complaint stored before ENG-170, under the login secret of that time.
    const { queued } = await sentJob();
    await recordMailgunWebhook(signed("complained", queued.id));
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
    const recovery = async () => sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic only", jobId: (await job()).id }, provider);
    // The deploy sets the new key; the operator then moves the old login secret aside and rotates it.
    process.env.SUPPRESSION_HASH_SECRET = "synthetic-suppression-hash-key-0123456789";
    process.env.SUPPRESSION_LEGACY_HASH_SECRET = saved.auth;
    process.env.BETTER_AUTH_SECRET = "synthetic-rotated-login-secret-0123456789abc";
    expect(await recovery()).toMatchObject({ status: "suppressed" });
    // Without the legacy setting the old row would no longer match: exactly what G-1 guards against.
    delete process.env.SUPPRESSION_LEGACY_HASH_SECRET;
    expect(await recovery()).toMatchObject({ status: "complete" });
  } finally {
    for (const [name, value] of [["BETTER_AUTH_SECRET", saved.auth], ["SUPPRESSION_HASH_SECRET", saved.key], ["SUPPRESSION_LEGACY_HASH_SECRET", saved.legacy]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

it("refreshes a hard suppression's last event and forgets it 24 months after that, not before (ENG-170)", async () => {
  const { queued } = await sentJob();
  await recordMailgunWebhook(signed("permanent_fail", queued.id));
  const hash = recipientHash("holder@example.test");
  const old = new Date("2024-01-01T00:00:00Z");
  await db.update(emailSuppressions).set({ lastEventAt: old, createdAt: old });
  await recordMailgunWebhook(signed("complained", queued.id));
  const [row] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.recipientHash, hash));
  expect(row.reason).toBe("complained");
  expect(row.lastEventAt.getTime()).toBeGreaterThan(old.getTime());
  expect(await pruneEmailSuppressions(new Date(row.lastEventAt.getTime() + 700 * 86_400_000))).toBe(0);
  expect(await pruneEmailSuppressions(new Date(row.lastEventAt.getTime() + 732 * 86_400_000))).toBe(1);
  expect(await db.select().from(emailSuppressions)).toHaveLength(0);
});

it.each(["complained", "permanent_fail"] as const)("keeps hard %s delivery terminal after unsubscribe and upgrades earlier unsubscribe", async reason => {
  const { queued } = await sentJob();
  await recordMailgunWebhook(signed(reason, queued.id));
  await recordMailgunWebhook(signed("unsubscribed", queued.id));
  expect((await db.select().from(emailDeliveries))[0].status).toBe(reason === "permanent_fail" ? "permanent_failure" : "complained");
  expect((await db.select().from(emailSuppressions))[0].reason).toBe(reason);
});

it.each(["complained", "permanent_fail"] as const)("upgrades a prior promotional unsubscribe to %s suppression", async reason => {
  const { queued } = await sentJob();
  await recordMailgunWebhook(signed("unsubscribed", queued.id));
  await recordMailgunWebhook(signed(reason, queued.id));
  expect((await db.select().from(emailSuppressions))[0].reason).toBe(reason);
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: "<unused@example.test>" })) };
  expect(await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: (await job()).id }, provider)).toMatchObject({ status: "suppressed" });
  expect(provider.send).not.toHaveBeenCalled();
});


it.each(["delivery update", "suppression insert"] as const)("retries a signed complaint atomically after PostgreSQL failure at %s", async failurePoint => {
  const first = await job(); const other = await job();
  const provider = { name: "mailgun_eu" as const, send: vi.fn(async () => ({ state: "accepted" as const, messageId: `<${randomUUID()}@example.test>` })) };
  await sendTransactional({ to: "holder@example.test", subject: "Synthetic", body: "Synthetic", jobId: first.id }, provider);
  await sendTransactional({ to: "other@example.test", subject: "Synthetic", body: "Synthetic", jobId: other.id }, provider);
  const event = signed("complained", first.id);
  const request = (body: unknown) => new Request("http://localhost:3000/api/email/mailgun/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const query = Client.prototype.query;
  let injected = false;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0]; const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    const target = failurePoint === "delivery update" ? text?.startsWith('update "email_deliveries"') : text?.startsWith('insert into "email_suppressions"');
    if (!injected && target) {
      injected = true;
      // Cause a real PostgreSQL error after deduplication, not a fabricated
      // result or handler mock. At suppression insert, delivery already changed
      // within the transaction and must also roll back.
      return Reflect.apply(query, this, ["select 1 / 0"]);
    }
    return Reflect.apply(query, this, args);
  }) as typeof query);
  try {
    expect((await webhookPost(request(event))).status).toBe(503);
    expect(injected).toBe(true);
    expect(await db.select().from(emailProviderEvents)).toHaveLength(0);
    expect(await db.select().from(emailSuppressions)).toHaveLength(0);
    expect((await db.select().from(emailDeliveries).where(eq(emailDeliveries.jobId, first.id)))[0].status).toBe("accepted");
    expect((await webhookPost(request(event))).status).toBe(200);
    const events = await db.select().from(emailProviderEvents);
    const suppressions = await db.select().from(emailSuppressions);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ jobId: first.id, event: "complained" });
    expect(suppressions).toHaveLength(1); expect(suppressions[0]).toMatchObject({ recipientHash: recipientHash("holder@example.test"), reason: "complained" });
    const delivery = (await db.select().from(emailDeliveries).where(eq(emailDeliveries.jobId, first.id)))[0];
    expect(delivery.status).toBe("complained");
    expect((await webhookPost(request(event))).status).toBe(200);
    expect(await db.select().from(emailProviderEvents)).toEqual(events);
    expect(await db.select().from(emailSuppressions)).toEqual(suppressions);
    expect((await db.select().from(emailDeliveries).where(eq(emailDeliveries.jobId, first.id)))[0]).toEqual(delivery);
    const forged = { ...event, signature: { ...event.signature, signature: "0".repeat(64) } };
    expect((await webhookPost(request(forged))).status).toBe(406);
    expect((await db.select().from(emailDeliveries).where(eq(emailDeliveries.jobId, other.id)))[0].status).toBe("accepted");
    expect(await db.select().from(emailSuppressions).where(eq(emailSuppressions.recipientHash, recipientHash("other@example.test")))).toHaveLength(0);
    expect(provider.send).toHaveBeenCalledTimes(2);
  } finally { spy.mockRestore(); }
});
