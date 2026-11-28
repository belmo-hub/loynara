// Synthetic demo salon for the in-person Termin pitch: one week of appointments around today, all written through the booking lib.
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, pool } from "../src/db";
import { consentEvents, locations, programs, staffRoles } from "../src/db/schema";
import { book, cancelByCustomer, createBlock, transition } from "../src/lib/booking/appointments";
import { PRESETS } from "../src/lib/booking/presets";
import { getSetup, saveSetup } from "../src/lib/booking/setup";
import { addDays, instantToWall, wallToInstant } from "../src/lib/booking/time";
import { createMerchant, enroll } from "../src/lib/product";
import { assertLocalTarget } from "./local-guard";

type Access = { ownerEmail: string; ownerPassword: string; cashierEmail: string; cashierPassword: string };

const accessPath = path.resolve("var/demo-access-salon.json");
const ownerEmail = "owner.salon@looplocal.test", cashierEmail = "cashier.salon@looplocal.test";
const tz = "Europe/Berlin", base = process.env.PUBLIC_BASE_URL;
const NAMES = ["Mia", "Emma", "Hannah", "Sofia", "Lina", "Lea", "Marie", "Clara", "Emilia", "Ella", "Lara", "Nele", "Jana", "Pia", "Ida", "Frieda", "Greta", "Helene", "Paula", "Romy",
  "Tilda", "Zoe", "Anni", "Leni", "Mila", "Nora", "Ronja", "Svea", "Wanda", "Yara"];
const LENA = [["09:00", "Maniküre"], ["10:00", "Gel neu"], ["11:30", "Auffüllen"], ["13:30", "Maniküre"], ["14:30", "Pediküre"], ["16:00", "Auffüllen"], ["17:15", "Maniküre"]];
const SARA = [["09:30", "Auffüllen"], ["11:00", "Maniküre"], ["14:00", "Gel neu"], ["16:00", "Pediküre"]];
const MIN = 60_000, DAY = 86_400_000;

function saveAccess(access: Access) {
  mkdirSync(path.dirname(accessPath), { recursive: true });
  writeFileSync(accessPath, `${JSON.stringify(access, null, 2)}\n`, { mode: 0o600 });
}

function getAccess(): Access {
  if (existsSync(accessPath)) {
    const saved = JSON.parse(readFileSync(accessPath, "utf8")) as Access;
    if (saved.ownerEmail !== ownerEmail || saved.cashierEmail !== cashierEmail || !saved.ownerPassword || !saved.cashierPassword) throw new Error("Existing salon access file has an unexpected shape; inspect it before seeding");
    return saved;
  }
  const access = { ownerEmail, ownerPassword: randomBytes(24).toString("base64url"), cashierEmail, cashierPassword: randomBytes(24).toString("base64url") };
  saveAccess(access);
  return access;
}

async function ensureUser(email: string, name: string, password: string) {
  const current = await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email]);
  if (current.rows[0]) return current.rows[0].id;
  process.env.PUBLIC_REGISTRATION_ENABLED = "true"; // this process only, already restricted to localhost (as scripts/seed.ts)
  const { auth } = await import("../src/lib/auth");
  const created = await auth.api.signUpEmail({ body: { email, name, password } });
  if (!created.user?.id) throw new Error(`Local demo account was not created for ${email}`);
  return created.user.id;
}

const wall = (date: string, time: string) => wallToInstant(date, time, tz)!;
const isoWeekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay() || 7;
const open = (date: string) => isoWeekday(date) <= 6;
const openDay = (date: string, step: number) => { while (!open(date)) date = addDays(date, step); return date; };

/**
 * The rebook story for "über Erinnerung neu gebucht": a card with the rebook opt-in, a Maniküre about 25 days back, its
 * push sent about 3 days ago, and a new confirmed Maniküre from that link. Runs on an already seeded salon too; skips once present.
 */
