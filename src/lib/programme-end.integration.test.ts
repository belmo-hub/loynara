import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { plateLinkEvents, programs, rewardVersions, secureTags } from "@/db/schema";
import { award, redeem } from "./loyalty";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { endDueProgrammes, operatorProgramme, PROGRAMME_END_ACTOR, programmeEnded, requestCancellation, withdrawCancellation } from "./programme-end";
import { germanDate, lastDayOfBerlinMonth } from "./programme-end-date";
import { POST as cancelPost } from "@/app/api/merchant/program/cancel/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

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
  const [tag] = await db.insert(secureTags).values({ publicRef: randomUUID().replaceAll("-", "").slice(0, 24), tenantId: f.tenant.id, locationId: f.location.id, programId: f.program.id, uid: randomUUID().replaceAll("-", "").slice(0, 14), keyRef: "dv1_test", configVersion: 1, status: "active", plateLabel: "P-007", lastCounter: 2 }).returning();
  const [rewardVersion] = await db.select().from(rewardVersions).where(eq(rewardVersions.tenantId, f.tenant.id));
  const book = (kind: "award" | "redeem") => kind === "award"
    ? award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() })
    : redeem({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId: rewardVersion.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
  return { ...f, tag, book };
}
const programme = async (id: string) => (await db.select().from(programs).where(eq(programs.id, id)))[0];

describe("end date", () => {
  it("is the last Berlin day of the month, across the year end and the time-zone offset", () => {
    expect(lastDayOfBerlinMonth(at("2026-10-21T10:00:00Z"))).toBe("2026-10-31");
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
    const now = at("2026-10-21T10:00:00Z");
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now })).toEqual({ endDate: "2026-10-31" });
    expect(await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-22T10:00:00Z") })).toEqual({ endDate: "2026-10-31" });
    expect((await programme(f.program.id)).cancellationEndDate).toBe("2026-10-31");
    expect(await withdrawCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now })).toEqual({ endDate: null });
    expect((await programme(f.program.id)).cancellationEndDate).toBeNull();
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
    await requestCancellation({ actorUserId: f.userId, programSlug: f.program.slug, now: at("2026-10-21T10:00:00Z") });
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
      await db.update(programs).set({ cancellationEndDate: end }).where(eq(programs.id, f.program.id));
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
    await db.update(programs).set({ cancellationEndDate: "2026-10-31" }).where(eq(programs.id, f.program.id));
    const now = at("2026-11-01T00:00:00Z");
    const runs = await Promise.all([endDueProgrammes(now), endDueProgrammes(now), endDueProgrammes(now)]);
    expect(runs.reduce((a, b) => a + b, 0)).toBe(1);
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
    await db.update(programs).set({ cancellationEndDate: "2026-10-31" }).where(eq(programs.id, f.program.id));
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
    await db.update(programs).set({ cancellationEndDate: "2026-10-31" }).where(eq(programs.id, f.program.id));
    await endDueProgrammes(at("2026-10-31T22:59:59Z")); // last day still open
    expect(await f.book("redeem")).toMatchObject({ duplicate: false });
    await endDueProgrammes(at("2026-10-31T23:00:00Z"));
    expect(await code(() => f.book("redeem"))).toBe("NOT_FOUND");
    expect(await code(() => f.book("award"))).toBe("NOT_FOUND");
  });

  it("shows the ended page for the join link, the card, the plate tap and the plate sticker, and for no live programme", async () => {
    const f = await shop();
    const by = [{ slug: f.program.slug }, { cardToken: f.member.cardToken }, { tapRef: f.tag.publicRef }, { plateLabel: "P-007" }];
    for (const one of by) expect(await programmeEnded(one)).toBe(false);
    await db.update(programs).set({ cancellationEndDate: "2026-10-31" }).where(eq(programs.id, f.program.id));
    await endDueProgrammes(at("2026-11-01T00:00:00Z"));
    for (const one of by) expect(await programmeEnded(one)).toBe(true);
    expect(await programmeEnded({ tapRef: "not-a-tag" })).toBe(false);
  });
});

describe("operator console", () => {
  it("is dry run until execute, only for the allowlist, and ends the programme at once with the operator in the audit", async () => {
    const f = await shop();
    const run = (command: "status" | "schedule" | "end", execute: boolean, actorUserId = operator, endDate?: string) => operatorProgramme({ actorUserId, env, programId: f.program.id, command, endDate, execute });
    expect(await code(() => run("end", true, f.userId))).toBe("FORBIDDEN");
    expect(await code(() => run("schedule", true, operator, "31.10.2026"))).toBe("INVALID_END_DATE");
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
  });
});
