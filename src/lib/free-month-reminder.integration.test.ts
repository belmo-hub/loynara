import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingLocationPlans, outboxJobs, subscriptions } from "@/db/schema";
import { setStripeClient } from "./billing-stripe";
import { createAdditionalLocation } from "./locations";
import { createMerchant } from "./product";
import type { TransactionalEmailProvider, TransactionalMessage } from "./transactional-email";
import { deliverFreeMonthReminder, FREE_MONTH_REMINDER, freeMonthReminderText, freeMonthsEndingSoon, queueFreeMonthReminders } from "./free-month-reminder";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

const previous = { smtp: process.env.SMTP_HOST, base: process.env.PUBLIC_BASE_URL, external: process.env.EXTERNAL_EMAIL_ENABLED, vat: process.env.BILLING_VAT_MODE };
// Stripe's public business details, as the invoices print them (synthetic).
let account: unknown = { business_profile: { name: "Synthetische Betreiberin", support_address: { line1: "Musterstraße 1", line2: null, postal_code: "12345", city: "Musterstadt" } } };
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BILLING_VAT_MODE = "kleinunternehmer";
  account = { business_profile: { name: "Synthetische Betreiberin", support_address: { line1: "Musterstraße 1", line2: null, postal_code: "12345", city: "Musterstadt" } } };
  setStripeClient(async (method, path) => { if (method === "GET" && path === "/account") return account; throw new Error(`Unexpected Stripe call ${method} ${path}`); });
});
afterEach(() => setStripeClient());
afterAll(async () => {
  for (const [key, value] of Object.entries({ SMTP_HOST: previous.smtp, PUBLIC_BASE_URL: previous.base, EXTERNAL_EMAIL_ENABLED: previous.external, BILLING_VAT_MODE: previous.vat })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

// Go-live 10 Nov 2026, 11:00 Berlin; Stripe's first billing date 10 Dec 00:00 UTC; the last free day is 9 December.
const START = new Date("2026-11-10T10:00:00Z");
const FREE_UNTIL = new Date("2026-12-10T00:00:00Z");
const DAY = 86_400_000;
const location = (name: string) => ({ name, city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", programName: `Karte ${name}`, programType: "stamp" as const, rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });

/** A shop on the list plan, two locations from the start and one added after go-live (no free month, not in the reminder). */
async function shop({ second = true } = {}) {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const created = await createMerchant({ userId: owner, businessName: "Synthetic Monats-Café", locationName: "Am Markt", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
  if (second) await createAdditionalLocation(owner, location("Bahnhof"));
  await db.update(billingLocationPlans).set({ createdAt: new Date("2026-11-01T09:00:00Z") }).where(eq(billingLocationPlans.tenantId, created.tenantId));
  const later = await createAdditionalLocation(owner, location("Später dazu"));
  await db.update(billingLocationPlans).set({ createdAt: new Date("2026-11-20T09:00:00Z") }).where(eq(billingLocationPlans.locationId, later.locationId));
  await db.update(subscriptions).set({ status: "active", provider: "stripe", providerSubscriptionId: `sub_test${randomUUID().slice(0, 8)}`, planCode: "list", startedAt: START, freeUntil: FREE_UNTIL }).where(eq(subscriptions.tenantId, created.tenantId));
  return { ...created, owner };
}
const jobs = async (tenantId: string) => db.select().from(outboxJobs).where(eq(outboxJobs.tenantId, tenantId));
function fakeProvider() {
  const sent: TransactionalMessage[] = [];
  const provider: TransactionalEmailProvider = { name: "mailpit", async send(message) { sent.push(message); return { state: "accepted", messageId: `local:${message.jobId}` }; } };
  return { sent, provider };
}
// Intl puts a no-break space between amount and euro sign.
const plain = (text: string) => text.replace(/ /g, " ");

describe("free-month reminder (ENG-123)", () => {
  it("queues one reminder per business, from 7 days before the end, exactly once", async () => {
    const s = await shop();
    expect(await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY - 1000))).toBe(0);
    expect(await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY))).toBe(1);
    const [job] = await jobs(s.tenantId);
    expect(job).toMatchObject({ kind: FREE_MONTH_REMINDER, payload: { freeUntil: "2026-12-10T00:00:00Z", recipientUserId: s.owner } });
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
    expect(await freeMonthsEndingSoon(pool, due)).toEqual([{ tenantId: quiet.tenantId, shop: "Synthetic Monats-Café", locations: ["Am Markt", "Bahnhof"], lastFreeDay: "9. Dezember", sent: false }]);
  });

  it("sends Marketing's text: owner-format dates, each free-month location at its stored price, the operator from Stripe; once", async () => {
    const s = await shop();
    const due = new Date(FREE_UNTIL.getTime() - 7 * DAY);
    await queueFreeMonthReminders(pool, due);
    const [job] = await jobs(s.tenantId);
    const { sent, provider } = fakeProvider();
    expect(await deliverFreeMonthReminder(job, provider)).toEqual({ status: "complete" });
    expect(await deliverFreeMonthReminder(job, provider)).toMatchObject({ status: "blocked" });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe("Dein kostenloser Monat für Synthetic Monats-Café endet am 9. Dezember");
    expect(plain(sent[0].body)).toBe([
      "Hallo,",
      "",
      "dein kostenloser Monat bei Loynara für Synthetic Monats-Café endet am 9. Dezember.",
      "",
      "Möchtest du weitermachen, musst du nichts tun.",
      "Ab dem 10. Dezember kostet Loynara 98 € im Monat für deine 2 Standorte:",
      "Am Markt: 49 €",
      "Bahnhof: 49 €",
      "Die erste Rechnung kommt am selben Tag per E-Mail. Eine Zahlungsart kannst du vorher in deinem Inhaberbereich unter „Abrechnung“ hinterlegen.",
      "",
      // ENG-167, Marketing's R1 while the cancellation surface is on (always outside real production).
      "Möchtest du aufhören, kündige bis zum 9. Dezember in deinem Inhaberbereich unter Mehr › Geschäft › Programm beenden oder per E-Mail an support@getloynara.com. Es kostet dich nichts. Dein Programm endet frühestens 14 Tage nach deiner Kündigung, damit deine Kunden das Ende rechtzeitig sehen. Das genaue Datum bekommst du mit der Bestätigung.",
      "",
      "Viele Grüße",
      "Loynara",
      "",
      "Synthetische Betreiberin · Musterstraße 1, 12345 Musterstadt",
    ].join("\n"));
    await db.update(outboxJobs).set({ status: "complete" }).where(eq(outboxJobs.id, job.id));
    expect(await freeMonthsEndingSoon(pool, due)).toMatchObject([{ tenantId: s.tenantId, sent: true }]);
  });

  it("with the cancellation surface off, names only the e-mail (R2, Legal 1 Nov) and never claims the end comes with the free month", () => {
    const text = freeMonthReminderText({ shop: "Synthetic", locations: [{ name: "Am Markt", priceMinor: 4900 }], freeUntil: FREE_UNTIL, vat: "kleinunternehmer", operator: { name: "Synthetische Betreiberin", address: "Musterstraße 1, 12345 Musterstadt" }, inApp: false });
    expect(text.body).toContain("Möchtest du aufhören, schreibe bis zum 9. Dezember eine kurze E-Mail an support@getloynara.com. Es kostet dich nichts. Dein Programm endet frühestens 14 Tage nach deiner Kündigung, damit deine Kunden das Ende rechtzeitig sehen. Das genaue Datum bekommst du mit der Bestätigung.");
    expect(text.body).not.toContain("Programm beenden");
    expect(text.body).not.toContain("mit dem kostenlosen Monat");
  });

  it("names the one location, and adds „zzgl. USt“ in standard VAT mode, as on the invoice", async () => {
    process.env.BILLING_VAT_MODE = "standard";
    const s = await shop({ second: false });
    await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY));
    const [job] = await jobs(s.tenantId);
    const { sent, provider } = fakeProvider();
    await deliverFreeMonthReminder(job, provider);
    expect(plain(sent[0].body)).toContain("Ab dem 10. Dezember kostet Loynara 49 € zzgl. USt im Monat für Am Markt.");
  });

  it("sends nothing without a VAT mode, without the operator's details in Stripe, or after the shop cancelled", async () => {
    const s = await shop();
    await queueFreeMonthReminders(pool, new Date(FREE_UNTIL.getTime() - 7 * DAY));
    const [job] = await jobs(s.tenantId);
    const { sent, provider } = fakeProvider();
    delete process.env.BILLING_VAT_MODE;
    expect(await deliverFreeMonthReminder(job, provider)).toEqual({ status: "blocked", reason: "No VAT mode set" });
    process.env.BILLING_VAT_MODE = "kleinunternehmer";
    account = { business_profile: { name: "Synthetische Betreiberin", support_address: null } };
    expect(await deliverFreeMonthReminder(job, provider)).toMatchObject({ status: "blocked", reason: expect.stringContaining("Operator") });
    await db.update(subscriptions).set({ cancelAtPeriodEnd: true }).where(eq(subscriptions.tenantId, s.tenantId));
    expect(await deliverFreeMonthReminder(job, provider)).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
  });
});
