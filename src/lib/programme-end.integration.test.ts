import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, ledgerEntries, memberships, plateLinkEvents, programmeCancellationEvents, programs, rewardVersions, secureTags, tapRequests } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { processSecureTap } from "./secure-tap";
import { enroll, getCard, getMerchantContext } from "./product";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { endDueProgrammes, endedCardShop, endProgramme, operatorProgramme, PROGRAMME_END_ACTOR, programmeEnded, requestCancellation, withdrawCancellation } from "./programme-end";
import { GET as exportGet } from "@/app/api/card/[token]/export/route";
import { assertExportOpen, endedAccount, exportWindow } from "./programme-end";
import { getMerchantCsv, getMerchantExport } from "./export";
import { updateProgramExtras } from "./product";
import { germanDate, lastDayOfBerlinMonth } from "./programme-end-date";
import { POST as cancelPost } from "@/app/api/merchant/program/cancel/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const UID = "04de5f1eacc041";
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };
const at = (iso: string) => new Date(iso);
let operator: string;
let env: Record<string, string | undefined>;
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", secure_tags, plate_link_events CASCADE');
  operator = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [operator, "Synthetic operator", `${operator}@example.test`]);
  env = { PLATE_OPERATOR_USER_IDS: operator };
});
afterAll(async () => { await pool.end(); });

