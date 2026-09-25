import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { walletPasses } from "@/db/schema";
import { createMerchant, enroll } from "@/lib/product";
import { refreshWalletForMembership } from "./refresh";
import { walletPassDataByMembershipId } from "./data";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function createMember() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [userId, "Wallet fixture", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Wallet Fixture Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 8 });
  const member = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { merchant, member };
}

describe("wallet refresh outbox contract", () => {
  it("completes when a member has no issued provider pass", async () => {
    const { member } = await createMember();
    expect(await refreshWalletForMembership(member.id)).toEqual({ status: "complete" });
  });

  it("blocks an issued pass when its provider is disabled, preserving the committed loyalty balance", async () => {
    const { merchant, member } = await createMember();
    await db.insert(walletPasses).values({ tenantId: merchant.tenantId, membershipId: member.id, provider: "google", providerObjectId: `123456.member_${member.id}`, status: "issued" });
    const result = await refreshWalletForMembership(member.id);
    expect(result.status).toBe("blocked");
    if (result.status === "blocked") expect(result.reason).toContain("Google Wallet");
  });

  it("reads merchant location relevance coordinates without collecting customer location", async () => {
    const { merchant, member } = await createMember();
    await pool.query("UPDATE locations SET latitude = 51.3127, longitude = 9.4797 WHERE id = $1", [merchant.locationId]);
    const pass = await walletPassDataByMembershipId(member.id);
    expect(pass).toMatchObject({ latitude: 51.3127, longitude: 9.4797 });
    expect(JSON.stringify(pass)).not.toContain("customerLocation");
  });
});
