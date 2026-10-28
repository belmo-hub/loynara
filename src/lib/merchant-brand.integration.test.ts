import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { locations, staffRoles } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { createMerchant, enroll, getCard, getMerchantContext, getPublicProgram } from "./product";
import { getMerchantBrand, updateMerchantBrand } from "./merchant-brand";
import { walletPassDataByMembershipId } from "./wallet/data";
import { GET as getGoogleLogo } from "@/app/api/wallet/assets/google-logo/[programId]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Brand tests require looplocal_test");
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic brand owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({
    userId: ownerId, businessName: "Before Café", locationName: "Before Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin",
    locale: "de", currency: "EUR", programName: "Before card", programType: "stamp", rulesText: "One stamp per confirmed checkout.",
    rewardTitle: "Coffee", rewardCost: 5, brandColor: "#2f6b58",
  });
  return { ownerId, merchant };
}

describe("merchant brand editor", () => {
  it("persists owner edits and exposes them on the actual public programme and card", async () => {
    const { ownerId, merchant } = await fixture();
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const saved = await updateMerchantBrand({
      actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "After Café", locationName: "After Mitte",
      brandColor: "#1f4d3f", logoData: tinyPng,
    });
    expect(saved).toMatchObject({ businessName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f", logoData: tinyPng });
    expect(await getMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug })).toMatchObject(saved);
    expect(await getPublicProgram(merchant.programSlug)).toMatchObject({ businessName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f" });
    expect(await getCard(card.cardToken)).toMatchObject({ merchantName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f" });
  });

  it("rejects cashier and different-merchant access and a mislabeled logo", async () => {
    const first = await fixture();
    const otherOwner = randomUUID();
    const cashier = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [otherOwner, "Other synthetic owner", `${otherOwner}@example.test`]);
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [cashier, "Synthetic cashier", `${cashier}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: first.merchant.tenantId, locationId: first.merchant.locationId, userId: cashier, role: "cashier" });
    await createMerchant({ userId: otherOwner, businessName: "Other Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Other card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
    await expect(getMerchantBrand({ actorUserId: cashier, programSlug: first.merchant.programSlug })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMerchantBrand({ actorUserId: otherOwner, programSlug: first.merchant.programSlug, businessName: "Unauthorized", locationName: "Nope", brandColor: "#123456" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMerchantBrand({ actorUserId: first.ownerId, programSlug: first.merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#123456", logoData: "data:image/png;base64,ZmFrZQ==" })).rejects.toMatchObject({ code: "INVALID_LOGO" });
  });

  it("puts the colour, never the logo, into /api/me for exactly the people the brand read lets in", async () => {
    const { ownerId, merchant } = await fixture();
    await updateMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#1f4d3f", logoData: tinyPng });
    const north = await createAdditionalLocation(ownerId, { name: "Before Nord", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "North card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
    await updateMerchantBrand({ actorUserId: ownerId, programSlug: north.programSlug, businessName: "Before Café", locationName: "Before Nord", brandColor: "#a8492c" });
    const staff = { manager: randomUUID(), cashier: randomUUID() };
    for (const [role, id] of Object.entries(staff)) {
      await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, `Synthetic ${role}`, `${id}@example.test`]);
      await db.insert(staffRoles).values({ tenantId: merchant.tenantId, locationId: merchant.locationId, userId: id, role });
    }
    expect(await getMerchantContext(ownerId)).toMatchObject({ locationId: merchant.locationId, brandColor: "#1f4d3f" });
    expect(await getMerchantContext(ownerId, north.locationId)).toMatchObject({ locationId: north.locationId, brandColor: "#a8492c" });
    for (const id of Object.values(staff)) {
      await expect(getMerchantBrand({ actorUserId: id, programSlug: merchant.programSlug })).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await getMerchantContext(id))?.brandColor).toBeUndefined();
    }
    for (const id of [ownerId, ...Object.values(staff)]) expect(JSON.stringify(await getMerchantContext(id))).not.toContain(tinyPng.split(",")[1]);
    // The column has no CHECK: a stored value that is not #RRGGBB is left out, so the preview keeps its fallback colour.
    await db.update(locations).set({ brandColor: "red" }).where(eq(locations.id, merchant.locationId));
    expect((await getMerchantContext(ownerId))?.brandColor).toBeUndefined();
  });

  it("keeps the Google PNG route disabled by default and resolves a saved merchant logo only with an approved origin", async () => {
    const { ownerId, merchant } = await fixture();
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await updateMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#2f6b58", logoData: tinyPng });
    const request = new Request(`https://assets.example.test/api/wallet/assets/google-logo/${merchant.programId}.png`);
    const routeContext = { params: Promise.resolve({ programId: `${merchant.programId}.png` }) };
    expect((await getGoogleLogo(request, routeContext)).status).toBe(404);
    const previousEnabled = process.env.GOOGLE_WALLET_ASSET_ENABLED;
    const previousOrigin = process.env.GOOGLE_WALLET_ASSET_ORIGIN;
    try {
      process.env.GOOGLE_WALLET_ASSET_ENABLED = "true";
      process.env.GOOGLE_WALLET_ASSET_ORIGIN = "https://assets.example.test";
      const pass = await walletPassDataByMembershipId(card.id);
      expect(pass.googleLogoUrl).toMatch(new RegExp(`/api/wallet/assets/google-logo/${merchant.programId}\\.png\\?v=`));
      const response = await getGoogleLogo(request, routeContext);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe("image/png");
      expect(Buffer.from(await response.arrayBuffer()).toString("hex", 0, 8)).toBe("89504e470d0a1a0a");
      expect((await getGoogleLogo(request, { params: Promise.resolve({ programId: `${randomUUID()}.png` }) })).status).toBe(404);
    } finally {
      if (previousEnabled === undefined) delete process.env.GOOGLE_WALLET_ASSET_ENABLED;
      else process.env.GOOGLE_WALLET_ASSET_ENABLED = previousEnabled;
      if (previousOrigin === undefined) delete process.env.GOOGLE_WALLET_ASSET_ORIGIN;
      else process.env.GOOGLE_WALLET_ASSET_ORIGIN = previousOrigin;
    }
  });
});
