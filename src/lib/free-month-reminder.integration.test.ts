import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingLocationPlans, outboxJobs, subscriptions } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { createMerchant } from "./product";
import type { TransactionalEmailProvider, TransactionalMessage } from "./transactional-email";
import { deliverFreeMonthReminder, FREE_MONTH_REMINDER, freeMonthsEndingSoon, queueFreeMonthReminders } from "./free-month-reminder";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

const previous = { smtp: process.env.SMTP_HOST, base: process.env.PUBLIC_BASE_URL, external: process.env.EXTERNAL_EMAIL_ENABLED };
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ SMTP_HOST: previous.smtp, PUBLIC_BASE_URL: previous.base, EXTERNAL_EMAIL_ENABLED: previous.external })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

// Go-live 10 Nov 2026, 11:00 Berlin; Stripe's first billing date 10 Dec 00:00 UTC; the last free day is 9 Dec.
const START = new Date("2026-11-10T10:00:00Z");
const FREE_UNTIL = new Date("2026-12-10T00:00:00Z");
const DAY = 86_400_000;

async function shop(planCode: "founding" | "list" = "founding") {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const created = await createMerchant({ userId: owner, businessName: "Synthetic Monats-Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
  await db.update(billingLocationPlans).set({ createdAt: new Date("2026-11-01T09:00:00Z") }).where(eq(billingLocationPlans.tenantId, created.tenantId));
  // A location added after go-live gets no free month and no reminder.
  const later = await createAdditionalLocation(owner, { name: "Später dazu", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Zweite Karte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Tee", rewardCost: 5 });
  await db.update(billingLocationPlans).set({ createdAt: new Date("2026-11-20T09:00:00Z") }).where(eq(billingLocationPlans.locationId, later.locationId));
  await db.update(subscriptions).set({ status: "active", provider: "stripe", providerSubscriptionId: `sub_test${randomUUID().slice(0, 8)}`, planCode, startedAt: START, freeUntil: FREE_UNTIL }).where(eq(subscriptions.tenantId, created.tenantId));
  return { ...created, owner, later };
}
const jobs = async (tenantId: string) => db.select().from(outboxJobs).where(eq(outboxJobs.tenantId, tenantId));
function fakeProvider() {
  const sent: TransactionalMessage[] = [];
  const provider: TransactionalEmailProvider = { name: "mailpit", async send(message) { sent.push(message); return { state: "accepted", messageId: `local:${message.jobId}` }; } };
  return { sent, provider };
}

describe("free-month reminder (ENG-123)", () => {
  it("queues one reminder per location that started with the shop, from 7 days before the end, exactly once", async () => {
    const s = await shop();
    expect(await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY - 1000))).toBe(0);
    expect(await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY))).toBe(1);
    const [job] = await jobs(s.tenantId);
    expect(job).toMatchObject({ kind: FREE_MONTH_REMINDER, payload: { locationId: s.locationId, freeUntil: "2026-12-10T00:00:00Z", recipientUserId: s.owner } });
    expect(await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - DAY))).toBe(0);
    expect(await jobs(s.tenantId)).toHaveLength(1);
  });

  it("queues nothing for a cancelling shop, a shop without a free month, or while the email lane is off; /operator then shows it as not sent", async () => {
    const cancelling = await shop();
    await db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, cancelling.tenantId));
    const paying = await shop();
    await db.update(subscriptions).set({ freeUntil: null }).where(eq(subscriptions.tenantId, paying.tenantId));
    const due = new Date(FREE_UNTIL.getTime() - 3 * DAY);
    expect(await queueFreeMonthReminders(pool, due)).toBe(0);
    const quiet = await shop();
    process.env.SMTP_HOST = "disabled";
    expect(await queueFreeMonthReminders(pool, due)).toBe(0);
    expect(await freeMonthsEndingSoon(pool, due)).toEqual([{ tenantId: quiet.tenantId, shop: "Synthetic Monats-Café", location: "Synthetic Monats-Café", lastFreeDay: "09.12.2026", sent: false }]);
  });

  it("sends the last free day, the first billing day and the plan's price, with no VAT wording, once; /operator then shows it as sent", async () => {
    const s = await shop("founding");
    const due = new Date(FREE_UNTIL.getTime() - 7 * DAY);
    await queueFreeMonthReminders(pool, due);
    const [job] = await jobs(s.tenantId);
    const { sent, provider } = fakeProvider();
    expect(await deliverFreeMonthReminder(job, provider)).toEqual({ status: "complete" });
    expect(await deliverFreeMonthReminder(job, provider)).toMatchObject({ status: "blocked" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Dein kostenloser Monat für Synthetic Monats-Café endet am 09.12.2026");
    expect(sent[0].body).toContain("endet am 09.12.2026.");
    // Intl puts a no-break space between amount and euro sign.
    expect(sent[0].body.replace(/\u00a0/g, " ")).toContain("Danach kostet Loynara 39,00 € im Monat für diesen Standort. Die erste Rechnung kommt am 10.12.2026 per E-Mail.");
    expect(sent[0].body).toContain("Wenn du bis zum 09.12.2026 kündigst, kostet dich das nichts.");
    expect(sent[0].body).not.toMatch(/Umsatzsteuer|UStG|MwSt/);
    await db.update(outboxJobs).set({ status: "complete" }).where(eq(outboxJobs.id, job.id));
    expect(await freeMonthsEndingSoon(pool, due)).toMatchObject([{ tenantId: s.tenantId, lastFreeDay: "09.12.2026", sent: true }]);
  });

  it("sends nothing when the shop cancelled or the free month moved after the job was queued", async () => {
    const s = await shop();
    await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY));
    const [job] = await jobs(s.tenantId);
    await db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, s.tenantId));
    const { sent, provider } = fakeProvider();
    expect(await deliverFreeMonthReminder(job, provider)).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
  });
});