async function shop() {
  const f = await nfcFixture();
  const keyRef = `dv1_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid: UID });
  const [tag] = await db.insert(secureTags).values({ publicRef: randomUUID().replaceAll("-", "").slice(0, 24), tenantId: f.tenant.id, locationId: f.location.id, programId: f.program.id, uid: UID, keyRef, configVersion: 1, status: "active", plateLabel: "P-007", lastCounter: 2 }).returning();
  const [rewardVersion] = await db.select().from(rewardVersions).where(eq(rewardVersions.tenantId, f.tenant.id));
  const book = (kind: "award" | "redeem") => kind === "award"
    ? award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() })
    : redeem({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId: rewardVersion.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const tap = (counter: number) => processSecureTap({ tagRef: tag.publicRef, fields: sdmFor({ uid: UID, counter, keys }), keyProvider: new DerivedTapKeyProvider(VERIFY), cardToken: f.member.cardToken });
  return { ...f, tag, book, tap };
}
const programme = async (id: string) => (await db.select().from(programs).where(eq(programs.id, id)))[0];

describe("end date", () => {
  it("is the last Berlin day of the month, across the year end and the time-zone offset", () => {
    expect(lastDayOfBerlinMonth(at("2026-10-10T10:00:00Z"))).toBe("2026-10-31");
    expect(lastDayOfBerlinMonth(at("2026-02-10T10:00:00Z"))).toBe("2026-02-28");
    expect(lastDayOfBerlinMonth(at("2026-12-31T23:30:00Z"))).toBe("2027-01-31"); // already 1 January in Berlin
    expect(lastDayOfBerlinMonth(at("2026-10-31T22:30:00Z"))).toBe("2026-10-31"); // 23:30 on the 31st in Berlin
    expect(lastDayOfBerlinMonth(at("2026-10-31T23:30:00Z"))).toBe("2026-11-30"); // 00:30 on 1 November in Berlin
    expect(germanDate("2026-10-31")).toBe("31.10.2026");
  });
});

describe("owner request and withdrawal", () => {
  it("records the end date, keeps it when repeated, and lets the owner withdraw", async () => {
    const f = await shop();
    const now = at("2026-10-10T10:00:00Z");
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now })).toEqual({ endDate: "2026-10-31", nextMonth: false, confirmed: false });
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-22T10:00:00Z") })).toEqual({ endDate: "2026-10-31", nextMonth: false, confirmed: false });
    expect((await programme(f.program.id)).cancellationEndDate).toBe("2026-10-31");
    expect(await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now })).toEqual({ endDate: null });
    expect((await programme(f.program.id)).cancellationEndDate).toBeNull();
  });

  it("moves the end to the next month under the minimum notice, keeps it when repeated, and the owner can still withdraw", async () => {
    const f = await shop();
    const late = at("2026-10-21T10:00:00Z"); // 10 days left
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: late })).toEqual({ endDate: "2026-11-30", nextMonth: true, confirmed: false });
    expect((await programme(f.program.id)).cancellationEndDate).toBe("2026-11-30");
    expect(await endDueProgrammes(at("2026-11-01T00:00:00Z"))).toBe(0); // October is no longer the end
    expect(await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: late })).toEqual({ endDate: null });
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-12-20T10:00:00Z") })).toEqual({ endDate: "2027-01-31", nextMonth: true, confirmed: false });
  });

  it("an unconfirmed request never ends the programme, however late; the operator's confirmation sets the date and the card follows it", async () => {
    const f = await shop();
    const operate = (endDate: string) => operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate, execute: true, now: at("2026-10-10T10:00:00Z") });
    const { endsOn: none, ...plain } = await getCard(f.member.cardToken);
    expect(none).toBeUndefined();
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") });
    expect(await endDueProgrammes(at("2027-06-01T00:00:00Z"))).toBe(0); // long after the provisional date
    expect((await programme(f.program.id)).status).toBe("active");
    expect((await getCard(f.member.cardToken)).endsOn).toBeUndefined(); // nothing about the cancellation before confirmation
    expect(await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "status", execute: false })).toMatchObject({ state: "requested", end: "2026-10-31" });
    await operate("2026-11-15");
    expect(await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "status", execute: false })).toMatchObject({ state: "confirmed", end: "2026-11-15" });
    const { endsOn, ...after } = await getCard(f.member.cardToken);
    expect(endsOn).toBe("2026-11-15");
    expect(after).toEqual(plain); // the date is the only new field
    await operate("2026-11-30"); // moving the date moves the card
    expect((await getCard(f.member.cardToken)).endsOn).toBe("2026-11-30");
    expect(await endDueProgrammes(at("2026-11-16T00:00:00Z"))).toBe(0);
    expect(await endDueProgrammes(at("2026-12-01T00:00:00Z"))).toBe(1);
    expect(await endedCardShop(f.member.cardToken)).toBe("Tap Test Café");
  });

  it("tells the owner app whether the end date is confirmed (it decides the wording and the customer text)", async () => {
    const f = await shop();
    expect(await getMerchantContext(f.userId)).toMatchObject({ cancellationEndDate: null, cancellationConfirmed: false });
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") });
    expect(await getMerchantContext(f.userId)).toMatchObject({ cancellationEndDate: "2026-10-31", cancellationConfirmed: false });
    await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate: "2026-11-15", execute: true });
    expect(await getMerchantContext(f.userId)).toMatchObject({ cancellationEndDate: "2026-11-15", cancellationConfirmed: true });
  });

  it("withdrawing clears the date and the confirmation", async () => {
    const f = await shop();
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") });
    await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate: "2026-11-15", execute: true, now: at("2026-10-10T10:00:00Z") });
    expect(await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-12T10:00:00Z") })).toEqual({ endDate: null });
    expect(await programme(f.program.id)).toMatchObject({ cancellationEndDate: null, cancellationConfirmedAt: null });
    expect((await getCard(f.member.cardToken)).endsOn).toBeUndefined();
  });

  it("refuses staff, another shop's owner and strangers the same way as a missing programme", async () => {
    const f = await shop();
    const other = await nfcFixture();
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const manager = await addStaff(f.tenant.id, f.location.id, "manager");
    for (const actorUserId of [cashier, manager, other.userId, randomUUID()]) {
      expect(await code(() => requestCancellation({ actorUserId, programSlug: f.program.slug }))).toBe("NOT_FOUND");
      expect(await code(() => withdrawCancellation({ actorUserId, programSlug: f.program.slug }))).toBe("NOT_FOUND");
    }
    expect((await programme(f.program.id)).cancellationEndDate).toBeNull();
  });

  it("cannot be withdrawn once the end date has passed", async () => {
    const f = await shop();
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") });
    await db.update(programs).set({ cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    expect(await code(() => withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-31T23:00:00Z") }))).toBe("PROGRAM_ENDED");
    expect(await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-31T22:59:59Z") })).toEqual({ endDate: null });
  });

  it("the route refuses a cross-site request before doing anything", async () => {
    const response = await cancelPost(new Request("https://app.example.test/api/merchant/program/cancel", { method: "POST", headers: { origin: "https://evil.example", "content-type": "application/json" }, body: "{}" }));
    expect(response.status).toBe(403);
  });
});

describe("the end-date job", () => {
  it("waits for the end of the last Berlin day, in winter, summer and around the 25-hour and 23-hour days", async () => {
    // [end date, last instant still open, first instant due]
    for (const [end, open, due] of [
      ["2026-10-31", "2026-10-31T22:59:59Z", "2026-10-31T23:00:00Z"], // CET after the clocks went back
      ["2026-07-15", "2026-07-15T21:59:59Z", "2026-07-15T22:00:00Z"], // CEST
      ["2026-10-25", "2026-10-25T22:59:59Z", "2026-10-25T23:00:00Z"], // the 25-hour day
      ["2026-03-28", "2026-03-28T22:59:59Z", "2026-03-28T23:00:00Z"], // the day before the 23-hour day
    ]) {
      const f = await shop();
      await db.update(programs).set({ cancellationEndDate: end, cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
      expect(await endDueProgrammes(at(open)), end).toBe(0);
      expect((await programme(f.program.id)).status).toBe("active");
      expect(await endDueProgrammes(at(due)), end).toBe(1);
      expect((await programme(f.program.id)).status).toBe("ended");
      await pool.query("TRUNCATE TABLE tenants, secure_tags, plate_link_events CASCADE");
    }
  });

  it("leaves programmes without an end date alone", async () => {
    const f = await shop();
    expect(await endDueProgrammes(at("2030-01-01T00:00:00Z"))).toBe(0);
    expect((await programme(f.program.id)).status).toBe("active");
  });

  it("ends once and unlinks the plates with one audit row by the system actor, even when run at the same time", async () => {
    const f = await shop();
    await db.update(programs).set({ cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    const now = at("2026-11-01T00:00:00Z");
    // Three ends of the same programme at once: only the row lock makes exactly one of them win, every time.
    const runs = await Promise.all([1, 2, 3].map(() => endProgramme({ programId: f.program.id, actorUserId: PROGRAMME_END_ACTOR, now })));
    expect(runs.filter(Boolean)).toHaveLength(1);
    expect(await endDueProgrammes(now)).toBe(0);
    const [tag] = await db.select().from(secureTags).where(eq(secureTags.id, f.tag.id));
    expect(tag).toMatchObject({ status: "unlinked", tenantId: null, locationId: null, programId: null, plateLabel: "P-007" });
    const events = await db.select().from(plateLinkEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ action: "unlink", actorUserId: PROGRAMME_END_ACTOR, plateLabel: "P-007", oldProgramId: f.program.id, oldTenantId: f.tenant.id, newProgramId: null });
  });

  it("keeps the balance and history", async () => {
    const f = await shop();
    await f.book("award");
    await db.update(programs).set({ cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    await endDueProgrammes(at("2026-11-01T00:00:00Z"));
    expect((await pool.query("SELECT balance FROM memberships WHERE id = $1", [f.member.id])).rows[0].balance).toBe(8);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id = $1", [f.member.id])).rows[0].n).toBe(1);
  });
});

describe("after the end", () => {
  it("lets redemptions through until the programme ends and books nothing afterwards", async () => {
    const f = await shop();
    await f.book("award");
    await f.book("award");
    await db.update(programs).set({ cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    await endDueProgrammes(at("2026-10-31T22:59:59Z")); // last day still open
    expect(await f.book("redeem")).toMatchObject({ duplicate: false });
    await endDueProgrammes(at("2026-10-31T23:00:00Z"));
    expect(await code(() => f.book("redeem"))).toBe("NOT_FOUND");
    expect(await code(() => f.book("award"))).toBe("NOT_FOUND");
  });

  it("refuses every booking path once ended and books nothing: award, redeem, correction, NFC tap, join", async () => {
    const f = await shop();
    const booked = await f.book("award");
    await f.book("award");
    await db.update(programs).set({ cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    const snapshot = async () => ({
      ledger: (await db.select().from(ledgerEntries)).length, cards: (await db.select().from(memberships)).length, taps: (await db.select().from(tapRequests)).length,
      balance: (await pool.query("SELECT balance FROM memberships WHERE id = $1", [f.member.id])).rows[0].balance as number,
    });
    // Control: before the end the plate-linked tap opens a request.
    expect(await f.tap(3)).toMatchObject({ state: "pending_staff" });
    const before = await snapshot();
    await endDueProgrammes(at("2026-11-01T00:00:00Z"));
    expect(await code(() => f.book("award"))).toBe("NOT_FOUND");
    expect(await code(() => f.book("redeem"))).toBe("NOT_FOUND");
    expect(await code(() => reverseEntry({ userId: f.userId, locationId: f.location.id, entryId: booked.entryId, reason: "Versehentlich falsch gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() }))).toBe("NOT_FOUND");
    expect(await code(() => f.tap(4))).toBe("NOT_FOUND"); // the end job unlinked the plate
    expect(await code(() => enroll({ slug: f.program.slug, acceptedTerms: true }))).toBe("NOT_FOUND");
    expect(await snapshot()).toEqual(before);
    // The owner app gets its own answer instead of „Einrichtung unvollständig“.
    expect(await code(() => getMerchantContext(f.userId))).toBe("PROGRAM_ENDED");
  });

  it("refuses a tap on a still-linked tag when the programme status is already ended", async () => {
    const f = await shop();
    await db.update(programs).set({ status: "ended" }).where(eq(programs.id, f.program.id));
    expect(await code(() => f.tap(3))).toBe("NOT_FOUND");
    expect(await db.select().from(tapRequests)).toHaveLength(0);
    expect(await db.select().from(ledgerEntries)).toHaveLength(0);
  });

  it("keeps the card's data export working and names the shop on the ended card page", async () => {
    const f = await shop();
    await f.book("award");
    expect(await endedCardShop(f.member.cardToken)).toBeNull();
    await endProgramme({ programId: f.program.id, actorUserId: operator, force: true });
    expect(await endedCardShop(f.member.cardToken)).toBe("Tap Test Café");
    const response = await exportGet(new Request(`https://app.example.test/api/card/${f.member.cardToken}/export`, { headers: { "x-forwarded-for": "203.0.113.9" } }), { params: Promise.resolve({ token: f.member.cardToken }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ membership: { balance: 8 } });
  });

  it("renders the export link and the shop line on the ended page,", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { ProgrammeEnded } = await import("@/components/customer/programme-ended");
    const html = renderToStaticMarkup(ProgrammeEnded({ shop: "Tap Test Café", cardToken: "card_abc" }));
    expect(html).toContain("Daten herunterladen");
    expect(html).toContain("/api/card/card_abc/export");
    expect(html).toContain("Wende dich an Tap Test Café.");
    expect(html).toContain("Dieses Programm ist beendet.");
  });

  it("shows the ended page for the join link, the card, the plate tap and the plate sticker, and for no live programme", async () => {
    const f = await shop();
    const by = [{ slug: f.program.slug }, { cardToken: f.member.cardToken }, { tapRef: f.tag.publicRef }, { plateLabel: "P-007" }];
    for (const one of by) expect(await programmeEnded(one)).toBe(false);
    await db.update(programs).set({ cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, f.program.id));
    await endDueProgrammes(at("2026-11-01T00:00:00Z"));
    for (const one of by) expect(await programmeEnded(one)).toBe(true);
    expect(await programmeEnded({ tapRef: "not-a-tag" })).toBe(false);
  });
});

