import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { emailDeliveries, emailProviderEvents, emailSuppressions } from "@/db/schema";
import { localMailAllowed, sendLocalMailpit, syntheticAddress, type LocalMessage } from "./email";

export type EmailMode = "disabled" | "mailpit" | "mailgun_eu";
export type DeliveryState = "accepted" | "delivered" | "temporary_failure" | "permanent_failure" | "ambiguous";
export type TransactionalMessage = LocalMessage;
export interface TransactionalEmailProvider {
  readonly name: "mailpit" | "mailgun_eu";
  send(message: TransactionalMessage): Promise<{ state: DeliveryState; messageId?: string }>;
}

const domainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
function externalOrigin(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function mailgunConfig(env = process.env, purpose: "transactional" | "promotional" = "transactional") {
  const domain = env.MAILGUN_EU_DOMAIN?.toLowerCase();
  const from = env.MAILGUN_FROM_EMAIL?.toLowerCase();
  const enabled = purpose === "transactional"
    ? (env.TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED ?? env.EXTERNAL_EMAIL_ENABLED) === "true"
    : env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true" && env.MAILGUN_PROMOTIONAL_SEND_APPROVED === "true";
  const monthly = Number(env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT);
  const frequency = Number(env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS);
  const promotionalSafety = purpose === "transactional" || (env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT !== "" && env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS !== "" && externalOrigin(env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN)
    && (env.PROMOTIONAL_UNSUBSCRIBE_SECRET?.length ?? 0) >= 32
    && Number.isSafeInteger(monthly) && monthly >= 1 && monthly <= 100_000 && Number.isSafeInteger(frequency) && frequency >= 1 && frequency <= 24 * 365);
  if (!enabled || !promotionalSafety || env.MAILGUN_SEND_APPROVED !== "true"
    || !domain || !domainPattern.test(domain) || !from || !z.email().safeParse(from).success || !from.endsWith(`@${domain}`)
    || !env.MAILGUN_EU_API_KEY || !env.MAILGUN_EU_WEBHOOK_SIGNING_KEY
    || !externalOrigin(env.PUBLIC_BASE_URL)) return null;
  return { domain, from, apiKey: env.MAILGUN_EU_API_KEY, signingKey: env.MAILGUN_EU_WEBHOOK_SIGNING_KEY };
}

export function emailTransportMode(env = process.env): EmailMode {
  if (mailgunConfig(env)) return "mailgun_eu";
  if (env === process.env && localMailAllowed()) return "mailpit";
  return "disabled";
}

export function promotionalEmailMode(env = process.env): EmailMode {
  if (mailgunConfig(env, "promotional")) return "mailgun_eu";
  if (env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true") return "disabled";
  if (env === process.env && localMailAllowed()) return "mailpit";
  return "disabled";
}

export function recipientHash(email: string) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32) throw new Error("Recipient hash secret unavailable");
  return createHmac("sha256", secret).update("email-recipient-v1:\0").update(email.trim().toLowerCase()).digest("hex");
}

