import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@/db";
import { award } from "./loyalty";
import { getCustomerExport } from "./export";
import { walletCardSnapshot } from "./wallet/data";
import { createMerchant, enroll, getCard, getPublicProgram, lookupCard, takeBackRuleChange, updateProgram, updateProgramExtras } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function shop(earning: { earningMode: "manual" | "purchase"; pointsPerCurrencyUnit?: number; rulesText: string }) {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const m = await createMerchant({ userId: owner, businessName: "Synthetic Pizzeria", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Pizzakarte", programType: "points", rewardTitle: "Pizza", rewardCost: 100, ...earning });
  const card = await enroll({ slug: m.programSlug, acceptedTerms: true });
  const save = (fields: Record<string, unknown>) => updateProgram({ actorUserId: owner, programSlug: m.programSlug, ...fields });
  const expiry = (months: 24 | 36 | null) => updateProgramExtras({ actorUserId: owner, programId: m.programId, pointsExpiryMonths: months });
  return { ...m, owner, card, save, expiry };
}
type Shop = Awaited<ReturnType<typeof shop>>;
/** Moves the programme 29 days into the future of its saves: every version and the expiry start shift back together. */
const passDate = async (s: Shop) => {
  const client = await pool.connect();
  try {
    // Rule versions are append-only; the trigger is off only inside this transaction, so no other test ever sees it off.
    await client.query("BEGIN");
    await client.query("ALTER TABLE program_rule_versions DISABLE TRIGGER program_rule_versions_append_only");
    await client.query("UPDATE program_rule_versions SET created_at = created_at - interval '29 days', effective_at = effective_at - interval '29 days' WHERE program_id = $1", [s.programId]);
    await client.query("ALTER TABLE program_rule_versions ENABLE TRIGGER program_rule_versions_append_only");
    await client.query("UPDATE programs SET points_expiry_since = points_expiry_since - interval '29 days' WHERE id = $1", [s.programId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
};
const counter = (s: Shop) => lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: s.card.scanCode });
const buy = async (s: Shop, euros: number) => {
  const open = await counter(s);
  return award({ userId: s.owner, locationId: s.locationId, membershipId: s.card.id, purchaseAmountMinor: euros * 100, ruleVersionId: open.ruleVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
};
const versions = async (s: Shop) => (await pool.query("SELECT version, earning_mode, points_per_currency_unit AS rate, created_at = effective_at AS now, effective_at - created_at = interval '28 days' AS dated FROM program_rule_versions WHERE program_id = $1 AND version > 1 ORDER BY version", [s.programId])).rows; // v1 comes from the setup

describe("dated rule changes (ENG-100 S1b)", () => {
  it("dates a lower rate: the counter books the old rate until the date while the card announces the new one", async () => {
    const s = await shop({ earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" });
    const saved = await s.save({ pointsPerCurrencyUnit: 1 });
    expect(saved.effectiveAt).toBeInstanceOf(Date);
    expect(await counter(s)).toMatchObject({ pointsPerCurrencyUnit: 2 });
    expect(await buy(s, 5)).toMatchObject({ balance: 10 });
    expect(await getCard(s.card.cardToken)).toMatchObject({ pending: { pointsPerCurrencyUnit: 1, old: { pointsPerCurrencyUnit: 2 } } });
    expect((await getPublicProgram(s.programSlug)).pending).toMatchObject({ pointsPerCurrencyUnit: 1 });
    await passDate(s);
    expect(await counter(s)).toMatchObject({ pointsPerCurrencyUnit: 1 });
    expect(await buy(s, 5)).toMatchObject({ balance: 15 });
    expect(await getCard(s.card.cardToken)).toMatchObject({ pending: null });
    // A higher rate applies at once.
    await s.save({ pointsPerCurrencyUnit: 3 });
    expect(await counter(s)).toMatchObject({ pointsPerCurrencyUnit: 3 });
  });

  it.each([
    ["purchase → manual", { earningMode: "purchase" as const, pointsPerCurrencyUnit: 2, rulesText: "" }, { earningMode: "manual", rulesText: "10 Punkte pro Pizza." }],
    ["manual → purchase", { earningMode: "manual" as const, rulesText: "10 Punkte pro Pizza." }, { earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" }],
  ])("asks the owner about a mode switch (%s) and keeps the counter in the old mode until a worse one's date", async (_, from, to) => {
    const s = await shop(from);
    await expect(s.save(to)).rejects.toMatchObject({ code: "CHOICE_REQUIRED" });
    await s.save({ ...to, worse: true });
    expect(await counter(s)).toMatchObject({ earningMode: from.earningMode });
    expect((await getCard(s.card.cardToken)).pending).toMatchObject({ earningMode: to.earningMode, old: { earningMode: from.earningMode } });
    await passDate(s);
    expect(await counter(s)).toMatchObject({ earningMode: to.earningMode });
  });

  it("applies a better rules text at once, refuses other edits while a change waits, and takes it back", async () => {
    const s = await shop({ earningMode: "manual", rulesText: "10 Punkte pro Pizza." });
    await expect(s.save({ rulesText: "12 Punkte pro Pizza." })).rejects.toMatchObject({ code: "CHOICE_REQUIRED" });
    expect(await s.save({ rulesText: "12 Punkte pro Pizza.", worse: false })).toMatchObject({ effectiveAt: null });
    await s.save({ rulesText: "5 Punkte pro Pizza.", worse: true });
    await expect(s.save({ rulesText: "8 Punkte pro Pizza.", worse: false })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    expect((await getCard(s.card.cardToken))).toMatchObject({ rulesText: "12 Punkte pro Pizza.", pending: { rulesText: "5 Punkte pro Pizza." } });
    // The export (Art. 15) and the Wallet pass name the rule in force; the pass carries the waiting one as data.
    expect((await getCustomerExport(s.card.cardToken)).program.rulesText).toBe("12 Punkte pro Pizza.");
    const wallet = await walletCardSnapshot(s.card.id);
    expect(wallet.open && wallet.pass).toMatchObject({ rules: expect.arrayContaining([expect.stringContaining("12 Punkte pro Pizza.")]), pending: { rulesText: "5 Punkte pro Pizza." } });
    // The pass back opens with the dated line, the whole new rule quoted (W46), then the rule in force.
    expect(wallet.open && wallet.pass.rules?.slice(0, 2)).toEqual([expect.stringMatching(/^Ab \d+\.\d+\. gilt: 5 Punkte pro Pizza\. Bis dahin bleibt es bei der bisherigen Regel\.$/), "12 Punkte pro Pizza."]);
    await expect(takeBackRuleChange({ actorUserId: s.owner, programSlug: s.programSlug })).resolves.toEqual({ takenBack: true });
    expect((await getCard(s.card.cardToken))).toMatchObject({ rulesText: "12 Punkte pro Pizza.", pending: null });
    await passDate(s); // the taken-back version never comes into force
    expect((await getCard(s.card.cardToken))).toMatchObject({ rulesText: "12 Punkte pro Pizza.", pending: null });
    await expect(s.save({ rulesText: "8 Punkte pro Pizza.", worse: false })).resolves.toMatchObject({ effectiveAt: null });
  });

  it("carries a programme rename into both the version in force and the waiting one, created at one instant", async () => {
    const s = await shop({ earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" });
    await s.save({ pointsPerCurrencyUnit: 1 });
    await s.save({ name: "Pizzapass" });
    expect((await getCard(s.card.cardToken))).toMatchObject({ programName: "Pizzapass", pending: { pointsPerCurrencyUnit: 1 } });
    expect(await versions(s)).toEqual([
      { version: 2, earning_mode: "purchase", rate: 1, now: false, dated: true },
      { version: 3, earning_mode: "purchase", rate: 2, now: true, dated: false },
      { version: 4, earning_mode: "purchase", rate: 1, now: false, dated: false }, // keeps v2's date
    ]);
    await passDate(s);
    expect(await getCard(s.card.cardToken)).toMatchObject({ programName: "Pizzapass", pending: null });
    expect(await counter(s)).toMatchObject({ pointsPerCurrencyUnit: 1 });
  });

  it("refuses a join that showed an older rule or reward list, and takes one that showed the newest", async () => {
    const s = await shop({ earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" });
    const shown = await getPublicProgram(s.programSlug);
    await s.save({ pointsPerCurrencyUnit: 1 });
    const join = (page: { ruleVersionId?: string; rewardVersionIds: string[] }) => enroll({ slug: s.programSlug, acceptedTerms: true, ruleVersionId: page.ruleVersionId, rewardVersionIds: page.rewardVersionIds });
    await expect(join(shown)).rejects.toMatchObject({ code: "STALE_RULE" });
    await expect(join({ ...(await getPublicProgram(s.programSlug)), rewardVersionIds: [] })).rejects.toMatchObject({ code: "STALE_RULE" });
    await expect(join(await getPublicProgram(s.programSlug))).resolves.toMatchObject({ programId: s.programId });
  });

  it("makes a join wait for an owner save in progress and then refuses it as stale (D7 lock order)", async () => {
    const s = await shop({ earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" });
    const page = await getPublicProgram(s.programSlug);
    const gate = await pool.connect();
    let join: Promise<unknown> | undefined;
    try {
      // An owner save holds the programme row and has written a dated rate cut, not yet committed.
      await gate.query("BEGIN");
      await gate.query("SELECT 1 FROM programs WHERE id = $1 FOR UPDATE", [s.programId]);
      await gate.query(`INSERT INTO program_rule_versions (tenant_id, program_id, version, name, type, rules_text, earning_mode, points_per_currency_unit, effective_at)
        SELECT tenant_id, program_id, version + 1, name, type, rules_text, earning_mode, 1, now() + interval '28 days' FROM program_rule_versions WHERE program_id = $1 ORDER BY version DESC LIMIT 1`, [s.programId]);
      join = enroll({ slug: s.programSlug, acceptedTerms: true, ruleVersionId: page.ruleVersionId, rewardVersionIds: page.rewardVersionIds }).then(value => ({ value }), error => ({ error }));
      let waiting = false;
      for (let i = 0; i < 200 && !waiting; i++) {
        waiting = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from \"programs\"%'")).rowCount! > 0;
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
      }
      expect(waiting, "the join must wait on the programme row").toBe(true);
      await gate.query("COMMIT");
      expect(await join).toMatchObject({ error: { code: "STALE_RULE" } });
    } finally { await gate.query("ROLLBACK"); await join; gate.release(); }
  });
});

describe("dated expiry (ENG-100 S1b, Legal and Product)", () => {
  const since = async (s: Shop) => (await pool.query<{ since: Date | null }>("SELECT points_expiry_since AS since FROM programs WHERE id = $1", [s.programId])).rows[0].since;
  const expiryVersions = async (s: Shop) => (await pool.query("SELECT points_expiry_months AS months, effective_at - created_at = interval '28 days' AS dated FROM program_rule_versions WHERE program_id = $1 ORDER BY version", [s.programId])).rows;

  it("dates a switch-on, writes a version for every at-once change, and never moves since earlier", async () => {
    const s = await shop({ earningMode: "manual", rulesText: "10 Punkte pro Pizza." });
    await s.expiry(36);
    const first = (await since(s))!;
    expect(first.getTime()).toBeGreaterThan(Date.now() + 27 * 86_400_000);
    expect((await getCard(s.card.cardToken)).pendingExpiry).toMatchObject({ months: 36, before: null });
    // Until the date the join page and the card state no expiry rule: none is in force.
    expect((await getPublicProgram(s.programSlug)).pointsExpiryRule).toBeUndefined();
    expect((await getCard(s.card.cardToken)).pointsExpiry).toBeUndefined();
    await passDate(s);
    const started = (await since(s))!;
    await s.expiry(null); // off: at once, recorded
    await s.expiry(36); // on again: dated, after the first start
    expect((await since(s))!.getTime()).toBeGreaterThan(started.getTime());
    expect(await expiryVersions(s)).toEqual([{ months: null, dated: false }, { months: 36, dated: true }, { months: null, dated: false }, { months: 36, dated: true }]);
  });

  it("applies a longer period at once with a version, and refuses to take back a shortening while a switch-on can be", async () => {
    const s = await shop({ earningMode: "manual", rulesText: "10 Punkte pro Pizza." });
    await s.expiry(24);
    await expect(takeBackRuleChange({ actorUserId: s.owner, programSlug: s.programSlug })).resolves.toEqual({ takenBack: true });
    expect(await since(s)).toBeNull();
    await s.expiry(24);
    await passDate(s);
    const start = (await since(s))!;
    await s.expiry(36); // longer: at once, never earlier
    expect((await since(s))!.getTime()).toBeGreaterThanOrEqual(start.getTime());
    await award({ userId: s.owner, locationId: s.locationId, membershipId: s.card.id, quantity: 10, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getCard(s.card.cardToken)).pointsExpiry?.batches).toHaveLength(1);
    await s.expiry(24); // shorter: dated and final
    expect((await getPublicProgram(s.programSlug)).pendingExpiry).toMatchObject({ months: 24, before: 36 });
    // Product (a): points earned before the new start never expire, so the card drops their date at once.
    expect((await getCard(s.card.cardToken)).pointsExpiry?.batches).toEqual([]);
    await expect(takeBackRuleChange({ actorUserId: s.owner, programSlug: s.programSlug })).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    await expect(s.expiry(null)).rejects.toMatchObject({ code: "CHANGE_PENDING" });
    expect((await expiryVersions(s)).slice(-2)).toEqual([{ months: 36, dated: false }, { months: 24, dated: true }]);
  });
});