describe("operator console", () => {
  it("is dry run until execute, only for the allowlist, and ends the programme at once with the operator in the audit", async () => {
    const f = await shop();
    const run = (command: "status" | "schedule" | "end", execute: boolean, actorUserId = operator, endDate?: string, now = at("2026-10-21T10:00:00Z")) => operatorProgramme({ actorUserId, env, programId: f.program.id, command, endDate, execute, now });
    expect(await code(() => run("end", true, f.userId))).toBe("FORBIDDEN");
    expect(await code(() => run("schedule", true, operator, "31.10.2026"))).toBe("INVALID_END_DATE");
    for (const impossible of ["2026-02-30", "2026-11-31", "2026-13-01", "2027-02-29"]) for (const execute of [false, true]) expect(await code(() => run("schedule", execute, operator, impossible))).toBe("INVALID_END_DATE");
    // The console refuses a day that has begun in Berlin too, dry run or not: 22:30 UTC on 21 Oct is already the 22nd there.
    for (const [endDate, now] of [["2026-10-21", "2026-10-21T10:00:00Z"], ["2026-10-22", "2026-10-21T22:30:00Z"], ["2020-01-01", "2026-10-21T10:00:00Z"]] as const) for (const execute of [false, true]) expect(await code(() => run("schedule", execute, operator, endDate, at(now)))).toBe("END_DATE_TOO_EARLY");
    expect(await run("schedule", false, operator, "2026-10-22")).toMatchObject({ result: "would_schedule" }); // tomorrow is the earliest
    expect((await programme(f.program.id)).cancellationEndDate).toBeNull();
    expect(await run("schedule", false, operator, "2026-11-15")).toMatchObject({ result: "would_schedule" });
    expect((await programme(f.program.id)).cancellationEndDate).toBeNull();
    expect(await run("schedule", true, operator, "2026-11-15")).toMatchObject({ result: "schedule" });
    expect((await programme(f.program.id)).cancellationEndDate).toBe("2026-11-15");
    expect(await run("end", false)).toMatchObject({ result: "would_end" });
    expect((await programme(f.program.id)).status).toBe("active");
    expect(await run("end", true)).toMatchObject({ result: "end", unlinkedPlates: 1 });
    expect(await run("end", true)).toMatchObject({ result: "unchanged" });
    expect((await programme(f.program.id)).status).toBe("ended");
    expect((await db.select().from(plateLinkEvents))[0]).toMatchObject({ actorUserId: operator, action: "unlink" });
    expect(await programmeEnded({ slug: f.program.slug })).toBe(true);
    expect(await programmeEnded({ tapRef: f.tag.publicRef })).toBe(true); // unlinked by the operator, not the job
  });
});

