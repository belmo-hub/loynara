import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, staffRoles } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { LOCATOR_ALPHABET } from "./card-locator";
import { createAdditionalLocation } from "./locations";
import { getMerchantMember, listMerchantMembers } from "./merchant-members";
import { createMerchant, enroll, getCard, lookupCard, previewCardLocator } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const SHAPE = new RegExp(`^[${LOCATOR_ALPHABET}]{6}$`);
let originalGenerator: string | null = null;

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user" CASCADE'); });
afterEach(async () => { await restoreGenerator(); });
afterAll(async () => { await restoreGenerator(); await pool.end(); });

/**
 * Forces specific "random" draws so collisions are reproducible. The real generator is saved first and always restored.
 * After the script runs out, the last value repeats (which is how exhaustion is provoked).
 */
async function scriptGenerator(values: string[]) {
  if (originalGenerator === null) originalGenerator = (await pool.query<{ def: string }>("SELECT pg_get_functiondef('card_locator_candidate'::regproc) AS def")).rows[0].def;
  await pool.query("DROP TABLE IF EXISTS locator_script");
  await pool.query("CREATE TABLE locator_script (pos serial PRIMARY KEY, value text NOT NULL, used boolean NOT NULL DEFAULT false)");
  for (const value of values) await pool.query("INSERT INTO locator_script (value) VALUES ($1)", [value]);
  await pool.query(`CREATE OR REPLACE FUNCTION card_locator_candidate() RETURNS text AS $$
    DECLARE picked text;
    BEGIN
      UPDATE locator_script SET used = true WHERE pos = (SELECT min(pos) FROM locator_script WHERE NOT used) RETURNING value INTO picked;
      IF picked IS NULL THEN SELECT value INTO picked FROM locator_script ORDER BY pos DESC LIMIT 1; END IF;
      RETURN picked;
    END; $$ LANGUAGE plpgsql`);
}
async function restoreGenerator() {
  if (originalGenerator === null) return;
  await pool.query(originalGenerator);
  await pool.query("DROP TABLE IF EXISTS locator_script");
  originalGenerator = null;
}

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, businessName: string) => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });
const locatorOf = async (membershipId: string) => (await db.select({ l: memberships.cardLocator }).from(memberships).where(eq(memberships.id, membershipId)))[0].l;
const base31 = (n: number) => { let out = ""; for (let i = 0; i < 6; i++) { out = LOCATOR_ALPHABET[n % 31] + out; n = Math.floor(n / 31); } return out; };

