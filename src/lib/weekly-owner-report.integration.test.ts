import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, outboxJobs, staffRoles, tenants, weeklyOwnerReports } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { getMerchantAnalytics, getTenantWindowAnalytics } from "./merchant-analytics";
import type { TransactionalEmailProvider, TransactionalMessage } from "./transactional-email";
import { deliverWeeklyOwnerReport, getWeeklyReportSetting, queueWeeklyOwnerReports, setWeeklyReportSetting, WEEKLY_OWNER_REPORT } from "./weekly-owner-report";

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

// Berlin week Mon 12 Oct – Sun 18 Oct 2026 (CEST, UTC+2), reported from Mon 19 Oct 07:00 CEST = 05:00 UTC.
const week = { start: new Date("2026-10-11T22:00:00Z"), end: new Date("2026-10-18T22:00:00Z"), due: new Date("2026-10-19T05:00:00Z") };
const day = 86_400_000;

async function user(role = "owner") {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, `Synthetic ${role}`, `${id}@example.test`]);
  return id;
}
async function shop() {
  const owner = await user();
  const created = await createMerchant({ userId: owner, businessName: "Synthetic Wochen-Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Wochenkarte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
  await db.update(tenants).set({ createdAt: new Date("2026-01-01T00:00:00Z") }).where(eq(tenants.id, created.tenantId));
  const card = async (createdAt: Date) => {
    const member = await enroll({ slug: created.programSlug, acceptedTerms: true });
    await db.update(memberships).set({ createdAt }).where(eq(memberships.id, member.id));
    return member.id;
  };
  const entry = (membershipId: string, createdAt: Date, extra: Partial<typeof ledgerEntries.$inferInsert> = {}) => db.insert(ledgerEntries).values({
    tenantId: created.tenantId, locationId: created.locationId, membershipId, actorUserId: owner, requestId: randomUUID(), idempotencyKey: randomUUID(),
    kind: "award", source: "staff_online", delta: 1, createdAt, ...extra,
  }).returning().then(rows => rows[0]);
  return { owner, ...created, card, entry };
}
function fakeProvider() {
  const sent: TransactionalMessage[] = [];
  const provider: TransactionalEmailProvider = { name: "mailpit", async send(message) { sent.push(message); return { state: "accepted", messageId: `local:${message.jobId}` }; } };
  return { sent, provider };
}
const jobs = () => db.select().from(outboxJobs).where(eq(outboxJobs.kind, WEEKLY_OWNER_REPORT));
const figure = (body: string, label: string) => Number(new RegExp(`^${label}: (\\d+)$`, "m").exec(body)?.[1]);

describe("weekly owner report", () => {
  it("sends the dashboard's figures for the Berlin week, with won-back cards", async () => {
    const s = await shop();
    const regular = await s.card(new Date(week.start.getTime() - 60 * day));
    await s.entry(regular, new Date(week.start.getTime() - 40 * day));
    await s.entry(regular, new Date(week.start.getTime() + 2 * day)); // 42 days later: won back
    const fresh = await s.card(new Date(week.start.getTime() + day));
    await s.entry(fresh, new Date(week.start.getTime() + day));
    await s.entry(fresh, new Date(week.start.getTime() + 3 * day));
    const reversed = await s.entry(fresh, new Date(week.start.getTime() + 4 * day));
    await s.entry(fresh, new Date(week.start.getTime() + 4 * day + 1000), { kind: "reversal", source: "staff_correction", delta: -1, reversalOfId: reversed.id });
    await s.entry(fresh, new Date(week.start.getTime() + 5 * day), { kind: "redeem", delta: -1 });
    await s.entry(fresh, new Date(week.end.getTime() + 1000)); // next week

    expect(await queueWeeklyOwnerReports(pool, week.due)).toBe(1);
    const [job] = await jobs();
    expect(job.payload).toEqual({ weekStart: "2026-10-12", recipientUserId: s.owner });
    const { sent, provider } = fakeProvider();
    expect(await deliverWeeklyOwnerReport(job, provider)).toEqual({ status: "complete" });
    expect(sent).toHaveLength(1);
    const { body, subject, to } = sent[0];
    expect(to).toBe(`${s.owner}@example.test`);
    expect(subject).toBe("Deine Woche bei Synthetic Wochen-Café: 12.10.2026 bis 18.10.2026");
    const reported = { visits: figure(body, "Besuche"), newCards: figure(body, "Neue Kunden"), repeat: figure(body, "Stammkunden"), wonBack: figure(body, "Zurückgewonnen"), redemptions: figure(body, "Eingelöste Prämien") };
    expect(reported).toEqual({ visits: 3, newCards: 1, repeat: 1, wonBack: 1, redemptions: 1 });
    // Nothing else lies in the dashboard's 30-day window ending with the week, so it must show the same numbers.
    const dashboard = await getMerchantAnalytics(s.owner, { windowDays: 30, asOf: week.end });
    expect(reported).toEqual({ visits: dashboard.qualifyingCheckouts, newCards: dashboard.newCards, repeat: dashboard.repeatCards, wonBack: dashboard.wonBack, redemptions: dashboard.rewards.redemptions });
    expect(body).toContain("http://localhost:3000/merchant");
    expect(body).not.toContain("ruhig");
    expect(body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/); // no card or job ids in the text
  });

  it("counts a card as won back after 21 days but not after 20", async () => {
    const s = await shop();
    const inWeek = new Date(week.start.getTime() + 3 * day);
    const twenty = await s.card(new Date("2026-08-01T00:00:00Z"));
    await s.entry(twenty, new Date(inWeek.getTime() - 21 * day + 1));
    await s.entry(twenty, inWeek);
    const twentyOne = await s.card(new Date("2026-08-01T00:00:00Z"));
    await s.entry(twentyOne, new Date(inWeek.getTime() - 21 * day));
    await s.entry(twentyOne, inWeek);
    const reversedGap = await s.card(new Date("2026-08-01T00:00:00Z")); // the 5-day-old award was reversed: 30 days count
    await s.entry(reversedGap, new Date(inWeek.getTime() - 30 * day));
    const undone = await s.entry(reversedGap, new Date(inWeek.getTime() - 5 * day));
    await s.entry(reversedGap, new Date(inWeek.getTime() - 5 * day + 1000), { kind: "reversal", source: "staff_correction", delta: -1, reversalOfId: undone.id });
    await s.entry(reversedGap, inWeek);
    const firstEver = await s.card(new Date(week.start.getTime() + day)); // new cards are not won back
    await s.entry(firstEver, inWeek);
    const seedGap = await s.card(new Date("2026-08-01T00:00:00Z")); // seed credits never count as a previous visit
    await s.entry(seedGap, new Date(inWeek.getTime() - 25 * day), { source: "synthetic_seed" });
    await s.entry(seedGap, new Date(inWeek.getTime() - 10 * day));
    await s.entry(seedGap, inWeek);
    expect((await getTenantWindowAnalytics(s.tenantId, week.start, week.end)).wonBack).toBe(2);
  });

  it("queues each shop once per week, however often it runs, and a retried job never sends twice", async () => {
    const s = await shop();
    const coOwner = await user();
    const cashier = await user("cashier");
    await db.insert(staffRoles).values([
      { tenantId: s.tenantId, userId: coOwner, role: "owner" },
      { tenantId: s.tenantId, userId: cashier, role: "cashier", locationId: s.locationId },
    ]);
    expect(await queueWeeklyOwnerReports(pool, week.due)).toBe(2);
    expect(await queueWeeklyOwnerReports(pool, new Date(week.due.getTime() + 3 * day))).toBe(0);
    expect((await jobs()).map(job => job.payload.recipientUserId).sort()).toEqual([s.owner, coOwner].sort());
    expect(await db.select().from(weeklyOwnerReports)).toEqual([expect.objectContaining({ tenantId: s.tenantId, weekStart: "2026-10-12" })]);

    const { sent, provider } = fakeProvider();
    const [job] = await jobs();
    expect(await deliverWeeklyOwnerReport(job, provider)).toEqual({ status: "complete" });
    expect(await deliverWeeklyOwnerReport(job, provider)).toMatchObject({ status: "blocked" });
    expect(sent).toHaveLength(1);
    // Zero activity still sends, with the encouraging line.
    expect(sent[0].body).toMatch(/^Besuche: 0$/m);
    expect(sent[0].body).toContain("Diese Woche war ruhig.");

    // A cashier never receives it, and an owner who lost access is skipped at send time.
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, coOwner));
    const other = (await jobs()).find(entry => entry.payload.recipientUserId === coOwner)!;
    expect(await deliverWeeklyOwnerReport(other, provider)).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(1);
  });

  it("respects the owner's off switch, which defaults to on and is owner-only", async () => {
    const s = await shop();
    const cashier = await user("cashier");
    await db.insert(staffRoles).values({ tenantId: s.tenantId, userId: cashier, role: "cashier", locationId: s.locationId });
    expect(await getWeeklyReportSetting(s.owner)).toEqual({ enabled: true });
    await expect(setWeeklyReportSetting(cashier, false)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getWeeklyReportSetting(cashier)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await setWeeklyReportSetting(s.owner, false)).toEqual({ enabled: false });
    expect(await queueWeeklyOwnerReports(pool, week.due)).toBe(0);
    expect(await db.select().from(weeklyOwnerReports)).toEqual([]);

    await setWeeklyReportSetting(s.owner, true);
    expect(await queueWeeklyOwnerReports(pool, week.due)).toBe(1);
    await setWeeklyReportSetting(s.owner, false); // switched off after queueing, before the worker sent it
    const { sent, provider } = fakeProvider();
    expect(await deliverWeeklyOwnerReport((await jobs())[0], provider)).toEqual({ status: "suppressed", reason: "Weekly report switched off" });
    expect(sent).toHaveLength(0);
  });

  it("starts at Monday 07:00 Berlin and uses Berlin week bounds across the DST change on 25 Oct 2026", async () => {
    const s = await shop();
    expect(await queueWeeklyOwnerReports(pool, new Date("2026-10-19T04:59:59Z"))).toBe(0); // Mon 06:59:59 CEST

    // Week Mon 19 Oct 00:00 CEST (18 Oct 22:00 UTC) to Mon 26 Oct 00:00 CET (25 Oct 23:00 UTC): 169 hours.
    const card = await s.card(new Date("2026-10-01T00:00:00Z"));
    await s.entry(card, new Date("2026-10-18T21:59:59Z")); // Sun 18 Oct 23:59:59 CEST: previous week
    await s.entry(card, new Date("2026-10-18T22:00:00Z")); // Mon 19 Oct 00:00 CEST
    await s.entry(card, new Date("2026-10-25T22:59:59Z")); // Sun 25 Oct 23:59:59 CET
    await s.entry(card, new Date("2026-10-25T23:00:00Z")); // Mon 26 Oct 00:00 CET: next week
    expect(await queueWeeklyOwnerReports(pool, new Date("2026-10-26T05:59:59Z"))).toBe(0); // 06:59 CET
    expect(await queueWeeklyOwnerReports(pool, new Date("2026-10-26T06:00:00Z"))).toBe(1); // 07:00 CET
    const [job] = await jobs();
    expect(job.payload.weekStart).toBe("2026-10-19");
    const { sent, provider } = fakeProvider();
    await deliverWeeklyOwnerReport(job, provider);
    expect(sent[0].subject).toContain("19.10.2026 bis 25.10.2026");
    expect(figure(sent[0].body, "Besuche")).toBe(2);
    expect(figure(sent[0].body, "Stammkunden")).toBe(1);
  });

  it("does not report on a week before the shop existed", async () => {
    const s = await shop();
    await db.update(tenants).set({ createdAt: new Date(week.end.getTime() + 1000) }).where(eq(tenants.id, s.tenantId));
    expect(await queueWeeklyOwnerReports(pool, week.due)).toBe(0);
  });
});