describe("after the end: the owner's export window and what stays closed", () => {
  const endedOn = (id: string, day: string) => db.update(programs).set({ status: "ended", cancellationEndDate: day, cancellationConfirmedAt: new Date() }).where(eq(programs.id, id));

  it("keeps the export open on day 0 and day 30 after the confirmed end date and closes it on day 31 (Berlin days)", async () => {
    const f = await shop();
    await endedOn(f.program.id, "2026-10-31");
    const open = async (iso: string) => (await exportWindow(db, f.tenant.id, at(iso))) as { open: boolean; until: string };
    expect(await open("2026-10-31T10:00:00Z")).toMatchObject({ open: true, until: "2026-11-30" }); // day 0
    expect(await open("2026-11-30T22:59:59Z")).toMatchObject({ open: true }); // 23:59:59 on day 30 in Berlin
    expect(await open("2026-11-30T23:00:00Z")).toMatchObject({ open: false }); // 00:00 on day 31
    expect(await code(() => assertExportOpen(db, f.tenant.id, at("2026-11-30T22:59:59Z")))).toBe("NONE");
    expect(await code(() => assertExportOpen(db, f.tenant.id, at("2026-12-01T10:00:00Z")))).toBe("EXPORT_CLOSED");
    expect(await endedAccount(f.userId, at("2026-11-05T10:00:00Z"))).toMatchObject({ role: "owner", businessName: "Tap Test Café", endedOn: "2026-10-31", exportUntil: "2026-11-30", exportOpen: true });
    expect(await endedAccount(f.userId, at("2026-12-05T10:00:00Z"))).toMatchObject({ exportOpen: false });
  });

  it("lets the owner download the full export and both CSVs of an ended programme, and refuses them after the window", async () => {
    const f = await shop();
    await f.book("award");
    await endProgramme({ programId: f.program.id, actorUserId: operator, force: true }); // immediate end: today becomes the confirmed end date
    expect((await getMerchantExport(f.userId)).memberships).toHaveLength(1);
    expect((await getMerchantCsv(f.userId, "karten")).body).toContain("Tap Card");
    expect((await getMerchantCsv(f.userId, "buchungen")).body).toContain("Menge");
    await endedOn(f.program.id, "2020-01-01");
    for (const run of [() => getMerchantExport(f.userId), () => getMerchantCsv(f.userId, "karten"), () => getMerchantCsv(f.userId, "buchungen")]) expect(await code(run)).toBe("EXPORT_CLOSED");
  });

  it("an immediate operator end replaces a scheduled future date with today, so the ended page shows today", async () => {
    const f = await shop();
    await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate: "2099-12-31", execute: true });
    expect(await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "end", execute: true })).toMatchObject({ result: "end" });
    const [{ today }] = (await pool.query("SELECT (now() AT TIME ZONE 'Europe/Berlin')::date::text AS today")).rows;
    expect(await programme(f.program.id)).toMatchObject({ status: "ended", cancellationEndDate: today });
    expect((await programme(f.program.id)).cancellationConfirmedAt).not.toBeNull();
    expect(await endedAccount(f.userId)).toMatchObject({ endedOn: today });
  });

  it("gives endedAccount only the caller's own tenant: not another shop's owner, not a stranger", async () => {
    const f = await shop();
    const running = await nfcFixture(); // a second shop whose programme is still running
    const manager = await addStaff(f.tenant.id, f.location.id, "manager");
    await endedOn(f.program.id, "2026-10-31");
    expect(await endedAccount(running.userId)).toBeNull();
    expect(await endedAccount(randomUUID())).toBeNull();
    expect(await endedAccount(f.userId)).toMatchObject({ tenantId: f.tenant.id, role: "owner" });
    expect(await endedAccount(manager)).toMatchObject({ tenantId: f.tenant.id, role: "manager" });
  });

  it("refuses non-owners the export and gives them no ended page data, and a shop with a running programme is unaffected", async () => {
    const f = await shop();
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    expect((await getMerchantExport(f.userId)).tenant).toBeTruthy(); // running programme: normal operation
    expect(await endedAccount(f.userId)).toBeNull();
    await endedOn(f.program.id, "2026-10-31");
    expect(await code(() => getMerchantExport(cashier))).toBe("FORBIDDEN");
    expect(await code(() => getMerchantCsv(cashier, "karten"))).toBe("FORBIDDEN");
    expect(await endedAccount(randomUUID())).toBeNull();
    expect((await endedAccount(cashier))?.role).toBe("cashier");
  });

  it("lets the owner change nothing about the programme once it ended", async () => {
    const f = await shop();
    await endedOn(f.program.id, "2026-10-31");
    expect(await code(() => updateProgramExtras({ actorUserId: f.userId, programId: f.program.id, welcomeBonus: 1 }))).toBe("NOT_FOUND");
    expect(await code(() => requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug }))).toBe("PROGRAM_ENDED");
    expect(await code(() => withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-01T00:00:00Z") }))).toBe("PROGRAM_ENDED");
    expect(await code(() => getMerchantContext(f.userId))).toBe("PROGRAM_ENDED");
  });

  it("records when the request was first made, keeps it on repeats, clears it on withdraw and shows it to the operator", async () => {
    const f = await shop();
    const status = () => operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "status", execute: false });
    expect(await status()).toMatchObject({ state: "none", requestedAt: null });
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") });
    const first = (await status()) as { requestedAt: Date | null; state: string };
    expect(first.state).toBe("requested");
    expect(first.requestedAt).toBeInstanceOf(Date);
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-12T10:00:00Z") });
    expect(((await status()) as { requestedAt: Date }).requestedAt).toEqual(first.requestedAt);
    await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-12T10:00:00Z") });
    expect(await status()).toMatchObject({ state: "none", requestedAt: null });
  });
});