describe("generated locators", () => {
  it("are six unambiguous characters, shown as K-XXXXXX on the customer card", async () => {
    const a = await shop(await user(), "Synthetic A");
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const locator = await locatorOf(card.id);
    expect(locator).toMatch(SHAPE);
    expect((await getCard(card.cardToken)).cardLocator).toBe(`K-${locator}`);
  });

  it("are random rather than sequential and unique within a tenant", async () => {
    const a = await shop(await user(), "Synthetic Spread");
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) ids.push((await enroll({ slug: a.programSlug, acceptedTerms: true })).id);
    const locators = await Promise.all(ids.map(locatorOf));
    expect(new Set(locators).size).toBe(40);
    expect(locators.every(value => SHAPE.test(value))).toBe(true);
    const asNumbers = locators.map(value => [...value].reduce((sum, ch) => sum * 31 + LOCATOR_ALPHABET.indexOf(ch), 0));
    // Not counting upwards, not neighbours, and not all starting alike.
    expect(asNumbers.slice(1).filter((n, i) => n > asNumbers[i]).length).toBeLessThan(39);
    expect(asNumbers.slice(1).filter((n, i) => Math.abs(n - asNumbers[i]) <= 1)).toHaveLength(0);
    expect(new Set(locators.map(value => value[0])).size).toBeGreaterThan(5);
  });

  it("come from an unbiased generator over exactly the 31-symbol alphabet", async () => {
    const { rows } = await pool.query<{ value: string }>("SELECT card_locator_candidate() AS value FROM generate_series(1, 20000)");
    const counts = new Map<string, number>();
    for (const { value } of rows) {
      expect(value).toMatch(SHAPE);
      for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    }
    expect([...counts.keys()].sort().join("")).toBe([...LOCATOR_ALPHABET].sort().join(""));
    const expected = (rows.length * 6) / 31; // about 3871 per symbol, standard deviation about 58
    for (const [ch, count] of counts) expect(Math.abs(count - expected), ch).toBeLessThan(6 * Math.sqrt(expected * (30 / 31)));
    expect(new Set(rows.map(row => row.value)).size).toBeGreaterThan(19990);
  });

  it("stay distinct across concurrent enrolments", async () => {
    const a = await shop(await user(), "Synthetic Rush");
    const cards = await Promise.all(Array.from({ length: 25 }, () => enroll({ slug: a.programSlug, acceptedTerms: true })));
    const locators = await Promise.all(cards.map(card => locatorOf(card.id)));
    expect(new Set(locators).size).toBe(25);
  });

  it("are retried safely on a collision and may repeat across tenants", async () => {
    const a = await shop(await user(), "Synthetic Collide A");
    const b = await shop(await user(), "Synthetic Collide B");
    await scriptGenerator(["AAAAAA", "AAAAAA", "AAAAAA", "BBBBBB", "AAAAAA"]);
    const first = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: a.programSlug, acceptedTerms: true }); // draws AAAAAA twice, then BBBBBB
    const other = await enroll({ slug: b.programSlug, acceptedTerms: true }); // another tenant may use AAAAAA
    expect(await locatorOf(first.id)).toBe("AAAAAA");
    expect(await locatorOf(second.id)).toBe("BBBBBB");
    expect(await locatorOf(other.id)).toBe("AAAAAA");
  });

  it("fail loudly instead of duplicating when the space is exhausted", async () => {
    const a = await shop(await user(), "Synthetic Exhausted");
    await scriptGenerator(["CCCCCC"]);
    await enroll({ slug: a.programSlug, acceptedTerms: true });
    const failure = await enroll({ slug: a.programSlug, acceptedTerms: true }).then(() => null, (error: { message: string; cause?: { message?: string } }) => error);
    expect(failure && `${failure.message} ${failure.cause?.message ?? ""}`).toMatch(/could not allocate a card locator/);
    expect(await db.select().from(memberships).where(eq(memberships.tenantId, a.tenantId))).toHaveLength(1);
  });

  it("are never reused after a card is closed", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Closed");
    await scriptGenerator(["DDDDDD", "DDDDDD", "EEEEEE"]);
    const closing = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await closeCard(closing.cardToken);
    const next = await enroll({ slug: a.programSlug, acceptedTerms: true });
    expect(await locatorOf(closing.id)).toBe("DDDDDD");
    expect(await locatorOf(next.id)).toBe("EEEEEE");
    await expect(previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: "K-DDDDDD" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("database guards", () => {
  it("refuse explicit values and every later change", async () => {
    const a = await shop(await user(), "Synthetic Guard");
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await expect(pool.query("UPDATE memberships SET card_locator = 'ZZZZZZ' WHERE id = $1", [card.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token, card_locator) SELECT tenant_id, program_id, 'sc_x' || md5(random()::text), 'card_x' || md5(random()::text), 'ZZZZZZ' FROM memberships WHERE id = $1", [card.id])).rejects.toThrow(/assigned by the database/);
    await expect(pool.query("UPDATE memberships SET card_locator = '' WHERE id = $1", [card.id])).rejects.toThrow();
    // Shape and uniqueness are enforced even if the triggers were bypassed.
    await pool.query("ALTER TABLE memberships DISABLE TRIGGER memberships_card_locator_immutable");
    try {
      await expect(pool.query("UPDATE memberships SET card_locator = 'K-12345' WHERE id = $1", [card.id])).rejects.toThrow();
      await expect(pool.query("UPDATE memberships SET card_locator = 'abcdef' WHERE id = $1", [card.id])).rejects.toThrow(/membership_card_locator_valid/);
      await expect(pool.query("UPDATE memberships SET card_locator = 'AB0DEF' WHERE id = $1", [card.id])).rejects.toThrow(/membership_card_locator_valid/);
    } finally { await pool.query("ALTER TABLE memberships ENABLE TRIGGER memberships_card_locator_immutable"); }
    const second = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await pool.query("ALTER TABLE memberships DISABLE TRIGGER memberships_card_locator_immutable");
    try {
      await expect(pool.query("UPDATE memberships SET card_locator = $1 WHERE id = $2", [await locatorOf(card.id), second.id])).rejects.toThrow(/memberships_card_locator_uq/);
    } finally { await pool.query("ALTER TABLE memberships ENABLE TRIGGER memberships_card_locator_immutable"); }
  });

  it("have an index behind the (tenant, locator) lookup", async () => {
    const { rows } = await pool.query<{ indexdef: string }>("SELECT indexdef FROM pg_indexes WHERE tablename = 'memberships' AND indexname = 'memberships_card_locator_uq'");
    expect(rows[0]?.indexdef).toMatch(/\(tenant_id, card_locator\)/);
  });
});

describe("counter lookup by locator", () => {
  it("shows a minimal preview first, and the card only when opened deliberately", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Preview");
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const typed = `k ${(await locatorOf(card.id)).toLowerCase()}`;
    const preview = await previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: typed });
    expect(Object.keys(preview).sort()).toEqual(["cardLocator", "issuedAt", "programName", "stage"]);
    expect(preview).toMatchObject({ stage: "preview", cardLocator: `K-${await locatorOf(card.id)}`, programName: "Kaffeekarte" });
    expect(JSON.stringify(preview)).not.toContain(card.id);
    const opened = await lookupCard({ userId: owner, locationId: a.locationId, scanCode: typed });
    expect(opened).toMatchObject({ stage: "open", membershipId: card.id, matchedBy: "locator", balance: 0 });
    expect((await lookupCard({ userId: owner, locationId: a.locationId, scanCode: card.scanCode })).matchedBy).toBe("code");
    // A scanned code is not a locator: there is nothing to preview.
    await expect(previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("is limited to the staff member's tenant, location and active role", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const a = await shop(ownerA, "Synthetic Iso A");
    const b = await shop(ownerB, "Synthetic Iso B");
    await scriptGenerator(["FFFFFF", "FFFFFF"]); // same locator in two tenants
    const cardA = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const cardB = await enroll({ slug: b.programSlug, acceptedTerms: true });
    await restoreGenerator();
    expect((await lookupCard({ userId: ownerA, locationId: a.locationId, scanCode: "K-FFFFFF" })).membershipId).toBe(cardA.id);
    expect((await lookupCard({ userId: ownerB, locationId: b.locationId, scanCode: "K-FFFFFF" })).membershipId).toBe(cardB.id);
    // Tenant A's staff cannot reach B's location, and B's card is not found when A's owner names B's location.
    await expect(lookupCard({ userId: ownerA, locationId: b.locationId, scanCode: "K-FFFFFF" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const second = await createAdditionalLocation(ownerA, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const bonn = await enroll({ slug: second.programSlug, acceptedTerms: true });
    const cashier = await user();
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId });
    const bonnLocator = await locatorOf(bonn.id);
    await expect(previewCardLocator({ userId: cashier, locationId: a.locationId, scanCode: bonnLocator })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId: cashier, locationId: a.locationId, scanCode: bonnLocator })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await previewCardLocator({ userId: cashier, locationId: a.locationId, scanCode: "FFFFFF" })).programName).toBe("Kaffeekarte");

    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, cashier));
    await expect(previewCardLocator({ userId: cashier, locationId: a.locationId, scanCode: "FFFFFF" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(lookupCard({ userId: await user(), locationId: a.locationId, scanCode: "FFFFFF" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects malformed input before touching the database", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Malformed");
    await enroll({ slug: a.programSlug, acceptedTerms: true });
    for (const bad of ["", "K-", "K-0O1ILA", "K-12345", "K-1234567", "7", "K-0001", "hello", "K--ABCDEF", "' OR 1=1 --"]) {
      await expect(lookupCard({ userId: owner, locationId: a.locationId, scanCode: bad }), bad).rejects.toMatchObject({ code: "INVALID_CODE" });
      await expect(previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: bad }), bad).rejects.toMatchObject({ code: "INVALID_CODE" });
    }
  });

  it("cannot be found by counting: sequential and legacy-style guesses resolve nothing", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Enumerate");
    const real = new Set<string>();
    for (let i = 0; i < 30; i++) real.add(await locatorOf((await enroll({ slug: a.programSlug, acceptedTerms: true })).id));
    const guesses = [...Array.from({ length: 300 }, (_, i) => base31(i)), ...Array.from({ length: 300 }, (_, i) => base31(1000 + i * 7919)),
      ...Array.from({ length: 100 }, (_, i) => `AAA${base31(i).slice(3)}`)].filter(guess => !real.has(guess));
    let found = 0;
    for (const guess of guesses) {
      try { await previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: `K-${guess}` }); found++; }
      catch (error) { expect((error as { code?: string }).code).toBe("NOT_FOUND"); }
    }
    expect(found).toBe(0);
    // The old sequential shape ("K-0001") is not even a valid locator.
    for (const legacy of ["K-0001", "K-0002", "1", "2", "K-000001"]) await expect(previewCardLocator({ userId: owner, locationId: a.locationId, scanCode: legacy })).rejects.toMatchObject({ code: "INVALID_CODE" });
  });

  it("is searchable by the merchant and appears in list, detail and export-facing fields", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Search");
    await enroll({ slug: a.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const locator = await locatorOf(second.id);
    const found = await listMerchantMembers(owner, { query: `k-${locator.toLowerCase()}` });
    expect(found.members.map(member => [member.id, member.cardLocator, member.pseudonym])).toEqual([[second.id, `K-${locator}`, `Karte K-${locator}`]]);
    expect((await listMerchantMembers(owner, { query: "K-AAAAAA" })).members).toHaveLength(0);
    expect((await getMerchantMember(owner, second.id)).member).toMatchObject({ cardLocator: `K-${locator}`, locationId: a.locationId });
  });
});
