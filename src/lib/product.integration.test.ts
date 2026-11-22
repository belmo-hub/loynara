import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { consentEvents, ledgerEntries, locations, membershipContacts, programRuleVersions, programs, rewardVersions, staffRoles, subscriptions } from "@/db/schema";
import { archiveReward, createMerchant, createReward, editReward, enroll, getCard, getMerchantContext, getMerchantRewards, getPublicProgram, lookupCard, reorderRewards, updateProgram } from "./product";
import { award } from "./loyalty";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
/** The request schemas' 10-character refusal of a rule (400 Invalid input). */
const SHORT_RULE = { issues: [{ path: ["rulesText"], code: "too_small" }] };

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function createUser() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}

describe("merchant and customer journey", () => {
  it("refuses an account that may not set up a shop before it decodes the logo", async () => {
    const userId = await createUser();
    const setup = { userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10, logoData: "not-a-logo" } as const;
    await expect(createMerchant(setup, { newShop: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // A shop owner's own setup still checks the logo.
    await expect(createMerchant(setup)).rejects.toMatchObject({ code: "INVALID_LOGO" });
  });
  it("persists a merchant, its first location, program, and owner assignment", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    expect(merchant).toMatchObject({ city: "Kassel", programType: "stamp" });
    const roles = await db.select().from(staffRoles).where(eq(staffRoles.userId, userId));
    expect(roles).toMatchObject([{ tenantId: merchant.tenantId, role: "owner", active: true, locationId: null, userId, createdAt: expect.any(Date) }]);
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, merchant.tenantId));
    expect(subscription).toMatchObject({ status: "manual_pending", currency: "EUR", priceMinor: 4900 });
  });

  it("refuses a first reward that advertises tobacco, with the Wallet message line, and saves nothing", async () => {
    const userId = await createUser();
    await expect(createMerchant({ userId, businessName: "Synthetic Kiosk", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kioskkarte", programType: "stamp", rulesText: "Ein Stempel pro Einkauf.", rewardTitle: "E-Zigarette gratis", rewardCost: 8 }))
      .rejects.toMatchObject({ code: "MESSAGE_REFUSED", message: "Werbung für Tabak und E-Zigaretten ist nicht erlaubt." });
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, userId))).toEqual([]);
  });
  it("sets up German shops only (ENG-328) and saves nothing for another country", async () => {
    const userId = await createUser();
    const moroccan = { userId, businessName: "Synthetic Riad", city: "Rabat", country: "MA", timezone: "Africa/Casablanca", locale: "de", currency: "MAD", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Einkauf.", rewardTitle: "Tee gratis", rewardCost: 8 };
    await expect(createMerchant(moroccan as unknown as Parameters<typeof createMerchant>[0])).rejects.toThrow();
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, userId))).toEqual([]);
  });

  it("stores the configured draft EUR price shown on the homepage", async () => {
    const previous = process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR;
    process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR = "5900";
    try {
      const userId = await createUser();
      const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
      const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, merchant.tenantId));
      expect(subscription.priceMinor).toBe(5900);
    } finally {
      if (previous === undefined) delete process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR;
      else process.env.NEXT_PUBLIC_DRAFT_EUR_PRICE_MINOR = previous;
    }
  });

  it("returns one completed merchant for concurrent onboarding retries", async () => {
    const userId = await createUser();
    const input = { userId, businessName: "Synthetic Café", city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, programName: "Kaffeekarte", programType: "stamp" as const, rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 };
    const outcomes = await Promise.all([createMerchant(input), createMerchant(input)]);
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, userId))).toHaveLength(1);
  });

  it("enrolls without an email and exposes a contact-free browser card", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const membership = await enroll({ slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false });
    const card = await getCard(membership.cardToken);
    expect(card).toMatchObject({ scanCode: membership.scanCode, balance: 0, merchantName: "Synthetic Café", programType: "stamp" });
    expect(JSON.stringify(card)).not.toContain("email");
    expect(membership.scanCode).not.toContain(membership.cardToken);
    expect(await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, membership.id))).toHaveLength(0);
    expect(await db.select().from(consentEvents).where(eq(consentEvents.membershipId, membership.id))).toHaveLength(0);
  });

  it("records separately chosen marketing consent without showing email at checkout", async () => {
    const userId = await createUser();
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "kunde@example.test", marketingOptIn: true });
    const [contact] = await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, member.id));
    expect(contact.email).toBe("kunde@example.test");
    expect(await db.select().from(consentEvents).where(eq(consentEvents.membershipId, member.id))).toMatchObject([{ channel: "email", purpose: "marketing", granted: true }]);
    const checkout = await lookupCard({ userId, locationId: merchant.locationId, scanCode: member.scanCode });
    expect(checkout).toMatchObject({ membershipId: member.id, balance: 0 });
    expect(JSON.stringify(checkout)).not.toContain("kunde@example.test");
  });

  it("stores validated branding and hides owner reports from a cashier", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8, brandColor: "#32634d", contactEmail: "owner@example.test" });
    const [location] = await db.select().from(locations).where(eq(locations.id, merchant.locationId));
    expect(location).toMatchObject({ name: "Kassel Mitte", brandColor: "#32634d", contactEmail: "owner@example.test" });
    const cashierId = await createUser();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashierId, role: "cashier", locationId: merchant.locationId });
    const cashier = await getMerchantContext(cashierId);
    expect(cashier).toMatchObject({ role: "cashier", locationId: merchant.locationId });
    expect(cashier?.stats).toBeUndefined();
    expect(cashier?.activity).toBeUndefined();
    const owner = await getMerchantContext(ownerId);
    expect(owner?.stats).toMatchObject({ members: 0, awards: 0, redemptions: 0 });
  });

  it("versions reward changes and locks program units after the first transaction", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
    const updated = await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee, maximal einmal je Kauf.", programType: "points" });
    expect(updated.programType).toBe("points");
    const [reward] = await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug });
    await editReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: reward.rewardId, title: "Cappuccino gratis", cost: 9, termsText: "", worse: false }); // a raise: dated, still a version
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: ownerId, locationId: merchant.locationId, membershipId: member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await expect(updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee, maximal einmal je Kauf.", programType: "stamp" })).rejects.toMatchObject({ code: "TYPE_LOCKED" });
    expect(await db.select().from(rewardVersions)).toHaveLength(2);
    expect(await db.select().from(ledgerEntries)).toHaveLength(1);
  });

  it("stores purchase earning mode and versions rate changes without rewriting the old rule", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "Drei Punkte je vollem Euro Kaufbetrag.", rewardTitle: "Kaffee gratis", rewardCost: 30 });
    const first = await getPublicProgram(merchant.programSlug);
    expect(first).toMatchObject({ earningMode: "purchase", pointsPerCurrencyUnit: 3, currency: "EUR", rewards: [{ title: "Kaffee gratis", cost: 30 }] });
    const changed = await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 4, rulesText: "Vier Punkte je vollem Euro Kaufbetrag.", worse: false });
    expect(changed.ruleVersion).toBe(2);
    const versions = await db.select().from(programRuleVersions);
    expect(versions.map(row => [row.version, row.pointsPerCurrencyUnit, row.rulesText])).toEqual([
      [1, 3, "Drei Punkte je vollem Euro Kaufbetrag."],
      [2, 4, "Vier Punkte je vollem Euro Kaufbetrag."],
    ]);
  });

  it("changes only the fields a Programm question sends, each change as a new rule version (ENG-099 N-3)", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Barber", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je vollem Euro.", rewardTitle: "Haarwäsche gratis", rewardCost: 100 });
    const update = (fields: Record<string, unknown>) => updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, ...fields });
    expect((await update({ pointsPerCurrencyUnit: 2 })).ruleVersion).toBe(2);
    expect((await update({ rulesText: "Zwei Punkte je vollem Euro.", worse: false })).ruleVersion).toBe(3);
    expect((await update({ name: "Barbierkarte" })).ruleVersion).toBe(4);
    expect((await update({ name: "Barbierkarte" })).ruleVersion).toBe(4); // nothing changed, no version
    const versions = await db.select().from(programRuleVersions).orderBy(programRuleVersions.version);
    expect(versions.map(row => [row.version, row.name, row.earningMode, row.pointsPerCurrencyUnit, row.rulesText])).toEqual([
      [1, "Punktekarte", "purchase", 1, "Ein Punkt je vollem Euro."],
      [2, "Punktekarte", "purchase", 2, "Ein Punkt je vollem Euro."],
      [3, "Punktekarte", "purchase", 2, "Zwei Punkte je vollem Euro."],
      [4, "Barbierkarte", "purchase", 2, "Zwei Punkte je vollem Euro."],
    ]);
  });

  it("asks only for extra rules where points come from the purchase amount, and shows the earning sentence first (ENG-099 3c)", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Pizzeria", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rulesText: "", rewardTitle: "Pizza gratis", rewardCost: 100 });
    const update = (fields: Record<string, unknown>) => updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, ...fields });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    // The card and the sign-up page say the same.
    const shown = async () => { const texts = [(await getCard(card.cardToken)).rulesText, (await getPublicProgram(merchant.programSlug)).rulesText]; expect(texts[0]).toBe(texts[1]); return texts[0]; };
    expect(await shown()).toBe("3 Punkte pro 1 € Einkaufswert, abgerundet auf ganze Punkte.");
    await update({ rulesText: "Nur Mo–Fr", worse: false });
    expect(await shown()).toBe("3 Punkte pro 1 € Einkaufswert, abgerundet auf ganze Punkte.\n\nNur Mo–Fr");
    expect((await getPublicProgram(merchant.programSlug)).ownerRulesText).toBe("Nur Mo–Fr");
    await update({ rulesText: "", pointsPerCurrencyUnit: 4, worse: false }); // a raise: at once (a cut is dated, ENG-100)
    expect(await shown()).toBe("4 Punkte pro 1 € Einkaufswert, abgerundet auf ganze Punkte.");
    // Out of it the owner's own rule is needed again: the stored empty text is refused, a short one too (W35).
    await expect(update({ earningMode: "manual" })).rejects.toMatchObject(SHORT_RULE);
    await expect(update({ earningMode: "manual", rulesText: "Zu kurz." })).rejects.toMatchObject(SHORT_RULE);
    await update({ earningMode: "manual", rulesText: "10 Punkte pro Pizza.", worse: false });
    expect(await shown()).toBe("10 Punkte pro Pizza.");
    await expect(update({ rulesText: "Zu kurz." })).rejects.toMatchObject(SHORT_RULE);
    await update({ earningMode: "purchase", rulesText: "", worse: false }); // 34: the sentence replaces the rule
    const versions = await db.select().from(programRuleVersions).orderBy(programRuleVersions.version);
    expect(versions.map(row => [row.version, row.earningMode, row.pointsPerCurrencyUnit, row.rulesText])).toEqual([
      [1, "purchase", 3, ""], [2, "purchase", 3, "Nur Mo–Fr"], [3, "purchase", 4, ""], [4, "manual", 4, "10 Punkte pro Pizza."], [5, "purchase", 4, ""],
    ]);
  });

  it("still asks stamps and manual points for a rule of 10 characters at setup (ENG-099 3c)", async () => {
    const userId = await createUser();
    const shop = { userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Zu kurz.", rewardTitle: "Kaffee gratis", rewardCost: 8 } as const;
    await expect(createMerchant(shop)).rejects.toMatchObject(SHORT_RULE);
    await expect(createMerchant({ ...shop, programType: "points", earningMode: "manual", rulesText: "" })).rejects.toMatchObject(SHORT_RULE);
    await expect(createMerchant({ ...shop, programType: "points", rulesText: "" })).rejects.toMatchObject(SHORT_RULE); // points start manual unless set
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, userId))).toHaveLength(0);
  });

  it("never backdates a programme: a start date that has begun counts from setup, a later one stays (Legal, ENG-099 3c)", async () => {
    const shop = async (effectiveDate: string) => {
      const { programId } = await createMerchant({ userId: await createUser(), businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8, effectiveDate });
      const [program] = await db.select({ at: programs.effectiveAt }).from(programs).where(eq(programs.id, programId));
      const [rule] = await db.select({ at: programRuleVersions.effectiveAt }).from(programRuleVersions).where(eq(programRuleVersions.programId, programId));
      expect(rule.at).toEqual(program.at);
      return program.at.getTime();
    };
    const before = Date.now() - 1000; // the database clock may trail this process slightly
    expect(await shop("2026-01-01")).toBeGreaterThanOrEqual(before);
    expect(await shop(new Date().toISOString().slice(0, 10))).toBeGreaterThanOrEqual(before);
    expect(await shop("2099-01-01")).toBe(Date.UTC(2099, 0, 1));
  });

  it("lets only the owner create, version, order, and archive rewards while retaining one active option", async () => {
    const ownerId = await createUser();
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kauf.", rewardTitle: "Kaffee", rewardCost: 8 });
    const cashierId = await createUser();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashierId, role: "cashier", locationId: merchant.locationId });
    await expect(createReward({ actorUserId: cashierId, programSlug: merchant.programSlug, title: "Kuchen", cost: 12, termsText: "Ein Stück" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await createReward({ actorUserId: ownerId, programSlug: merchant.programSlug, title: "Kuchen", cost: 12, termsText: "Ein Stück" });
    const initial = await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug });
    expect(initial).toHaveLength(2);
    await editReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: created.rewardId, title: "Torte", cost: 10, termsText: "Ein Stück Torte", worse: false }); // lower and better: at once
    expect((await db.select().from(rewardVersions)).filter(row => row.rewardId === created.rewardId).map(row => row.version)).toEqual([1, 2]);
    // Stored conditions stay in the owner's list only; the join page, the card and the till get none (ENG-115).
    expect((await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug })).find(row => row.rewardId === created.rewardId)?.termsText).toBe("Ein Stück Torte");
    const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const payloads = [(await getPublicProgram(merchant.programSlug)).rewards, (await getCard(member.cardToken)).rewards, (await lookupCard({ userId: ownerId, locationId: merchant.locationId, scanCode: member.scanCode })).rewards];
    for (const rewards of payloads) expect(rewards.map(row => Object.keys(row).sort())).toEqual([["cost", "endsOn", "id", "pending", "rewardId", "sortOrder", "title"], ["cost", "endsOn", "id", "pending", "rewardId", "sortOrder", "title"]]);
    await reorderRewards({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardIds: [created.rewardId, initial[0].rewardId] });
    expect((await getPublicProgram(merchant.programSlug)).rewards.map(row => row.title)).toEqual(["Torte", "Kaffee"]);
    await updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch.", worse: false });
    expect(await db.select().from(rewardVersions)).toHaveLength(3);
    await archiveReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: created.rewardId });
    // ENG-100: the archive is dated; the reward stays on the join page with its end date until then.
    expect((await getPublicProgram(merchant.programSlug)).rewards.map(row => [row.title, row.endsOn !== null])).toEqual([["Torte", true], ["Kaffee", false]]);
    await expect(archiveReward({ actorUserId: ownerId, programSlug: merchant.programSlug, rewardId: initial[0].rewardId })).rejects.toMatchObject({ code: "LAST_ACTIVE_REWARD" });
    expect((await getMerchantRewards({ actorUserId: ownerId, programSlug: merchant.programSlug })).map(row => [row.active, row.endsOn !== null])).toEqual([[true, true], [true, false]]);
  });
});

