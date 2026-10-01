import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingLocationPlans, locations, programs, staffRoles, subscriptions, tenants } from "@/db/schema";
import { createMerchant, getMerchantContext } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function identity() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic bridge owner", `${id}@example.test`]);
  return id;
}
function input(userId: string) {
  return { userId, businessName: "Synthetic Bridge Café", locationName: "Mitte", city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, programName: "Kaffeekarte", programType: "stamp" as const, rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Kaffee gratis", rewardCost: 8 };
}
async function partial(withLocation: boolean) {
  const userId = await identity();
  const [tenant] = await db.insert(tenants).values({ name: "Partial synthetic tenant", slug: randomUUID() }).returning();
  if (withLocation) await db.insert(locations).values({ tenantId: tenant.id, name: "Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin" });
  await db.insert(staffRoles).values({ tenantId: tenant.id, userId, role: "owner" });
  return { userId, tenantId: tenant.id };
}

describe("temporary identity-only onboarding bridge", () => {
  it("lets an identity-only account complete its merchant through the existing flow", async () => {
    const userId = await identity();
    expect(await getMerchantContext(userId)).toBeNull();
    const merchant = await createMerchant(input(userId));
    expect(await getMerchantContext(userId)).toMatchObject({ tenantId: merchant.tenantId, locationId: merchant.locationId, programSlug: merchant.programSlug, role: "owner" });
  });

  it("returns the completed merchant on retry without changing its identity or duplicating billing", async () => {
    const userId = await identity();
    const merchant = await createMerchant(input(userId));
    expect(await createMerchant({ ...input(userId), businessName: "Must not overwrite", rewardCost: 99 })).toEqual(merchant);
    expect(await db.select().from(tenants)).toMatchObject([{ id: merchant.tenantId, name: "Synthetic Bridge Café" }]);
    expect(await db.select().from(locations)).toHaveLength(1);
    expect(await db.select().from(programs)).toHaveLength(1);
    expect(await db.select().from(subscriptions)).toHaveLength(1);
    expect(await db.select().from(billingLocationPlans)).toHaveLength(1);
    expect(await getMerchantContext(userId)).toMatchObject({ rewardCost: 8 });
  });

  it.each([true, false])("shows an explicit setup error for a partial tenant (location exists: %s)", async withLocation => {
    const f = await partial(withLocation);
    await expect(createMerchant(input(f.userId))).rejects.toMatchObject({ code: "SETUP_INCOMPLETE", message: expect.stringContaining("Einrichtung") });
    await expect(getMerchantContext(f.userId)).rejects.toMatchObject({ code: "SETUP_INCOMPLETE", message: expect.stringContaining("Support") });
    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(programs)).toHaveLength(0);
  });

  it.each(["owner", "manager", "cashier"])("refuses revoked %s access instead of offering a fresh wizard", async role => {
    const userId = await identity();
    const merchant = await createMerchant(input(userId));
    await db.update(staffRoles).set({ role, active: false, locationId: role === "owner" ? null : merchant.locationId }).where(eq(staffRoles.userId, userId));
    await expect(getMerchantContext(userId)).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("entzogen") });
    await expect(createMerchant(input(userId))).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("entzogen") });
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("does not let active staff claim the owner's completed onboarding result", async () => {
    const ownerId = await identity();
    const merchant = await createMerchant(input(ownerId));
    const managerId = await identity();
    await db.insert(staffRoles).values({ userId: managerId, tenantId: merchant.tenantId, locationId: merchant.locationId, role: "manager" });
    await expect(createMerchant(input(managerId))).rejects.toMatchObject({ code: "FORBIDDEN", message: expect.stringContaining("Inhaber") });
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("does not choose an arbitrary location when an established owner retries setup", async () => {
    const userId = await identity();
    const merchant = await createMerchant(input(userId));
    await db.insert(locations).values({ tenantId: merchant.tenantId, name: "Zweiter Standort", city: "Berlin", country: "DE", timezone: "Europe/Berlin" });
    await expect(createMerchant(input(userId))).rejects.toMatchObject({ code: "ALREADY_ONBOARDED", message: expect.stringContaining("Übersicht") });
    expect(await db.select().from(locations)).toHaveLength(2);
  });
});
