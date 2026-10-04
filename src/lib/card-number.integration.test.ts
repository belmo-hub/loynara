import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, staffRoles, tenants } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { formatCardNumber, parseCardNumber } from "./card-number";
import { createAdditionalLocation } from "./locations";
import { getMerchantMember, listMerchantMembers } from "./merchant-members";
import { createMerchant, enroll, getCard, lookupCard } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user" CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic owner", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, businessName: string) => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 8 });

describe("parsing", () => {
  it("accepts the spoken and printed forms and rejects everything else", () => {
    for (const raw of ["7", "#7", "K7", "k-7", "K-0007", " K - 7 ", "Nr. 7", "nr 7", "0007"]) expect(parseCardNumber(raw)).toBe(7);
    for (const raw of ["", "0", "K-0", "sc_abc", "7a", "-7", "12345678", "K--7", "1 2"]) expect(parseCardNumber(raw)).toBeNull();
    expect(formatCardNumber(7)).toBe("K-0007");
    expect(formatCardNumber(123456)).toBe("K-123456");
  });
});

describe("card numbers", () => {
  it("numbers cards per tenant in enrolment order and shows the number on the customer card", async () => {
    const a = await shop(await user(), "Synthetic A");
    const b = await shop(await user(), "Synthetic B");
    const a1 = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const b1 = await enroll({ slug: b.programSlug, acceptedTerms: true });
    const a2 = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const numbers = async (id: string) => (await db.select({ n: memberships.cardNumber }).from(memberships).where(eq(memberships.id, id)))[0].n;
    expect([await numbers(a1.id), await numbers(a2.id), await numbers(b1.id)]).toEqual([1, 2, 1]);
    expect((await getCard(a2.cardToken)).cardNumber).toBe("K-0002");
  });

  it("assigns distinct numbers to concurrent enrolments", async () => {
    const a = await shop(await user(), "Synthetic Rush");
    const cards = await Promise.all(Array.from({ length: 12 }, () => enroll({ slug: a.programSlug, acceptedTerms: true })));
    const rows = await db.select({ n: memberships.cardNumber }).from(memberships).where(eq(memberships.tenantId, a.tenantId));
    expect(rows.map(row => row.n).sort((x, y) => x - y)).toEqual(Array.from({ length: cards.length }, (_, i) => i + 1));
    const [tenant] = await db.select({ next: tenants.nextCardNumber }).from(tenants).where(eq(tenants.id, a.tenantId));
    expect(tenant.next).toBe(cards.length + 1);
  });

  it("refuses explicit or changed numbers so the sequence cannot be bypassed", async () => {
    const a = await shop(await user(), "Synthetic Guard");
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await expect(pool.query("UPDATE memberships SET card_number = 99 WHERE id = $1", [card.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token, card_number) SELECT tenant_id, program_id, 'sc_x' || md5(random()::text), 'card_x' || md5(random()::text), 5 FROM memberships WHERE id = $1", [card.id])).rejects.toThrow(/assigned by the database/);
  });

  it("finds a card at the counter by number only inside the caller's tenant and location", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const a = await shop(ownerA, "Synthetic Counter A");
    const b = await shop(ownerB, "Synthetic Counter B");
    const cardA = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const cardB = await enroll({ slug: b.programSlug, acceptedTerms: true });
    const byNumber = await lookupCard({ userId: ownerA, locationId: a.locationId, scanCode: "K-0001" });
    expect(byNumber).toMatchObject({ membershipId: cardA.id, cardNumber: "K-0001", matchedBy: "number" });
    expect(await lookupCard({ userId: ownerA, locationId: a.locationId, scanCode: cardA.scanCode })).toMatchObject({ membershipId: cardA.id, matchedBy: "code" });
    // Owner B's card 1 is never reachable from tenant A, and vice versa.
    expect((await lookupCard({ userId: ownerB, locationId: b.locationId, scanCode: "1" })).membershipId).toBe(cardB.id);
    await expect(lookupCard({ userId: ownerA, locationId: b.locationId, scanCode: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId: ownerA, locationId: a.locationId, scanCode: "2" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId: ownerA, locationId: a.locationId, scanCode: "hello" })).rejects.toMatchObject({ code: "INVALID_CODE" });

    // A cashier of location A cannot reach a card of the tenant's second location by number.
    const second = await createAdditionalLocation(ownerA, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const bonn = await enroll({ slug: second.programSlug, acceptedTerms: true });
    const cashier = await user();
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId });
    const bonnNumber = (await db.select({ n: memberships.cardNumber }).from(memberships).where(eq(memberships.id, bonn.id)))[0].n;
    await expect(lookupCard({ userId: cashier, locationId: a.locationId, scanCode: String(bonnNumber) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await lookupCard({ userId: cashier, locationId: a.locationId, scanCode: "#1" })).membershipId).toBe(cardA.id);

    // Revoked staff cannot resolve numbers at all.
    await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, cashier));
    await expect(lookupCard({ userId: cashier, locationId: a.locationId, scanCode: "1" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not resolve a closed card and never reuses its number", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Closed");
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await closeCard(card.cardToken);
    await expect(lookupCard({ userId: owner, locationId: a.locationId, scanCode: "1" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const next = await enroll({ slug: a.programSlug, acceptedTerms: true });
    expect((await lookupCard({ userId: owner, locationId: a.locationId, scanCode: "2" })).membershipId).toBe(next.id);
  });

  it("lists and searches merchant cards by number", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic List");
    await enroll({ slug: a.programSlug, acceptedTerms: true });
    const second = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const found = await listMerchantMembers(owner, { query: "K-0002" });
    expect(found.members.map(member => [member.id, member.cardNumber, member.pseudonym])).toEqual([[second.id, "K-0002", "Karte K-0002"]]);
    expect((await listMerchantMembers(owner, { query: "9" })).members).toHaveLength(0);
    expect((await getMerchantMember(owner, second.id)).member).toMatchObject({ cardNumber: "K-0002", locationId: a.locationId });
  });
});
