import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { appleDevices, appleRegistrations, walletPasses } from "@/db/schema";
import { createMerchant, enroll } from "@/lib/product";
import { applePassToken } from "./apple";
import { authenticatedApplePass, listUpdatedApplePasses, registerAppleDevice, unregisterAppleDevice } from "./apple-service";
import { issueWalletPass } from "./issue";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "secret".repeat(8) };
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.query("TRUNCATE TABLE apple_devices CASCADE"); await pool.end(); });

async function createMember(businessName = "Fixture Café") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Wallet fixture", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 8 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  const pass = await issueWalletPass(member.cardToken, "apple", id => id);
  return { merchant, member, pass };
}
const auth = (serial: string) => `ApplePass ${applePassToken(serial, config)}`;
const registration = (serial: string, deviceId = "fixture-device") => ({ deviceId, passTypeId: config.passTypeId, serial, authorization: auth(serial), pushToken: "a".repeat(64) });

describe("Apple pass web service", () => {
  it("authenticates registration, lists changed serials by tag and removes the device on unregistration", async () => {
    const { member, pass } = await createMember();
    expect(await registerAppleDevice(registration(pass.id), config)).toBe(201);
    expect(await registerAppleDevice(registration(pass.id), config)).toBe(200);
    expect((await db.select().from(walletPasses).where(eq(walletPasses.id, pass.id)))[0].status).toBe("registered");
    expect((await db.select().from(appleRegistrations))[0]).toMatchObject({ membershipId: member.id, serialNumber: pass.id });
    const first = await listUpdatedApplePasses("fixture-device", config.passTypeId);
    expect(first?.serialNumbers).toEqual([pass.id]);
    expect(await listUpdatedApplePasses("fixture-device", config.passTypeId, first?.lastUpdated)).toBeNull();
    await pool.query("UPDATE wallet_passes SET updated_at = updated_at + interval '2 milliseconds' WHERE id = $1", [pass.id]);
    expect((await listUpdatedApplePasses("fixture-device", config.passTypeId, first?.lastUpdated))?.serialNumbers).toEqual([pass.id]);
    await expect(listUpdatedApplePasses("fixture-device", config.passTypeId, "yesterday")).rejects.toMatchObject({ code: "INVALID_TAG" });
    await unregisterAppleDevice(registration(pass.id), config);
    expect(await db.select().from(appleRegistrations)).toHaveLength(0);
    expect(await db.select().from(appleDevices)).toHaveLength(0);
  });

  it("answers a wrong token, an unknown serial, a foreign pass type and a malformed header identically, without side effects", async () => {
    const { pass } = await createMember();
    const unknown = randomUUID();
    const attempts = [
      { ...registration(pass.id), authorization: "ApplePass wrong-token-but-long-enough" },
      { ...registration(unknown), authorization: auth(unknown) }, // a valid token for a serial that does not exist
      { ...registration(pass.id), passTypeId: "pass.other.loop" },
      { ...registration(pass.id), authorization: applePassToken(pass.id, config) }, // missing scheme
      { ...registration(pass.id), serial: pass.membershipId, authorization: auth(pass.membershipId) }, // the membership id is not a serial
    ];
    for (const attempt of attempts) await expect(registerAppleDevice(attempt, config)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(appleDevices)).toHaveLength(0);
    await expect(registerAppleDevice({ ...registration(pass.id), deviceId: "../etc" }, config)).rejects.toMatchObject({ code: "INVALID_DEVICE" });
    await expect(registerAppleDevice({ ...registration(pass.id), pushToken: "not-hex" }, config)).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("keeps tenants apart: one merchant's pass token never opens another merchant's pass", async () => {
    const a = await createMember("Café A");
    const b = await createMember("Café B");
    await expect(authenticatedApplePass({ passTypeId: config.passTypeId, serial: b.pass.id, authorization: auth(a.pass.id) }, config)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await authenticatedApplePass({ passTypeId: config.passTypeId, serial: b.pass.id, authorization: auth(b.pass.id) }, config)).toMatchObject({ kind: "active", pass: { merchantName: "Café B", tenantId: b.merchant.tenantId } });
    // Registrations always take tenant and card from the pass row, never from the request.
    await registerAppleDevice(registration(a.pass.id, "device-a"), config);
    expect((await db.select().from(appleRegistrations))[0]).toMatchObject({ tenantId: a.merchant.tenantId, membershipId: a.member.id });
    expect(await listUpdatedApplePasses("device-a", config.passTypeId)).toMatchObject({ serialNumbers: [a.pass.id] });
    expect(await listUpdatedApplePasses("device-b", config.passTypeId)).toBeNull();
  });

  it("serves a voided pass, never the current QR code, when the pass no longer matches the card's credential", async () => {
    const { member, pass } = await createMember();
    // Simulate a credential change that bypassed revocation (defence in depth): the row stays unrevoked.
    await pool.query("UPDATE memberships SET scan_code = $1 WHERE id = $2", [`sc_${randomUUID().replaceAll("-", "")}`, member.id]);
    const view = await authenticatedApplePass({ passTypeId: config.passTypeId, serial: pass.id, authorization: auth(pass.id) }, config);
    expect(view).toMatchObject({ kind: "void", pass: { reason: "superseded" } });
    expect(JSON.stringify(view)).not.toMatch(/sc_[0-9a-f]{32}/);
    await expect(registerAppleDevice(registration(pass.id), config)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
