import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { emailDeliveries, emailProviderEvents, emailSuppressions, outboxJobs, tenants } from "@/db/schema";
import { emailTransportMode, mailgunEuProvider, recordMailgunWebhook, recipientHash, sendTransactional, verifyMailgunWebhook } from "./transactional-email";
import { productionConfigIssues } from "../../scripts/config-check";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Email adapter tests require looplocal_test");
const original = { ...process.env };
const secret = "synthetic-mailgun-api-key-not-real";
const signing = "synthetic-mailgun-signing-key-not-real";
const config: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production", PUBLIC_BASE_URL: "https://test.example.test", EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_SEND_APPROVED: "true", MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "service@mail.example.test", MAILGUN_EU_API_KEY: secret, MAILGUN_EU_WEBHOOK_SIGNING_KEY: signing };
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE email_provider_events, email_suppressions, tenants, "user", demo_requests CASCADE');
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