async function seedRebookStory(tenantId: string, ownerId: string) {
  if ((await pool.query("SELECT 1 FROM booking_appointments WHERE tenant_id = $1 AND idempotency_key = 'demo-salon:rebook:next'", [tenantId])).rows[0]) return;
  const { rows: [shop] } = await pool.query<{ location_id: string; slug: string }>("SELECT location_id, slug FROM programs WHERE tenant_id = $1 ORDER BY created_at LIMIT 1", [tenantId]);
  const scope = { tenantId, locationId: shop.location_id };
  const setup = await getSetup(scope);
  const serviceId = setup.services.find(s => s.name === "Maniküre")!.id, staffId = setup.staff.find(s => s.name === "Lena")!.id;
  const card = await enroll({ slug: shop.slug, acceptedTerms: true, marketingOptIn: false });
  const today = instantToWall(new Date(), tz).date;
  const sourceStart = wall(openDay(addDays(today, -25), -1), "10:00");
  await db.insert(consentEvents).values({ tenantId, membershipId: card.id, channel: "push", purpose: "booking_rebook", granted: true, noticeVersion: "booking-rebook-v1", source: "card", createdAt: new Date(sourceStart.getTime() - DAY) });
  // 16:00 at Lena is never part of the generated week, so the new appointment cannot collide with it.
  const visit = async (start: Date, key: string, rebookSourceId?: string) => {
    const booked = await book({ token: card.cardToken, serviceId, staffId, start, customerName: "Lotta", customerPhone: "0151-0000099", idempotencyKey: `demo-salon:rebook:${key}`, rebookSourceId }, new Date(start.getTime() - 2 * DAY));
    if (booked.appointment.status === "requested") await transition({ ...scope, userId: ownerId, appointmentId: booked.appointment.id, to: "confirmed", expected: "requested" }, new Date(start.getTime() - DAY));
    return booked.appointment;
  };
  const source = await visit(sourceStart, "source");
  await transition({ ...scope, userId: ownerId, appointmentId: source.id, to: "done", expected: "confirmed" }, new Date(sourceStart.getTime() + source.durationMin * MIN));
  await pool.query("UPDATE booking_appointments SET rebook_sent_at = now() - interval '3 days' WHERE tenant_id = $1 AND id = $2", [tenantId, source.id]);
  // Attribution counts a push that went out, as deliverRebook logs it.
  await pool.query("INSERT INTO booking_push_log (tenant_id, membership_id, appointment_id, kind, sent_at) VALUES ($1, $2, $3, 'rebook', now() - interval '3 days') ON CONFLICT DO NOTHING", [tenantId, card.id, source.id]);
  await visit(wall(openDay(addDays(today, 2), 1), "16:00"), "next", source.id);
}

/** The seeded requests stay open Anfragen on the pitch day and never ping the owner's phone; a request booked live during the pitch gets real jobs. */
async function silenceDemoRequests(tenantId: string) {
  await pool.query(`UPDATE outbox_jobs SET status = 'suppressed', last_error = 'Demo' WHERE tenant_id = $1 AND kind = 'booking.request' AND status IN ('pending','retry')
    AND payload->>'appointmentId' IN (SELECT id::text FROM booking_appointments WHERE tenant_id = $1 AND idempotency_key LIKE 'demo-salon:%')`, [tenantId]);
}

async function printAccess(access: Access, tenantId: string) {
  const { rows: [card] } = await pool.query<{ card_token: string }>(`SELECT m.card_token FROM booking_appointments a JOIN memberships m ON m.id = a.membership_id
    WHERE a.tenant_id = $1 AND a.status = 'confirmed' AND lower(a.during) > now() ORDER BY lower(a.during) LIMIT 1`, [tenantId]);
  console.log(`Nagelstudio Lumi is ready. Passwords: ${accessPath}`);
  console.log(`Owner login: ${access.ownerEmail} at ${base}/login`);
  console.log(`Customer card with an upcoming appointment: ${base}/card/${card?.card_token ?? "(none upcoming; reset and re-seed)"}`);
  console.log(`Day view: ${base}/merchant/termine`);
}

