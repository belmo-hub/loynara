import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, staffRoles } from "@/db/schema";
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
    expect(status(readiness)).toMatchObject({ programme: "done", card: "todo", team: "todo", enrolment: "todo", first_award: "todo", first_redemption: "todo", legal: "external", access: "external" });
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
    const rewardVersionId = (await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: "1" })).rewards[0].id;
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
});
