import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { createMerchant, enroll } from "@/lib/product";
import { applePassToken } from "./apple";
import { listUpdatedApplePasses, registerAppleDevice, unregisterAppleDevice } from "./apple-service";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "secret".repeat(8) };
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function createMember() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Wallet fixture", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Fixture Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 8 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await db.insert(walletPasses).values({ tenantId: merchant.tenantId, membershipId: member.id, provider: "apple", providerObjectId: member.id, status: "issued" });
  return member;
}

describe("Apple pass update web service state", () => {
  it("authenticates registration, returns changed serials, and removes the device on unregistration", async () => {
    const member = await createMember();
    const input = { deviceId: "fixture-device", passTypeId: config.passTypeId, serial: member.id, authorization: `ApplePass ${applePassToken(member.id, config)}`, pushToken: "a".repeat(64) };
    expect(await registerAppleDevice(input, config)).toBe(201);
    expect(await registerAppleDevice(input, config)).toBe(200);
    const first = await listUpdatedApplePasses("fixture-device", config.passTypeId);
    expect(first?.serialNumbers).toEqual([member.id]);
    expect(await listUpdatedApplePasses("fixture-device", config.passTypeId, first?.lastUpdated)).toBeNull();
    await pool.query("UPDATE wallet_passes SET updated_at = updated_at + interval '2 milliseconds' WHERE membership_id = $1", [member.id]);
    const changed = await listUpdatedApplePasses("fixture-device", config.passTypeId, first?.lastUpdated);
    expect(changed?.serialNumbers).toEqual([member.id]);
    await unregisterAppleDevice(input, config);
    expect(await db.select().from(appleRegistrations)).toHaveLength(0);
    expect(await db.select().from(appleDevices)).toHaveLength(0);
  });

  it("rejects a wrong pass token without registering a device", async () => {
    const member = await createMember();
    await expect(registerAppleDevice({ deviceId: "fixture-device", passTypeId: config.passTypeId, serial: member.id, authorization: "ApplePass wrong", pushToken: "a".repeat(64) }, config)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(appleDevices)).toHaveLength(0);
  });
});