describe("an owner with two locations, the oldest of which has ended", () => {
  async function twoLocations() {
    const f = await shop();
    const [second] = await db.insert(locations).values({ tenantId: f.tenant.id, name: "Göttingen", city: "Göttingen", country: "DE", timezone: "Europe/Berlin", createdAt: new Date(Date.now() + 60_000) }).returning();
    const [running] = await db.insert(programs).values({ tenantId: f.tenant.id, locationId: second.id, slug: `second-${randomUUID()}`, name: "Second Card", type: "stamp", rulesText: "One stamp per visit." }).returning();
    return { ...f, second, running };
  }
  const end = (id: string) => db.update(programs).set({ status: "ended", cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date() }).where(eq(programs.id, id));

  it("works in the running location with no selection and with the ended location selected", async () => {
    const f = await twoLocations();
    await end(f.program.id);
    expect(await getMerchantContext(f.userId)).toMatchObject({ locationId: f.second.id, programSlug: f.running.slug });
    expect(await getMerchantContext(f.userId, f.location.id)).toMatchObject({ locationId: f.second.id, programSlug: f.running.slug });
    expect(await getMerchantContext(f.userId, f.second.id)).toMatchObject({ locationId: f.second.id });
    expect(await endedAccount(f.userId)).toBeNull(); // a running programme: no ended page
  });

  it("shows the ended page only when every location has ended", async () => {
    const f = await twoLocations();
    await end(f.program.id);
    await end(f.running.id);
    expect(await code(() => getMerchantContext(f.userId))).toBe("PROGRAM_ENDED");
    expect(await code(() => getMerchantContext(f.userId, f.second.id))).toBe("PROGRAM_ENDED");
    expect(await endedAccount(f.userId)).toMatchObject({ role: "owner", endedOn: "2026-10-31" });
  });

  it("does not move a team member: a cashier of the ended location gets the ended answer, a cashier of the running one works", async () => {
    const f = await twoLocations();
    await end(f.program.id);
    const atEnded = await addStaff(f.tenant.id, f.location.id, "cashier");
    const atRunning = await addStaff(f.tenant.id, f.second.id, "cashier");
    expect(await code(() => getMerchantContext(atEnded))).toBe("PROGRAM_ENDED");
    expect(await getMerchantContext(atRunning)).toMatchObject({ locationId: f.second.id });
  });

  it("keeps SETUP_INCOMPLETE for a location that has no programme yet", async () => {
    const f = await twoLocations();
    const [empty] = await db.insert(locations).values({ tenantId: f.tenant.id, name: "Leer", city: "Kassel", country: "DE", timezone: "Europe/Berlin" }).returning();
    expect(await code(() => getMerchantContext(f.userId, empty.id))).toBe("SETUP_INCOMPLETE");
  });
});

