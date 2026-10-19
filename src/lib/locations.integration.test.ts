import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { memberships, staffRoles } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createAdditionalLocation, listMerchantLocations, updateLocationAddress, validateOwnerLocation } from "./locations";
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

  it("lets only the owner set the sender details of their own location, trimmed and validated", async () => {
    const ownerId = await user();
    const shopA = await shop(ownerId, "Synthetic Address A");
    const otherOwner = await user();
    await shop(otherOwner, "Synthetic Address B");
    const details = { locationId: shopA.locationId, street: " Friedrich-Ebert-Straße 12 ", postalCode: "34117", city: "Kassel", representative: " Erika Muster ", contactEmail: "", contactPhone: " +49 561 123456 ", legalForm: "", registerCourt: " ", registerNumber: "", vatId: "" };
    const unset = { street: null, postalCode: null, representative: null, contactPhone: null, legalForm: null, registerCourt: null, registerNumber: null, vatId: null };
    expect((await listMerchantLocations(ownerId)).locations[0]).toMatchObject(unset);
    await expect(updateLocationAddress(otherOwner, details)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateLocationAddress(await user(), details)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const bad = [
      { postalCode: "3411" }, { postalCode: "34117a" }, { street: "Hauptstr. 1\nAngebote abbestellen" }, { street: "" },
      { representative: "" }, { representative: "Erika\u0007Muster" }, { representative: "E".repeat(121) },
      { contactPhone: "" }, { contactPhone: "ruf an" }, { contactPhone: "12345" }, { contactPhone: "0561 123456\r\nBcc: x" }, { contactEmail: "kein-at-zeichen" },
      { legalForm: "Gmb\nH" }, { legalForm: "G".repeat(41) },
      { registerCourt: "Amtsgericht Kassel" }, { registerNumber: "HRB 12345" },
      { vatId: "123456789" }, { vatId: "DE12" }, { vatId: "DE1234567890123" }, { vatId: "DE-123456789" },
    ];
    for (const patch of bad) await expect(updateLocationAddress(ownerId, { ...details, ...patch }), JSON.stringify(patch)).rejects.toThrow();
    const stored = { street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactEmail: null, contactPhone: "+49 561 123456", legalForm: null, registerCourt: null, registerNumber: null, vatId: null };
    expect(await updateLocationAddress(ownerId, details)).toEqual({ locationId: shopA.locationId, ...stored });
    expect((await listMerchantLocations(ownerId)).locations[0]).toMatchObject({ id: shopA.locationId, ...stored });
    // Email alone is enough contact; the optional parts are stored normalised.
    expect(await updateLocationAddress(ownerId, { ...details, contactEmail: " hallo@example.test ", contactPhone: "", legalForm: "UG (haftungsbeschränkt)", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 12345", vatId: " de 123 456 789 " }))
      .toMatchObject({ contactEmail: "hallo@example.test", contactPhone: null, legalForm: "UG (haftungsbeschränkt)", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 12345", vatId: "DE123456789" });
    expect((await listMerchantLocations(otherOwner)).locations[0]).toMatchObject(unset);
  });

  it("prints only the optional footer parts that are filled", async () => {
    const ownerId = await user();
    const shopA = await shop(ownerId, "Synthetic Footer");
    const required = { locationId: shopA.locationId, street: "Hauptstraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactEmail: "hallo@example.test" };
    const footer = async () => marketingSignature((await programSender(db, shopA.tenantId, shopA.programId))!, "https://unsubscribe.example.test/u")?.footer;
    process.env.PUBLIC_BASE_URL = "https://app.example.test";
    const tail = "\nDu bekommst diese E-Mail, weil du auf deiner Karte E-Mails von Synthetic Footer bestellt hast. Abmelden: https://unsubscribe.example.test/u · Datenschutz: https://app.example.test/datenschutz";
    await updateLocationAddress(ownerId, { ...required, legalForm: "e.K.", vatId: "DE123456789" });
    expect(await footer()).toBe(`Diese E-Mail kommt von Synthetic Footer, e.K., vertreten durch Erika Muster, Hauptstraße 1, 34117 Kassel. Kontakt: hallo@example.test. DE123456789${tail}`);
    await updateLocationAddress(ownerId, { ...required, registerCourt: "Amtsgericht Kassel", registerNumber: "HRA 7" });
    expect(await footer()).toBe(`Diese E-Mail kommt von Synthetic Footer, vertreten durch Erika Muster, Hauptstraße 1, 34117 Kassel. Kontakt: hallo@example.test. Amtsgericht Kassel, HRA 7.${tail}`);
  });
});
