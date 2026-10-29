import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, redemptions, rewardVersions, rewards, walletPasses } from "@/db/schema";
import { award, redeem } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { getLaunchReadiness } from "./readiness";
import { getRetentionSummary } from "./retention";
import { rewardReadyMemberships } from "./reward-readiness";
import { selectAudience } from "./segments";
import { nfcFixture } from "./nfc-test-db";
import { claimOutboxJob } from "./outbox";
import { archiveReward, createReward, currentRewards, editReward, getCard, getMerchantRewards, getPublicProgram, lookupCard, takeBackRewardChange } from "./product";
import { runWalletProgramRefresh } from "./wallet/enqueue";
import { walletCardSnapshot } from "./wallet/data";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

type Fixture = Awaited<ReturnType<typeof nfcFixture>>;
async function setup() {
  const f = await nfcFixture();
  const [coffee] = await getMerchantRewards({ actorUserId: f.userId, programSlug: f.program.slug });
  const cake = await createReward({ actorUserId: f.userId, programSlug: f.program.slug, title: "Cake", cost: 12 });
  await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 20, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const owner = { actorUserId: f.userId, programSlug: f.program.slug };
  const redeemVersion = (rewardVersionId: string) => redeem({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const merchantRow = async (rewardId: string) => (await getMerchantRewards(owner)).find(row => row.rewardId === rewardId)!;
  const versions = async (rewardId: string) => (await db.select().from(rewardVersions).where(eq(rewardVersions.rewardId, rewardId))).length;
  return { f, coffee, cake, owner, redeemVersion, merchantRow, versions };
}
/** The Berlin calendar day of a version's effective_at, computed by the database like the payloads do. */
async function berlinDay(sqlInstant: string, id: string) {
  return (await pool.query<{ day: string }>(`SELECT to_char(${sqlInstant} AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day FROM reward_versions WHERE id = $1`, [id])).rows[0].day;
}
/** A reward with a version history in the past: rows are append-only, so time passing is written as past timestamps. */
async function pastReward(f: Fixture, history: Array<{ cost: number; createdDaysAgo: number; effectiveDaysAgo: number }>) {
  const [reward] = await db.insert(rewards).values({ tenantId: f.tenant.id, programId: f.program.id, sortOrder: 5 }).returning();
  const ids: string[] = [];
  for (const [index, row] of history.entries()) {
    const result = await pool.query<{ id: string }>(`INSERT INTO reward_versions (tenant_id, reward_id, version, title, cost, terms_text, created_at, effective_at)
      VALUES ($1, $2, $3, 'Tea', $4, '', now() - make_interval(days => $5), now() - make_interval(days => $6)) RETURNING id`, [f.tenant.id, reward.id, index + 1, row.cost, row.createdDaysAgo, row.effectiveDaysAgo]);
    ids.push(result.rows[0].id);
  }
  return { rewardId: reward.id, ids };
}

describe("dated reward changes (ENG-100 S1a)", () => {
  it("keeps the old cost redeemable and shown while a raise waits for its date", async () => {
    const { f, coffee, owner, redeemVersion, merchantRow } = await setup();
    const saved = await editReward({ ...owner, rewardId: coffee.rewardId, cost: 9 });
    expect(saved.effectiveAt).toBeInstanceOf(Date);
    const day = await berlinDay("effective_at", saved.versionId);
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ versionId: coffee.versionId, cost: 8, active: true, endsOn: null, pending: { effectiveOn: day, title: "Coffee", cost: 9 } });
    const counter = await lookupCard({ userId: f.userId, locationId: f.location.id, scanCode: f.member.scanCode });
    if (counter.stage !== "open") throw new Error("open card expected");
    expect(counter.rewards[0]).toMatchObject({ id: coffee.versionId, cost: 8 });
    expect((await getCard(f.member.cardToken)).rewards[0]).toMatchObject({ cost: 8, pending: { effectiveOn: day, cost: 9 } });
    expect((await getPublicProgram(f.program.slug)).rewards[0]).toMatchObject({ cost: 8, pending: { cost: 9 } });
    // Today's code compared against the newest version and refused this with STALE_REWARD until the date.
    await expect(redeemVersion(coffee.versionId)).resolves.toMatchObject({ balance: 12, duplicate: false });
    expect((await db.select().from(redemptions).where(eq(redemptions.membershipId, f.member.id)))[0]).toMatchObject({ rewardVersionId: coffee.versionId, cost: 8 });
  });

  it("puts a raise in force at its date and lets a take-back supersede it for good", async () => {
    const { f, redeemVersion } = await setup();
    const raised = await pastReward(f, [{ cost: 3, createdDaysAgo: 40, effectiveDaysAgo: 40 }, { cost: 5, createdDaysAgo: 30, effectiveDaysAgo: 2 }]);
    expect((await currentRewards(f.tenant.id, f.program.id)).find(row => row.rewardId === raised.rewardId)).toMatchObject({ id: raised.ids[1], cost: 5, pending: null });
    await expect(redeemVersion(raised.ids[0])).rejects.toMatchObject({ code: "STALE_REWARD" });
    await expect(redeemVersion(raised.ids[1])).resolves.toMatchObject({ balance: 15 });
    // v3 copies v1 before v2's date: v2 never comes into force, even after its date.
    const cancelled = await pastReward(f, [{ cost: 3, createdDaysAgo: 40, effectiveDaysAgo: 40 }, { cost: 5, createdDaysAgo: 30, effectiveDaysAgo: 2 }, { cost: 3, createdDaysAgo: 20, effectiveDaysAgo: 20 }]);
    expect((await currentRewards(f.tenant.id, f.program.id)).find(row => row.rewardId === cancelled.rewardId)).toMatchObject({ id: cancelled.ids[2], cost: 3 });
    // v2 (dated a day ago) was superseded by v3 (created before v2's date, dated in 9 days): v1 stays in force past v2's date.
    const skipped = await pastReward(f, [{ cost: 3, createdDaysAgo: 40, effectiveDaysAgo: 40 }, { cost: 4, createdDaysAgo: 30, effectiveDaysAgo: 1 }, { cost: 6, createdDaysAgo: 20, effectiveDaysAgo: -9 }]);
    expect((await currentRewards(f.tenant.id, f.program.id)).find(row => row.rewardId === skipped.rewardId)).toMatchObject({ id: skipped.ids[0], cost: 3, pending: { cost: 6 } });
    await expect(redeemVersion(skipped.ids[1])).rejects.toMatchObject({ code: "STALE_REWARD" });
    const owner = { actorUserId: f.userId, programSlug: f.program.slug };
    expect((await getMerchantRewards(owner)).find(row => row.rewardId === skipped.rewardId)).toMatchObject({ versionId: skipped.ids[0], cost: 3, pending: { cost: 6 } });
    await takeBackRewardChange({ ...owner, rewardId: skipped.rewardId }); // copies the version in force, never the superseded one
    expect((await getMerchantRewards(owner)).find(row => row.rewardId === skipped.rewardId)).toMatchObject({ cost: 3, pending: null });
  });

  it("refuses any other edit while a change waits and takes a raise back at once", async () => {
    const { f, coffee, cake, owner, merchantRow, versions } = await setup();
    await db.insert(walletPasses).values({ tenantId: f.tenant.id, membershipId: f.member.id, provider: "google", providerObjectId: `synthetic.${randomUUID()}` });
    await editReward({ ...owner, rewardId: coffee.rewardId, cost: 9 });
    await pool.query("UPDATE outbox_jobs SET status = 'complete' WHERE kind = 'wallet.refresh'");
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 7 })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    // Back to the cost in force is no undo: only the take-back cancels the raise.
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 8 })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 10 })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, title: "Espresso", worse: false })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    await expect(archiveReward({ ...owner, rewardId: coffee.rewardId })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    expect(await versions(coffee.rewardId)).toBe(2);
    await expect(takeBackRewardChange({ ...owner, rewardId: coffee.rewardId })).resolves.toEqual({ rewardId: coffee.rewardId, takenBack: true });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ version: 3, cost: 8, pending: null });
    // The pass drops the announced raise now, not at the old date.
    expect((await pool.query("SELECT 1 FROM outbox_jobs WHERE kind = 'wallet.refresh' AND status = 'pending' AND payload ->> 'membershipId' = $1", [f.member.id])).rowCount).toBe(1);
    await expect(takeBackRewardChange({ ...owner, rewardId: coffee.rewardId })).resolves.toEqual({ rewardId: coffee.rewardId, takenBack: false });
    // The reward takes edits again; other rewards never waited.
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 7 })).resolves.toMatchObject({ effectiveAt: null });
    await expect(editReward({ ...owner, rewardId: cake.rewardId, cost: 11 })).resolves.toMatchObject({ effectiveAt: null });
  });

  it("keeps an archived reward redeemable until its date, takes the archive back at once and refuses it after the date", async () => {
    const { f, coffee, cake, owner, redeemVersion, merchantRow } = await setup();
    const archived = await archiveReward({ ...owner, rewardId: coffee.rewardId });
    const [{ day }] = (await pool.query<{ day: string }>("SELECT to_char(ends_at AT TIME ZONE 'Europe/Berlin', 'YYYY-MM-DD') AS day FROM rewards WHERE id = $1", [coffee.rewardId])).rows;
    expect(archived.endsAt).toBeInstanceOf(Date);
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ active: true, endsOn: day, pending: null });
    expect((await getCard(f.member.cardToken)).rewards.map(row => [row.title, row.endsOn])).toEqual([["Coffee", day], ["Cake", null]]);
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 7 })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    await expect(archiveReward({ ...owner, rewardId: coffee.rewardId })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    // The one reward not ending is the last active one.
    await expect(archiveReward({ ...owner, rewardId: cake.rewardId })).rejects.toMatchObject({ code: "LAST_ACTIVE_REWARD" });
    await expect(redeemVersion(coffee.versionId)).resolves.toMatchObject({ balance: 12 });

    await expect(takeBackRewardChange({ ...owner, rewardId: coffee.rewardId })).resolves.toMatchObject({ takenBack: true });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ active: true, endsOn: null });
    await archiveReward({ ...owner, rewardId: coffee.rewardId });
    await pool.query("UPDATE rewards SET ends_at = now() - interval '1 second' WHERE id = $1", [coffee.rewardId]); // the date has passed
    await expect(redeemVersion(coffee.versionId)).rejects.toMatchObject({ code: "INVALID_REWARD" });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ active: false, endsOn: null });
    expect((await currentRewards(f.tenant.id, f.program.id)).map(row => row.title)).toEqual(["Cake"]);
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, cost: 7 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(archiveReward({ ...owner, rewardId: cake.rewardId })).rejects.toMatchObject({ code: "LAST_ACTIVE_REWARD" });
  });

  it("needs the owner's choice for a rename and dates what is worse", async () => {
    const { coffee, cake, owner, merchantRow, versions } = await setup();
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, title: "Espresso" })).rejects.toMatchObject({ code: "CHOICE_REQUIRED" });
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, title: "Espresso", cost: 7 })).rejects.toMatchObject({ code: "CHOICE_REQUIRED" });
    expect(await versions(coffee.rewardId)).toBe(1);
    await expect(editReward({ ...owner, rewardId: coffee.rewardId, title: "Espresso", worse: false })).resolves.toMatchObject({ effectiveAt: null });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ title: "Espresso", pending: null });
    await editReward({ ...owner, rewardId: coffee.rewardId, title: "Small espresso", worse: true });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ title: "Espresso", pending: { title: "Small espresso", cost: 8 } });
    // A higher cost dates the rename with it, whatever the choice.
    await editReward({ ...owner, rewardId: cake.rewardId, title: "Big cake", cost: 14, worse: false });
    expect(await merchantRow(cake.rewardId)).toMatchObject({ title: "Cake", cost: 12, pending: { title: "Big cake", cost: 14 } });
  });

  it("dates a rename with a lower cost together when worse and applies both at once when better", async () => {
    const { coffee, cake, owner, merchantRow } = await setup();
    await editReward({ ...owner, rewardId: coffee.rewardId, title: "Filter coffee", cost: 6, worse: true });
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ title: "Coffee", cost: 8, pending: { title: "Filter coffee", cost: 6 } });
    await editReward({ ...owner, rewardId: cake.rewardId, title: "Cake slice", cost: 10, worse: false });
    expect(await merchantRow(cake.rewardId)).toMatchObject({ title: "Cake slice", cost: 10, pending: null });
  });

  it("gives at-once versions created_at = effective_at = the transaction time and dated ones exactly 28 days on", async () => {
    const { coffee, cake, owner } = await setup();
    const now = await editReward({ ...owner, rewardId: cake.rewardId, cost: 10 });
    const dated = await editReward({ ...owner, rewardId: coffee.rewardId, cost: 9 });
    const rows = (await pool.query<{ id: string; same: boolean; notice: boolean }>("SELECT id, created_at = effective_at AS same, effective_at - created_at = interval '28 days' AS notice FROM reward_versions WHERE id = ANY($1)", [[now.versionId, dated.versionId]])).rows;
    expect(rows.find(row => row.id === now.versionId)).toMatchObject({ same: true, notice: false });
    expect(rows.find(row => row.id === dated.versionId)).toMatchObject({ same: false, notice: true });
  });

  it("schedules the Wallet refresh at the date as its own job and never a future wallet.refresh row", async () => {
    const { f, coffee, cake, owner } = await setup();
    await db.insert(walletPasses).values({ tenantId: f.tenant.id, membershipId: f.member.id, provider: "google", providerObjectId: `synthetic.${randomUUID()}` });
    const raise = await editReward({ ...owner, rewardId: coffee.rewardId, cost: 9 });
    const ending = await archiveReward({ ...owner, rewardId: cake.rewardId });
    const jobs = (await pool.query<{ kind: string; payload: Record<string, string>; at: Date; future: boolean }>("SELECT kind, payload, next_attempt_at AS at, next_attempt_at > now() AS future FROM outbox_jobs ORDER BY next_attempt_at")).rows;
    expect(jobs.filter(job => job.kind === "wallet.refresh").map(job => job.future)).toEqual([false]);
    expect(jobs.filter(job => job.kind === "wallet.program_refresh").map(job => [job.payload, job.at.getTime()]))
      .toEqual([[{ programId: f.program.id }, raise.effectiveAt!.getTime()], [{ programId: f.program.id }, ending.endsAt!.getTime()]]);
    // Exact to the microsecond, which a JS Date cannot show: a job a moment early would refresh before the date.
    const exact = await pool.query(`SELECT 1 FROM outbox_jobs j WHERE j.kind = 'wallet.program_refresh'
      AND (j.next_attempt_at = (SELECT effective_at FROM reward_versions WHERE id = $1) OR j.next_attempt_at = (SELECT ends_at FROM rewards WHERE id = $2))`, [raise.versionId, cake.rewardId]);
    expect(exact.rowCount).toBe(2);
    expect((await walletCardSnapshot(f.member.id))).toMatchObject({ pass: { reward: { title: "Coffee", cost: 8, pending: { cost: 9 }, endsOn: null } } });
    // Not due, so the worker leaves it; when it runs, it queues the card's ordinary refresh.
    await pool.query("UPDATE outbox_jobs SET status = 'complete' WHERE kind = 'wallet.refresh'");
    expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toBeNull();
    await pool.query("UPDATE rewards SET ends_at = now() - interval '1 second' WHERE id = $1", [cake.rewardId]); // the archive date has passed
    await expect(runWalletProgramRefresh(db, { tenantId: f.tenant.id, payload: { programId: f.program.id } })).resolves.toEqual({ status: "complete" });
    expect((await pool.query("SELECT 1 FROM outbox_jobs WHERE kind = 'wallet.refresh' AND status = 'pending' AND next_attempt_at <= now()")).rowCount).toBe(1);
    // The ended reward also loses `active`, which is all that code from before ENG-100 reads (a web rollback).
    expect((await db.select({ id: rewards.id, active: rewards.active }).from(rewards).where(eq(rewards.programId, f.program.id))).sort((a, b) => a.id.localeCompare(b.id)))
      .toEqual([{ id: coffee.rewardId, active: true }, { id: cake.rewardId, active: false }].sort((a, b) => a.id.localeCompare(b.id)));
    await expect(runWalletProgramRefresh(db, { tenantId: f.tenant.id, payload: { programId: "nope" } })).resolves.toMatchObject({ status: "failed" });
  });

  it("keeps the new reward paths inside the owner's own shop", async () => {
    const a = await setup();
    const b = await nfcFixture();
    const other = { actorUserId: b.userId, programSlug: b.program.slug };
    await editReward({ ...a.owner, rewardId: a.coffee.rewardId, cost: 9 });
    for (const write of [() => editReward({ ...other, rewardId: a.coffee.rewardId, cost: 7 }), () => takeBackRewardChange({ ...other, rewardId: a.coffee.rewardId }), () => archiveReward({ ...other, rewardId: a.coffee.rewardId })])
      await expect(write()).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(takeBackRewardChange({ actorUserId: b.userId, programSlug: a.f.program.slug, rewardId: a.coffee.rewardId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getMerchantRewards(other)).map(row => [row.title, row.pending])).toEqual([["Coffee", null]]);
    expect(await a.merchantRow(a.coffee.rewardId)).toMatchObject({ pending: { cost: 9 } });
    // The other shop's live reward never counts as A's last one.
    await takeBackRewardChange({ ...a.owner, rewardId: a.coffee.rewardId });
    await archiveReward({ ...a.owner, rewardId: a.coffee.rewardId });
    await expect(archiveReward({ ...a.owner, rewardId: a.cake.rewardId })).rejects.toMatchObject({ code: "LAST_ACTIVE_REWARD" });
  });

  it("names the calendar day in the shop's timezone, not UTC", async () => {
    const { coffee, cake, merchantRow } = await setup();
    // 23:30 UTC is already the next day in Berlin.
    await pool.query("UPDATE rewards SET ends_at = '2099-11-24 23:30:00+00' WHERE id = $1", [coffee.rewardId]);
    await pool.query(`INSERT INTO reward_versions (tenant_id, reward_id, version, title, cost, terms_text, effective_at)
      SELECT tenant_id, reward_id, 2, title, 13, terms_text, '2099-11-24 23:30:00+00' FROM reward_versions WHERE id = $1`, [cake.versionId]);
    expect(await merchantRow(coffee.rewardId)).toMatchObject({ endsOn: "2099-11-25" });
    expect(await merchantRow(cake.rewardId)).toMatchObject({ pending: { effectiveOn: "2099-11-25", cost: 13 } });
  });

  it("leaves an ended reward out of the owner and automation readers and uses the cost in force", async () => {
    const { f, coffee, owner } = await setup(); // Coffee 8, Cake 12, the card at 20
    const tea = await createReward({ ...owner, title: "Tea", cost: 3 });
    await pool.query("UPDATE rewards SET sort_order = sort_order + 1 WHERE program_id = $1", [f.program.id]);
    await pool.query("UPDATE rewards SET ends_at = now() - interval '1 second', sort_order = 0 WHERE id = $1", [tea.rewardId]); // ended, and first
    await editReward({ ...owner, rewardId: coffee.rewardId, cost: 9 }); // waits for its date
    const card = async (balance: number) => {
      const [member] = await db.insert(memberships).values({ tenantId: f.tenant.id, programId: f.program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "").slice(0, 8)}` }).returning();
      await award({ userId: f.userId, locationId: f.location.id, membershipId: member.id, quantity: balance, idempotencyKey: randomUUID(), requestId: randomUUID() });
      return member.id;
    };
    const five = await card(5), two = await card(2); // ready and 1 away only if the ended Tea (3) counted
    const sorted = (ids: string[]) => [...ids].sort();
    const scope = { tenantId: f.tenant.id, programId: f.program.id };

    expect((await getLaunchReadiness(f.userId, f.location.id)).steps.find(step => step.id === "programme")?.evidence).toMatch(/ 8 \S+ → Coffee$/);
    expect((await getMerchantMember(f.userId, f.member.id)).eligibleRewards.map(row => [row.title, row.cost])).toEqual([["Coffee", 8], ["Cake", 12]]);
    expect(await getRetentionSummary(f.userId)).toMatchObject({ rewardReady: 1, nearRewardId: coffee.rewardId, nearRewardMaxRemaining: 2 });
    expect(await rewardReadyMemberships(db, scope, new Date())).toEqual([f.member.id]);
    const close = async (maxRemaining: number) => sorted((await selectAudience({ actorUserId: f.userId, programId: f.program.id, definition: { kind: "close_to_reward", maxRemaining } })).membershipIds);
    expect(await close(6)).toEqual(sorted([five, two])); // 8 - 2 = 6: the cost in force, not the raise
    expect(await close(2)).toEqual([]);
  });
});
