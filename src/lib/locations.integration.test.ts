import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, staffRoles } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createAdditionalLocation, listMerchantLocations, updateSender, validateOwnerLocation } from "./locations";
import { fillSender } from "./sender-test-support";
import { createMerchant, enroll, getMerchantContext, lookupCard } from "./product";
import { marketingSignature, programSender } from "./promotion-policy";
import { createStaffInvite } from "./staff";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Location tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic location tester", `${id}@example.test`]);
  return id;
}

async function shop(ownerId: string, name: string) {
  return createMerchant({ userId: ownerId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 5 });
}

describe("additional merchant locations", () => {
  it("creates an independent programme while preserving the existing card and reporting owner totals", async () => {
    const ownerId = await user();
    const original = await shop(ownerId, "Synthetic Multi A");
    const oldCard = await enroll({ slug: original.programSlug, acceptedTerms: true });
    await award({ userId: ownerId, locationId: original.locationId, membershipId: oldCard.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });

    const second = await createAdditionalLocation(ownerId, {
      name: "Second synthetic counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin",
      programName: "Berlin synthetic card", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3,
      rulesText: "Drei Punkte pro Euro an diesem synthetischen Standort.", rewardTitle: "Testprämie", rewardCost: 30,
    });
    const newCard = await enroll({ slug: second.programSlug, acceptedTerms: true });
    expect(second.locationId).not.toBe(original.locationId);
    expect(second.programSlug).not.toBe(original.programSlug);
    expect((await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, oldCard.id)))[0].balance).toBe(2);
    expect((await getMerchantContext(ownerId, original.locationId))?.programSlug).toBe(original.programSlug);
    expect((await getMerchantContext(ownerId, second.locationId))?.programSlug).toBe(second.programSlug);
    await expect(lookupCard({ userId: ownerId, locationId: original.locationId, scanCode: newCard.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await lookupCard({ userId: ownerId, locationId: second.locationId, scanCode: newCard.scanCode })).membershipId).toBe(newCard.id);
    const list = await listMerchantLocations(ownerId);
    expect(list.totals).toMatchObject({ locations: 2, cards: 2, awards: 1 });
    expect(list.locations.map(location => [location.id, location.programSlug, location.cards, location.awards])).toEqual(expect.arrayContaining([
      [original.locationId, original.programSlug, 1, 1], [second.locationId, second.programSlug, 1, 0],
    ]));
  });

  it("keeps staff on their assigned location and rejects cross-tenant or non-owner selection and creation", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const cashier = await user();
    const manager = await user();
    const a = await shop(ownerA, "Synthetic Multi B");
    const b = await shop(ownerB, "Synthetic Multi C");
    const second = await createAdditionalLocation(ownerA, { name: "Another synthetic counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn synthetic card", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const card = await enroll({ slug: second.programSlug, acceptedTerms: true });
    const credited = await award({ userId: ownerA, locationId: second.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await db.insert(staffRoles).values([
      { tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId },
      { tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId },
    ]);
    expect((await getMerchantContext(cashier, second.locationId))?.locationId).toBe(a.locationId);
    expect((await getMerchantContext(manager, second.locationId))?.locationId).toBe(a.locationId);
    await expect(lookupCard({ userId: cashier, locationId: a.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(award({ userId: ownerA, locationId: a.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reverseEntry({ userId: ownerA, locationId: a.locationId, entryId: credited.entryId, reason: "Synthetic cross-location correction", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const invited = await createStaffInvite({ actorUserId: ownerA, locationId: second.locationId, email: "new-staff@example.test", role: "cashier" });
    expect(invited.role).toBe("cashier");
    await expect(createStaffInvite({ actorUserId: ownerB, locationId: second.locationId, email: "wrong-tenant@example.test", role: "cashier" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(validateOwnerLocation(ownerB, second.locationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getMerchantContext(ownerB, second.locationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(validateOwnerLocation(cashier, second.locationId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createAdditionalLocation(manager, { name: "Denied", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Denied", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 4 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(validateOwnerLocation(ownerA, b.locationId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await db.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.userId, ownerA), eq(staffRoles.tenantId, a.tenantId)));
    await expect(listMerchantLocations(ownerA)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects duplicate names, mismatched country and invalid timezone without adding partial programmes", async () => {
    const ownerId = await user();
    await shop(ownerId, "Synthetic Multi D");
    const data = { name: "Synthetic new counter", city: "Bonn", country: "DE" as const, timezone: "Europe/Berlin", programName: "New card", programType: "stamp" as const, rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Coffee", rewardCost: 5 };
    await createAdditionalLocation(ownerId, data);
    await expect(createAdditionalLocation(ownerId, { ...data, name: "synthetic NEW counter" })).rejects.toMatchObject({ code: "LOCATION_EXISTS" });
    await expect(createAdditionalLocation(ownerId, { ...data, name: "Wrong country", country: "MA" })).rejects.toMatchObject({ code: "INVALID_COUNTRY" });
    await expect(createAdditionalLocation(ownerId, { ...data, name: "Wrong timezone", timezone: "Not/A_Timezone" })).rejects.toMatchObject({ code: "INVALID_TIMEZONE" });
    expect((await listMerchantLocations(ownerId)).totals.locations).toBe(2);
  });

  it("asks a new points-by-amount location for extra rules only, stamps and manual points for their rule (ENG-099 3c)", async () => {
    const ownerId = await user();
    await shop(ownerId, "Synthetic Multi E");
    const data = { name: "Synthetic points counter", city: "Bonn", country: "DE" as const, timezone: "Europe/Berlin", programName: "Punktekarte", programType: "points" as const, rulesText: "", rewardTitle: "Kaffee", rewardCost: 30 };
    await createAdditionalLocation(ownerId, data); // points default to the purchase amount here
    const short = { issues: [{ path: ["rulesText"], code: "too_small" }] };
    await expect(createAdditionalLocation(ownerId, { ...data, name: "Synthetic manual counter", earningMode: "manual" })).rejects.toMatchObject(short);
    await expect(createAdditionalLocation(ownerId, { ...data, name: "Synthetic stamp counter", programType: "stamp", rulesText: "Zu kurz." })).rejects.toMatchObject(short);
    expect((await listMerchantLocations(ownerId)).totals.locations).toBe(2);
  });

  it("lets only the owner save each sender part, checked with the screen's rules and stored in normal form (ENG-164)", async () => {
    const ownerId = await user();
    const shopA = await shop(ownerId, "Synthetic Address A");
    const otherOwner = await user();
    await shop(otherOwner, "Synthetic Address B");
    const unset = { street: null, postalCode: null, representative: null, contactPhone: null, legalForm: null, registerCourt: null, registerNumber: null, vatId: null };
    expect((await listMerchantLocations(ownerId)).locations[0]).toMatchObject(unset);
    const address = { part: "address" as const, locationId: shopA.locationId, street: " Friedrich-Ebert-Straße 12 ", postalCode: " 34117 ", city: "Kassel" };
    await expect(updateSender(otherOwner, address)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateSender(await user(), address)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const refused = [
      { ...address, postalCode: "3411" }, { ...address, street: "" }, { ...address, street: "Hauptstr. 1\nAngebote abbestellen" },
      { part: "contact" as const, locationId: shopA.locationId, contactEmail: "", contactPhone: "" },
      { part: "contact" as const, locationId: shopA.locationId, contactEmail: "kein-at-zeichen", contactPhone: "" },
      { part: "contact" as const, locationId: shopA.locationId, contactEmail: "", contactPhone: "0561 123456\r\nBcc: x" },
      { part: "representative" as const, representative: "" }, { part: "representative" as const, representative: "Erika\u0007Muster" },
      { part: "register" as const, legalForm: "", registerCourt: "Amtsgericht Kassel", registerNumber: "", vatId: "" },
      { part: "register" as const, legalForm: "", registerCourt: "", registerNumber: "HRB 12345", vatId: "" },
      { part: "register" as const, legalForm: "", registerCourt: "Amtsgericht Kassel", registerNumber: "12345", vatId: "" },
      { part: "register" as const, legalForm: "", registerCourt: "", registerNumber: "", vatId: "DE12345678" },
      { part: "register" as const, legalForm: "", registerCourt: "", registerNumber: "", vatId: "123456789" },
    ];
    for (const input of refused) await expect(updateSender(ownerId, input), JSON.stringify(input)).rejects.toMatchObject({ code: "INVALID_SENDER" });
    // Each refusal says what to fix, in German, exactly as the owner's screen does.
    await expect(updateSender(ownerId, { ...address, postalCode: "3411" })).rejects.toMatchObject({ message: "Die PLZ hat fünf Ziffern, z. B. 34117." });
    expect(await updateSender(ownerId, address)).toEqual({ part: "address", locationId: shopA.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel" });
    expect(await updateSender(ownerId, { part: "contact", locationId: shopA.locationId, contactEmail: " hallo@example.test ", contactPhone: "" })).toMatchObject({ contactEmail: "hallo@example.test", contactPhone: null });
    expect(await updateSender(ownerId, { part: "representative", representative: " Erika Muster " })).toEqual({ part: "representative", representative: "Erika Muster" });
    expect(await updateSender(ownerId, { part: "register", legalForm: "UG (haftungsbeschränkt)", registerCourt: "Amtsgericht Kassel", registerNumber: "hrb12345", vatId: " de 123 456 789 " }))
      .toEqual({ part: "register", legalForm: "UG (haftungsbeschränkt)", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 12345", vatId: "DE123456789" });
    // A part saves only its own fields; the others stay as they were.
    expect((await listMerchantLocations(ownerId)).locations[0]).toMatchObject({ street: "Friedrich-Ebert-Straße 12", postalCode: "34117", contactEmail: "hallo@example.test", representative: "Erika Muster", registerNumber: "HRB 12345", vatId: "DE123456789" });
    // Emptying the optional parts stores null, so the footer leaves them out.
    expect(await updateSender(ownerId, { part: "register", legalForm: " ", registerCourt: "", registerNumber: "", vatId: "" })).toMatchObject({ legalForm: null, registerCourt: null, registerNumber: null, vatId: null });
    expect((await listMerchantLocations(otherOwner)).locations[0]).toMatchObject(unset);
  });

  it("prints only the optional footer parts that are filled", async () => {
    const ownerId = await user();
    const shopA = await shop(ownerId, "Synthetic Footer");
    const required = { locationId: shopA.locationId, street: "Hauptstraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactEmail: "hallo@example.test" };
    const footer = async () => marketingSignature((await programSender(db, shopA.tenantId, shopA.programId))!, "https://unsubscribe.example.test/u")?.footer;
    process.env.PUBLIC_BASE_URL = "https://app.example.test";
    const tail = "\nDu bekommst diese E-Mail, weil du auf deiner Karte E-Mails von Synthetic Footer bestellt hast. Abmelden: https://unsubscribe.example.test/u · Datenschutz: https://app.example.test/datenschutz";
    expect(await footer()).toBeUndefined();
    await fillSender(ownerId, { ...required, legalForm: "e.K.", vatId: "DE123456789" });
    expect(await footer()).toBe(`Diese E-Mail kommt von Synthetic Footer, e.K., vertreten durch Erika Muster, Hauptstraße 1, 34117 Kassel. Kontakt: hallo@example.test. USt-IdNr.: DE123456789${tail}`);
    await fillSender(ownerId, { ...required, registerCourt: "Amtsgericht Kassel", registerNumber: "HRA 7" });
    expect(await footer()).toBe(`Diese E-Mail kommt von Synthetic Footer, vertreten durch Erika Muster, Hauptstraße 1, 34117 Kassel. Kontakt: hallo@example.test. Registergericht: Amtsgericht Kassel, HRA 7.${tail}`);
  });

  it("keeps street, postcode and contact per location and the business details per tenant", async () => {
    const ownerId = await user();
    const shopA = await shop(ownerId, "Synthetic Two Shops");
    const second = await createAdditionalLocation(ownerId, { name: "Second synthetic counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second synthetic card", programType: "stamp", rulesText: "Ein Stempel pro synthetischem Besuch.", rewardTitle: "Testkaffee", rewardCost: 5 });
    const business = { representative: "Erika Muster", legalForm: "GmbH", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 12345", vatId: "DE123456789" };
    await fillSender(ownerId, { locationId: shopA.locationId, street: "Hauptstraße 1", postalCode: "34117", city: "Kassel", contactEmail: "kassel@example.test", ...business });
    await fillSender(ownerId, { locationId: second.locationId, street: "Torstraße 2", postalCode: "10119", city: "Berlin", contactPhone: "+49 30 123456", ...business, representative: "Max Muster" });
    const [a, b] = (await listMerchantLocations(ownerId)).locations;
    expect(a).toMatchObject({ street: "Hauptstraße 1", postalCode: "34117", city: "Kassel", contactEmail: "kassel@example.test", ...business, representative: "Max Muster" });
    expect(b).toMatchObject({ street: "Torstraße 2", postalCode: "10119", city: "Berlin", contactPhone: "+49 30 123456", ...business, representative: "Max Muster" });
    expect((await pool.query("SELECT representative, legal_form, register_court, register_number, vat_id FROM tenants WHERE id = $1", [shopA.tenantId])).rows)
      .toEqual([{ representative: "Max Muster", legal_form: "GmbH", register_court: "Amtsgericht Kassel", register_number: "HRB 12345", vat_id: "DE123456789" }]);
  });
});
