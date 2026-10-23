import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { cardSecurityEvents, ledgerEntries, locations, programs, secureTags, staffRoles, tapRequests } from "@/db/schema";
import { reissueCardByStaff } from "./card-reissue";
import { award, redeem, reverseEntry } from "./loyalty";
import { createMerchant, enroll, lookupCard } from "./product";
import { getLaunchReadiness } from "./readiness";
import { createStaffInvite } from "./staff";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user" CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string) => createMerchant({ userId, businessName: "Synthetic Ready Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 2 });
const status = (readiness: Awaited<ReturnType<typeof getLaunchReadiness>>) => Object.fromEntries(readiness.steps.map(step => [step.id, step.status]));
const noNfc = { NODE_ENV: "test" } as Record<string, string | undefined>;

describe("launch readiness", () => {
  it("starts with configuration only and points at the first missing evidence", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(status(readiness)).toEqual({ programme: "done", card: "todo", team: "todo", enrolment: "todo", first_award: "todo", first_redemption: "todo", nfc: "external" });
    expect(readiness).toMatchObject({ requiredDone: 1, requiredTotal: 3, next: { stepId: "enrolment" } });
    expect(readiness.steps.find(step => step.id === "programme")?.evidence).toContain("2 Stempel → Kaffee gratis");
  });

  it("counts only uncorrected counter awards as evidence, not seed data, and resumes after a correction", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID(), source: "synthetic_seed" });
    let readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(status(readiness)).toMatchObject({ enrolment: "done", first_award: "todo" });
    expect(readiness.next?.stepId).toBe("first_award");

    const real = await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(status(readiness).first_award).toBe("done");
    expect(readiness.requiredDone).toBe(3);

    await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: real.entryId, reason: "Probebuchung zurückgenommen", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(status(await getLaunchReadiness(owner, merchant.locationId, noNfc)).first_award).toBe("todo");

    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const rewardVersionId = (await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode })).rewards[0].id;
    await redeem({ userId: owner, locationId: merchant.locationId, membershipId: card.id, rewardVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await db.update(locations).set({ brandColor: "#7a2e1f" }).where(eq(locations.id, merchant.locationId));
    readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(status(readiness)).toMatchObject({ first_award: "done", first_redemption: "done", card: "done" });
    expect(readiness.next?.stepId).toBe("team");
  });

  it("separates a pending invitation from working team access and keeps NFC honest", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await createStaffInvite({ actorUserId: owner, email: "kasse@example.test", role: "cashier", locationId: merchant.locationId });
    let team = (await getLaunchReadiness(owner, merchant.locationId, noNfc)).steps.find(step => step.id === "team")!;
    expect(team).toMatchObject({ status: "todo" });
    expect(team.evidence).toContain("1 Einladung noch nicht angenommen");
    const cashier = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId });
    team = (await getLaunchReadiness(owner, merchant.locationId, noNfc)).steps.find(step => step.id === "team")!;
    expect(team.status).toBe("done");

    const nfc = (await getLaunchReadiness(owner, merchant.locationId, noNfc)).steps.find(step => step.id === "nfc")!;
    expect(nfc.status === "external" || nfc.status === "not_applicable").toBe(true);
    expect(nfc.required).toBe(false);
  });

  it("is available to owners and the location's manager, never to cashiers or other tenants", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const otherOwner = await user();
    await shop(otherOwner);
    const [manager, cashier] = [await user(), await user()];
    await db.insert(staffRoles).values([
      { tenantId: merchant.tenantId, userId: manager, role: "manager", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId },
    ]);
    const forManager = await getLaunchReadiness(manager, merchant.locationId, noNfc);
    expect(forManager.next?.stepId).toBe("enrolment");
    await expect(getLaunchReadiness(cashier, merchant.locationId, noNfc)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getLaunchReadiness(otherOwner, merchant.locationId, noNfc)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("is not satisfied by anything other than a cashier-confirmed award: seed, referral bonus, NFC tap, recovery, reissue, correction", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const insert = async (source: string, kind: "award" | "reversal" = "award", delta = 1, reversalOfId?: string) => (await db.insert(ledgerEntries).values({
      tenantId: merchant.tenantId, locationId: merchant.locationId, membershipId: card.id, delta, kind, source, requestId: randomUUID(), idempotencyKey: randomUUID(),
      actorUserId: source === "nfc_tap" ? null : owner, reversalOfId,
    }).returning({ id: ledgerEntries.id }))[0].id;
    const seeded = await insert("synthetic_seed");
    for (const source of ["referral_bonus", "nfc_tap", "legacy_unclassified"]) await insert(source);
    // A correction always points at the entry it undoes.
    await insert("staff_correction", "reversal", -1, seeded);
    await db.insert(cardSecurityEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, action: "card_credential_rotated" });
    await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: card.id, reason: "Neues Handy, Kontakt stimmt", verificationMethod: "stored_contact", entitlementConfirmed: true, idempotencyKey: randomUUID() });
    const readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(status(readiness)).toMatchObject({ enrolment: "done", first_award: "todo", first_redemption: "todo" });
    expect(readiness.next?.stepId).toBe("first_award");
    expect(readiness.requiredDone).toBe(2);
  });

  it("keeps outside-Loynara conditions open even when every application step has evidence", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const rewardVersionId = (await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode })).rewards[0].id;
    await redeem({ userId: owner, locationId: merchant.locationId, membershipId: card.id, rewardVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await db.update(locations).set({ brandColor: "#7a2e1f" }).where(eq(locations.id, merchant.locationId));
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: await user(), role: "cashier", locationId: merchant.locationId });
    const readiness = await getLaunchReadiness(owner, merchant.locationId, noNfc);
    expect(readiness).toMatchObject({ requiredDone: 3, requiredTotal: 3, next: null });
    const outside = readiness.steps.filter(step => step.group === "external");
    expect(outside.map(step => step.id)).toEqual(["nfc"]);
    for (const step of outside) { expect(step.status, step.id).toBe("external"); expect(step.required, step.id).toBe(false); }
    // No application step claims legal or operator approval.
    expect(readiness.steps.filter(step => step.group !== "external").every(step => step.status === "done")).toBe(true);
    // With a key provider NFC is checked inside Loynara, so nothing is left outside.
    const withKeys = { NODE_ENV: "test", TAP_SYNTHETIC_KEY_FILE: "/synthetic/keys.json" } as Record<string, string | undefined>;
    expect((await getLaunchReadiness(owner, merchant.locationId, withKeys)).steps.filter(step => step.group === "external")).toEqual([]);
  });

  it("reports NFC from evidence: external without a key provider, then tag and a confirmed tap when it is on", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const withKeys = { NODE_ENV: "test", TAP_SYNTHETIC_KEY_FILE: "/synthetic/keys.json" } as Record<string, string | undefined>;
    const nfc = async (env: Record<string, string | undefined>) => (await getLaunchReadiness(owner, merchant.locationId, env)).steps.find(step => step.id === "nfc")!;

    expect(await nfc(noNfc)).toMatchObject({ status: "external", group: "external", required: false });
    expect(await nfc(withKeys)).toMatchObject({ status: "not_applicable" }); // available, but the programme has tap switched off
    await db.update(programs).set({ tapMode: "staff_confirmed", tapCooldownSeconds: 60 }).where(eq(programs.id, merchant.programId));
    expect(await nfc(withKeys)).toMatchObject({ status: "todo", group: "verify" });
    const [tag] = await db.insert(secureTags).values({ publicRef: "readiness-tag-ref-0001", tenantId: merchant.tenantId, locationId: merchant.locationId, programId: merchant.programId, uid: "04A1B2C3D4E5F6", keyRef: "synthetic-key", configVersion: 1, status: "active" }).returning();
    const readTag = await nfc(withKeys);
    expect(readTag.status).toBe("todo");
    expect(readTag.evidence).toContain("Noch kein bestätigtes Antippen"); // a readable, active tag proves no checkout
    await db.insert(tapRequests).values({ tagId: tag.id, counter: 1, tenantId: merchant.tenantId, locationId: merchant.locationId, programId: merchant.programId, membershipId: card.id, status: "confirmed", expiresAt: new Date(Date.now() + 60_000) });
    expect(await nfc(withKeys)).toMatchObject({ status: "done" });
    // NFC is never a required step for the first pilot.
    expect((await getLaunchReadiness(owner, merchant.locationId, withKeys)).requiredTotal).toBe(3);
  });
});