// ENG-100 (Legal): the type is locked once the programme has any card or the location any booking, so no booked value
// changes its unit and nobody's card changes kind. The join and the save take the programme row in the same order (D7).
it("locks the programme type once a card exists, and once the location has a booking", async () => {
  const ownerId = await createUser();
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", rulesText: "Ein Punkt pro Euro.", rewardTitle: "Kaffee", rewardCost: 10 });
  const toStamps = () => updateProgram({ actorUserId: ownerId, programSlug: merchant.programSlug, name: "Punktekarte", rulesText: "Ein Stempel pro Besuch.", programType: "stamp" });
  // A booking at the location (here on an earlier, ended programme) with no card on this one.
  const { rows: [old] } = await pool.query<{ id: string }>("INSERT INTO programs (tenant_id, location_id, slug, name, type, rules_text, status) VALUES ($1, $2, $3, 'Alt', 'stamp', 'Ein Stempel pro Besuch.', 'ended') RETURNING id", [merchant.tenantId, merchant.locationId, `old-${randomUUID()}`]);
  const { rows: [card] } = await pool.query<{ id: string }>("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token) VALUES ($1, $2, $3, $4) RETURNING id", [merchant.tenantId, old.id, `sc_${randomUUID()}`, `card_${randomUUID()}`]);
  await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key) VALUES ($1, $2, $3, 1, 'award', 'staff_online', $4, gen_random_uuid(), $5)", [merchant.tenantId, merchant.locationId, card.id, ownerId, randomUUID()]);
  await expect(toStamps()).rejects.toMatchObject({ code: "TYPE_LOCKED" });
  // A card alone, before any booking: a fresh shop with one join.
  const other = await createUser();
  const shop = await createMerchant({ userId: other, businessName: "Synthetic Bar", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: "points", rulesText: "Ein Punkt pro Euro.", rewardTitle: "Kaffee", rewardCost: 10 });
  await enroll({ slug: shop.programSlug, acceptedTerms: true });
  await expect(updateProgram({ actorUserId: other, programSlug: shop.programSlug, name: "Punktekarte", rulesText: "Ein Stempel pro Besuch.", programType: "stamp" })).rejects.toMatchObject({ code: "TYPE_LOCKED" });
  expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, shop.tenantId))).toEqual([]);
});