describe("cancellation audit", () => {
  const history = async (programId: string) => (await db.select().from(programmeCancellationEvents).where(eq(programmeCancellationEvents.programId, programId)).orderBy(programmeCancellationEvents.createdAt))
    .map(({ action, actorUserId, oldEndDate, newEndDate }) => ({ action, actorUserId, oldEndDate, newEndDate }));

  it("records every request, withdrawal, confirmation, move and end with the actor and the date before and after; rows cannot change", async () => {
    const f = await shop();
    const owner = { actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-10T10:00:00Z") };
    const schedule = (endDate: string, execute = true) => operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate, execute });
    await requestCancellation(owner);
    await requestCancellation(owner); // a repeat is recorded too, with the date kept
    await withdrawCancellation(owner);
    await requestCancellation(owner);
    await schedule("2099-11-15", false); // a dry run records nothing
    await schedule("2099-11-15");
    await schedule("2099-11-30");
    await expect(code(() => withdrawCancellation({ ...owner, actorUserId: randomUUID() }))).resolves.toBe("NOT_FOUND"); // a refusal records nothing
    expect(await endDueProgrammes(at("2099-12-01T00:00:00Z"))).toBe(1);
    expect(await endDueProgrammes(at("2099-12-02T00:00:00Z"))).toBe(0); // no second end row
    expect(await history(f.program.id)).toEqual([
      { action: "request", actorUserId: f.userId, oldEndDate: null, newEndDate: "2026-10-31" },
      { action: "request", actorUserId: f.userId, oldEndDate: "2026-10-31", newEndDate: "2026-10-31" },
      { action: "withdraw", actorUserId: f.userId, oldEndDate: "2026-10-31", newEndDate: null },
      { action: "request", actorUserId: f.userId, oldEndDate: null, newEndDate: "2026-10-31" },
      { action: "confirm", actorUserId: operator, oldEndDate: "2026-10-31", newEndDate: "2099-11-15" },
      { action: "schedule", actorUserId: operator, oldEndDate: "2099-11-15", newEndDate: "2099-11-30" },
      { action: "end", actorUserId: PROGRAMME_END_ACTOR, oldEndDate: "2099-11-30", newEndDate: "2099-11-30" },
    ]);
    await expect(pool.query("UPDATE programme_cancellation_events SET new_end_date = NULL")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM programme_cancellation_events")).rejects.toThrow(/append-only/);
    await expect(pool.query("INSERT INTO programme_cancellation_events (tenant_id, program_id, action, actor_user_id) VALUES ($1, $2, 'cancel', 'x')", [f.tenant.id, f.program.id])).rejects.toThrow(/programme_cancellation_action_valid/);
  });

  it("records an operator's schedule without a request, and an immediate end with the operator and today's date", async () => {
    const f = await shop();
    await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "schedule", endDate: "2099-11-15", execute: true });
    await operatorProgramme({ actorUserId: operator, env, programId: f.program.id, command: "end", execute: true });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(new Date());
    expect(await history(f.program.id)).toEqual([
      { action: "schedule", actorUserId: operator, oldEndDate: null, newEndDate: "2099-11-15" },
      { action: "end", actorUserId: operator, oldEndDate: "2099-11-15", newEndDate: today },
    ]);
  });
});