export function mailgunEuProvider(env = process.env, http: typeof fetch = fetch, purpose: "transactional" | "promotional" = "transactional"): TransactionalEmailProvider | null {
  const config = mailgunConfig(env, purpose);
  if (!config) return null;
  return { name: "mailgun_eu", async send(message) {
    const body = new FormData();
    body.set("from", config.from);
    body.set("to", message.to);
    body.set("subject", message.subject);
    body.set("text", message.body);
    body.set("v:job_id", message.jobId);
    body.set("o:tracking", "no");
    if (purpose === "promotional") {
      if (!message.unsubscribeUrl) return { state: "permanent_failure" };
      body.set("h:List-Unsubscribe", `<${message.unsubscribeUrl}>`);
    }
    let response: Response;
    try {
      response = await http(`https://api.eu.mailgun.net/v3/${config.domain}/messages`, {
        method: "POST", headers: { Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}` },
        body, signal: AbortSignal.timeout(10_000),
      });
    } catch { return { state: "ambiguous" }; }
    if (response.status >= 500 || response.status === 429) return { state: "ambiguous" };
    if (!response.ok) return { state: "permanent_failure" };
    try {
      const parsed = z.object({ id: z.string().min(1).max(255) }).parse(await response.json());
      return { state: "accepted", messageId: parsed.id };
    } catch { return { state: "ambiguous" }; }
  } };
}

export function transactionalProvider(): TransactionalEmailProvider | null {
  if (emailTransportMode() === "mailpit") return { name: "mailpit", async send(message) {
    if (!syntheticAddress(message.to)) return { state: "permanent_failure" };
    await sendLocalMailpit(message);
    return { state: "accepted", messageId: `local:${message.jobId}` };
  } };
  return mailgunEuProvider();
}

export function promotionalProvider(env = process.env, http: typeof fetch = fetch): TransactionalEmailProvider | null {
  if (env === process.env && promotionalEmailMode() === "mailpit") return { name: "mailpit", async send(message) {
    if (!syntheticAddress(message.to)) return { state: "permanent_failure" };
    await sendLocalMailpit(message);
    return { state: "accepted", messageId: `local:${message.jobId}` };
  } };
  return mailgunEuProvider(env, http, "promotional");
}

/** Reserve before network I/O. A lost response remains ambiguous and never auto-retries. */
async function sendManaged(message: TransactionalMessage, provider: TransactionalEmailProvider | null, purpose: "transactional" | "promotional") {
  if (!provider) return { status: "blocked" as const, reason: "Email provider unavailable" };
  const hash = recipientHash(message.to);
  const [suppression] = await db.select().from(emailSuppressions).where(eq(emailSuppressions.recipientHash, hash));
  // Promotional unsubscribe is not a withdrawal of requested recovery mail.
  if (suppression && (purpose === "promotional" || suppression.reason !== "unsubscribed")) return { status: "suppressed" as const, reason: "Recipient suppressed" };
  const reserved = await db.insert(emailDeliveries).values({ jobId: message.jobId, provider: provider.name, recipientHash: hash, status: "sending" })
    .onConflictDoNothing().returning({ jobId: emailDeliveries.jobId });
  if (!reserved.length) return { status: "blocked" as const, reason: "Previous delivery attempt requires review" };
  const result = await provider.send(message);
  await db.update(emailDeliveries).set({ status: result.state, providerMessageId: result.messageId, updatedAt: new Date() })
    .where(and(eq(emailDeliveries.jobId, message.jobId), eq(emailDeliveries.status, "sending")));
  if (result.messageId) await db.update(emailDeliveries).set({ providerMessageId: result.messageId })
    .where(eq(emailDeliveries.jobId, message.jobId));
  const [recorded] = await db.select({ status: emailDeliveries.status }).from(emailDeliveries).where(eq(emailDeliveries.jobId, message.jobId));
  if (result.state === "ambiguous" && ["accepted", "delivered"].includes(recorded?.status ?? "")) return { status: "complete" as const };
  return result.state === "accepted" || result.state === "delivered"
    ? { status: "complete" as const }
    : { status: "blocked" as const, reason: result.state === "ambiguous" ? "Provider outcome uncertain; reconcile before replay" : "Provider rejected delivery" };
}

export async function sendTransactional(message: TransactionalMessage, provider = transactionalProvider()) {
  return sendManaged(message, provider, "transactional");
}

export async function sendPromotional(message: TransactionalMessage, provider = promotionalProvider()) {
  return sendManaged(message, provider, "promotional");
}

const webhookSchema = z.object({
  signature: z.object({ timestamp: z.string().regex(/^\d{10,11}$/), token: z.string().min(20).max(128), signature: z.string().regex(/^[a-f0-9]{64}$/i) }),
  "event-data": z.object({ id: z.string().min(1).max(128), event: z.enum(["accepted", "delivered", "temporary_fail", "permanent_fail", "unsubscribed", "complained"]), recipient: z.email().max(320).optional(), "user-variables": z.record(z.string(), z.unknown()).optional(), message: z.object({ headers: z.record(z.string(), z.unknown()).optional() }).optional() }).passthrough(),
});

export function verifyMailgunWebhook(input: unknown, env = process.env, now = Date.now()) {
  // Delivery reports must remain verifiable when outbound sending is paused.
  const signingKey = env.MAILGUN_EU_WEBHOOK_SIGNING_KEY;
  if (!signingKey || signingKey.length < 32) return null;
  const parsed = webhookSchema.safeParse(input);
  if (!parsed.success) return null;
  const { timestamp, token, signature } = parsed.data.signature;
  if (Math.abs(now - Number(timestamp) * 1000) > 15 * 60_000) return null;
  const expected = createHmac("sha256", signingKey).update(timestamp + token).digest();
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return parsed.data;
}

export async function recordMailgunWebhook(input: unknown) {
  const payload = verifyMailgunWebhook(input);
  if (!payload) return { accepted: false as const };
  const event = payload["event-data"];
  const jobId = event["user-variables"]?.job_id;
  const messageId = event.message?.headers?.["message-id"];
  const mapped = event.event === "temporary_fail" ? "temporary_failure" : event.event === "permanent_fail" ? "permanent_failure" : event.event;
  const id = createHash("sha256").update(event.id).digest("hex");
  const signatureTokenHash = createHash("sha256").update(payload.signature.token).digest("hex");
  await db.transaction(async tx => {
    const jobMatch = typeof jobId === "string" && z.uuid().safeParse(jobId).success ? eq(emailDeliveries.jobId, jobId) : null;
    const messageMatch = typeof messageId === "string" ? eq(emailDeliveries.providerMessageId, messageId) : null;
    const where = jobMatch ?? messageMatch;
    const [delivery] = where ? await tx.select().from(emailDeliveries).where(and(where, eq(emailDeliveries.provider, "mailgun_eu"))).for("update") : [];
    if (delivery && event.recipient && recipientHash(event.recipient) !== delivery.recipientHash) return;
    const inserted = await tx.insert(emailProviderEvents).values({ id, signatureTokenHash, jobId: delivery?.jobId ?? null, event: event.event }).onConflictDoNothing().returning({ id: emailProviderEvents.id });
    if (!inserted.length) return;
    if (!delivery) return;
    const current = delivery.status;
    const shouldAdvance = ["permanent_fail", "complained", "unsubscribed"].includes(event.event)
      || (event.event === "delivered" && !["permanent_failure", "complained", "unsubscribed"].includes(current))
      || (event.event === "temporary_fail" && ["sending", "ambiguous", "accepted", "temporary_failure"].includes(current))
      || (event.event === "accepted" && ["sending", "ambiguous", "accepted"].includes(current));
    if (shouldAdvance) {
      await tx.update(emailDeliveries).set({ status: mapped, updatedAt: new Date() }).where(eq(emailDeliveries.jobId, delivery.jobId));
    }
    if (["permanent_fail", "complained", "unsubscribed"].includes(event.event) && event.recipient && recipientHash(event.recipient) === delivery.recipientHash) {
      await tx.insert(emailSuppressions).values({ recipientHash: recipientHash(event.recipient), reason: event.event }).onConflictDoUpdate({ target: emailSuppressions.recipientHash, set: { reason: event.event } });
    }
  });
  return { accepted: true as const };
}
