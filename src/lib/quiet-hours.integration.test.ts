import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { automationRuns, consentEvents, membershipContacts, outboxJobs } from "@/db/schema";
import { deliverAutomationRun, processAutomationEvent, upsertAutomationRule } from "./automations";
import { award } from "./loyalty";
import { createMerchant, enroll } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Quiet-hours tests require looplocal_test");

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-quiet-hours-secret-long-enough-for-tests";
  delete process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT;
  delete process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function queuedRun(timezone: string) {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Quiet Café", city: "Kassel", country: timezone === "Africa/Casablanca" ? "MA" : "DE", timezone, locale: "de", currency: timezone === "Africa/Casablanca" ? "MAD" : "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp for a confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "quiet@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  await upsertAutomationRule({ actorUserId: ownerId, programSlug: merchant.programSlug, triggerKind: "first_checkout", enabled: true, subject: "Willkommen", body: "Danke für deinen ersten bestätigten Einkauf.", cooldownDays: 7, dailyCap: 20 });
  await award({ userId: ownerId, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
  expect((await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload })).queuedCount).toBe(1);
  const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
  return { card, merchant, job: { id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 } };
}

describe("quiet hours at delivery", () => {
  it("defers a late-evening send to 09:00 local time without sending or finalising the run", async () => {
    const { job } = await queuedRun("Europe/Berlin");
    const send = vi.fn(async () => {});
    const evening = new Date("2026-10-05T20:30:00Z"); // 22:30 CEST
    expect(await deliverAutomationRun(job, send, evening)).toEqual({ status: "deferred", reason: "Quiet hours in the location's timezone", until: new Date("2026-10-06T07:00:00Z") });
    expect(send).not.toHaveBeenCalled();
    const [run] = await db.select().from(automationRuns);
    expect(run.status).toBe("queued");

    expect((await deliverAutomationRun({ ...job, attempts: 2 }, send, new Date("2026-10-06T07:00:30Z"))).status).toBe("complete");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-checks eligibility when the deferred send wakes up", async () => {
    const { job, card, merchant } = await queuedRun("Europe/Berlin");
    const send = vi.fn(async () => {});
    expect((await deliverAutomationRun(job, send, new Date("2026-10-05T21:00:00Z"))).status).toBe("deferred");
    await db.insert(consentEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "card" });
    expect(await deliverAutomationRun({ ...job, attempts: 2 }, send, new Date("2026-10-06T07:05:00Z"))).toMatchObject({ status: "suppressed", reason: "Marketing consent absent or withdrawn" });
    expect(send).not.toHaveBeenCalled();
  });

  it("follows the location's timezone", async () => {
    const { job } = await queuedRun("Africa/Casablanca");
    const send = vi.fn(async () => {});
    // 19:30Z is 20:30 in Casablanca (allowed) but 21:30 in Berlin.
    expect((await deliverAutomationRun(job, send, new Date("2026-10-05T19:30:00Z"))).status).toBe("complete");
  });
});