async function main() {
  // local-guard pins the database name to "looplocal"; the dev and test databases carry a suffix.
  assertLocalTarget({ databaseUrl: process.env.DATABASE_URL?.replace(/\/looplocal_[a-z]+$/, "/looplocal"), authUrl: process.env.BETTER_AUTH_URL, baseUrl: base, nodeEnv: process.env.NODE_ENV });
  const access = getAccess();
  const ownerId = await ensureUser(access.ownerEmail, "Inhaberin Lumi", access.ownerPassword);
  const cashierId = await ensureUser(access.cashierEmail, "Kasse Lumi", access.cashierPassword);

  const [existing] = await db.select().from(staffRoles).where(eq(staffRoles.userId, ownerId)).limit(1);
  let scope: { tenantId: string; locationId: string }, programSlug: string;
  if (existing) {
    // shortcut: skips instead of replacing, so the week stays dated to the first run; reset the database for a fresh week.
    const seeded = await pool.query("SELECT 1 FROM booking_appointments WHERE tenant_id = $1 LIMIT 1", [existing.tenantId]);
    if (seeded.rows[0]) {
      await seedRebookStory(existing.tenantId, ownerId);
      await silenceDemoRequests(existing.tenantId);
      console.log("Demo salon already seeded; only missing story parts were added.");
      return printAccess(access, existing.tenantId);
    }
    // An earlier run stopped before any appointment: finish it on the same merchant (tenants cannot be deleted, as scripts/seed.ts).
    const [location] = await db.select().from(locations).where(eq(locations.tenantId, existing.tenantId)).limit(1);
    const [program] = location ? await db.select().from(programs).where(eq(programs.locationId, location.id)).limit(1) : [];
    if (!location || !program) throw new Error("Salon owner exists, but the merchant setup is incomplete");
    scope = { tenantId: existing.tenantId, locationId: location.id };
    programSlug = program.slug;
  } else {
    const merchant = await createMerchant({ userId: ownerId, businessName: "Nagelstudio Lumi", locationName: "Kassel Vorderer Westen", city: "Kassel", country: "DE", timezone: tz, locale: "de", currency: "EUR",
      programName: "Lumi Stempelkarte", programType: "stamp", rulesText: "Ein Stempel pro Termin. Acht Stempel ergeben eine Maniküre gratis.", rewardTitle: "Maniküre gratis", rewardCost: 8, brandColor: "#8A4F6B" });
    scope = { tenantId: merchant.tenantId, locationId: merchant.locationId };
    programSlug = merchant.programSlug;
  }
  await db.insert(staffRoles).values({ ...scope, userId: cashierId, role: "cashier" }).onConflictDoNothing();

  const preset = PRESETS.nagelstudio;
  // Lena also works Mondays so a Monday pitch still has a "today"; lunch is a visible "Mittag" block instead of a break.
  const lena = [1, ...preset.workingHours.map(d => d.weekday)].map(weekday => ({ weekday, start: "09:00", end: "18:00", breaks: [] }));
  await saveSetup(scope, {
    settings: { shopType: "nagelstudio", leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: preset.autoConfirm, noShowBlockAfter: 3, maxOpenPerCard: 2, openingHours: lena },
    services: preset.services,
    staff: [{ name: "Lena", workingHours: lena }, { name: "Sara", workingHours: lena.filter(d => d.weekday >= 2 && d.weekday <= 5) }],
  });
  await pool.query("UPDATE booking_settings SET enabled = true WHERE tenant_id = $1", [scope.tenantId]);
  const setup = await getSetup(scope);
  const serviceId = (name: string) => setup.services.find(s => s.name === name)!.id;
  const staffId = (name: string) => setup.staff.find(s => s.name === name)!.id;

  const cards = [];
  for (const name of NAMES) cards.push({ name, token: (await enroll({ slug: programSlug, acceptedTerms: true, marketingOptIn: false })).cardToken });

  const today = instantToWall(new Date(), tz).date;
  const walk = (step: number) => { const out: string[] = []; for (let d = addDays(today, step); out.length < 5; d = addDays(d, step)) if (open(d)) out.push(d); return out; };
  const plan = [...walk(-1).reverse().map((date, i) => ({ date, kind: "past", n: [7, 8, 6, 7, 6][i] })),
    ...(open(today) ? [{ date: today, kind: "today", n: 6 }] : []),
    ...walk(1).map((date, i) => ({ date, kind: "next", n: [4, 3, 5, 4, 3][i] }))];

  let pastIndex = 0, nextIndex = 0, rotate = 0, todayDoneUntil = 0;
  for (const { date, kind, n } of plan) {
    await createBlock({ ...scope, start: wall(date, "13:00"), end: wall(date, "13:30"), reason: "Mittag" });
    const slots = [...LENA.map(s => [...s, "Lena"]), ...(isoWeekday(date) <= 5 && isoWeekday(date) >= 2 ? SARA.map(s => [...s, "Sara"]) : [])].sort((a, b) => a[0].localeCompare(b[0])).slice(0, n);
    for (const [index, [time, service, staff]] of slots.entries()) {
      const start = wall(date, time);
      const past = kind === "past" ? pastIndex++ : -1, next = kind === "next" ? nextIndex++ : -1;
      const noShow = past === 3 || past === 15 || past === 27; // the same card three times, so noShowBlockAfter = 3 pauses it
      const card = noShow ? cards[0] : cards[1 + (rotate++ % (cards.length - 1))];
      const booked = await book({ token: card.token, serviceId: serviceId(service), staffId: staffId(staff), start, customerName: card.name, customerPhone: `0151-0000${String(cards.indexOf(card)).padStart(3, "0")}`,
        idempotencyKey: `demo-salon:${date}:${time}:${staff}` }, new Date(start.getTime() - 2 * DAY));
      const step = (to: "confirmed" | "done" | "no_show" | "cancelled_by_shop", expected: "requested" | "confirmed", now: Date, reason?: string) =>
        transition({ ...scope, userId: ownerId, appointmentId: booked.appointment.id, to, expected, reason }, now);
      const after = new Date(start.getTime() + booked.appointment.durationMin * MIN);
      if (past === 9) await cancelByCustomer({ token: card.token, appointmentId: booked.appointment.id }, new Date(start.getTime() - 3 * 3_600_000));
      else if (past === 20) await step("cancelled_by_shop", "requested", new Date(start.getTime() - DAY), "Mitarbeiterin krank");
      else if (noShow) await step("no_show", "requested", after);
      else if (kind === "past" || (kind === "today" && index < 2)) {
        await step("done", "requested", after);
        if (kind === "today") todayDoneUntil = Math.max(todayDoneUntil, after.getTime());
      }
      else if (next !== 1 && next !== 6) await step("confirmed", "requested", new Date(start.getTime() - DAY));
    }
  }
  await seedRebookStory(scope.tenantId, ownerId);
  await silenceDemoRequests(scope.tenantId);
  // Today's first two appointments are seeded as done; before they end (11:30 on a Monday or Saturday) they would show done ahead of time.
  if (todayDoneUntil > Date.now()) console.log(`Note: today's done appointments end at ${instantToWall(new Date(todayDoneUntil), tz).time}. Seed after that time on the pitch day (reset the database first).`);
  await printAccess(access, scope.tenantId);
}

main().then(() => process.exit(0), (error) => {
  console.error(error instanceof Error ? `${error.message}${error.cause ? `\n${String(error.cause)}` : ""}` : "Salon seed failed");
  process.exit(1);
});
