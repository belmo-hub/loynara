import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { locations, staffRoles } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { createMerchant, enroll, getCard, getMerchantContext, getPublicProgram } from "./product";
import sharp from "sharp";
import { getMerchantBrand, updateMerchantBrand } from "./merchant-brand";
import { ownerWalletReadiness } from "./wallet/readiness";
import { walletPassDataByMembershipId } from "./wallet/data";
import { GET as getGoogleLogo } from "@/app/api/wallet/assets/google-logo/[programId]/route";
import { GET as getGoogleWideLogo } from "@/app/api/wallet/assets/google-wide-logo/[programId]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Brand tests require looplocal_test");
// A 32 x 32 red square: big enough for the 16 px minimum; the save path stores it re-encoded (ENG-134).
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAARUlEQVRYhe3XsREAMAhC0ezDBGzvZmaLpHmFvXcifM40+3OOBcYJSoTxhsuIhhVXGEUcLyAZSFZQGli+ismoZlVO81wHF3vljHlao/5+AAAAAElFTkSuQmCC";

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
  it("setup validates the logo like the studio: a renamed JPEG is refused (ENG-134)", async () => {
    const ownerId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic setup owner", `${ownerId}@example.test`]);
    const jpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#c0392b" } }).jpeg().toBuffer();
    await expect(createMerchant({
      userId: ownerId, businessName: "Renamed Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
      logoData: `data:image/png;base64,${jpeg.toString("base64")}`,
    })).rejects.toMatchObject({ code: "INVALID_LOGO" });
  });

  it("readiness says low_contrast for a dark wordmark on a dark colour, and the brand read says so too (ENG-134)", async () => {
    const { ownerId, merchant } = await fixture();
    const dark = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="360" height="120"><g fill="#111"><rect width="100" height="120"/><rect x="130" y="30" width="100" height="90"/><rect x="260" width="100" height="60"/></g></svg>`)).png().toBuffer();
    await updateMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#1f4a3a", logoData: `data:image/png;base64,${dark.toString("base64")}` });
    expect(await ownerWalletReadiness({ actorUserId: ownerId, programSlug: merchant.programSlug })).toMatchObject({ logo: "low_contrast" });
    expect((await getMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug })).logoWallet).toMatchObject({ faint: true, showName: true });
  });

  it("persists owner edits and exposes them on the actual public programme and card", async () => {
    const { ownerId, merchant } = await fixture();
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const saved = await updateMerchantBrand({
      actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "After Café", locationName: "After Mitte",
      brandColor: "#1f4d3f", logoData: tinyPng,
    });
    expect(saved).toMatchObject({ businessName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f", logoData: expect.stringMatching(/^data:image\/png;base64,/), logoWallet: { showName: true, faint: false, upscaled: true } });
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
    // A non-owner never reaches the image decoder: the ownership check answers first (ENG-134).
    await expect(updateMerchantBrand({ actorUserId: otherOwner, programSlug: first.merchant.programSlug, businessName: "Unauthorized", locationName: "Nope", brandColor: "#123456", logoData: "data:image/png;base64,ZmFrZQ==" })).rejects.toMatchObject({ code: "FORBIDDEN" });
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
    for (const id of [ownerId, ...Object.values(staff)]) expect(JSON.stringify(await getMerchantContext(id))).not.toContain("data:image/png");
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
      // ENG-153: a square logo has no wide asset; a wide one gets the 1280 x 400 PNG and the initial in the circle.
      expect(pass.googleWideLogoUrl).toBeUndefined();
      expect((await getGoogleWideLogo(request, routeContext)).status).toBe(404);
      const wide = await sharp({ create: { width: 600, height: 150, channels: 4, background: "#ffffff" } }).png().toBuffer();
      await updateMerchantBrand({ actorUserId: ownerId, programSlug: merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#2f6b58", logoData: `data:image/png;base64,${wide.toString("base64")}` });
      const widePass = await walletPassDataByMembershipId(card.id);
      expect(widePass.googleWideLogoUrl).toMatch(new RegExp(`/api/wallet/assets/google-wide-logo/${merchant.programId}\\.png\\?v=[0-9a-f]{16}$`));
      const wideResponse = await getGoogleWideLogo(request, routeContext);
      expect(wideResponse.status).toBe(200);
      expect(await sharp(Buffer.from(await wideResponse.arrayBuffer())).metadata()).toMatchObject({ width: 1280, height: 400, hasAlpha: true });
      expect(await sharp(Buffer.from(await (await getGoogleLogo(request, routeContext)).arrayBuffer())).metadata()).toMatchObject({ width: 660, height: 660 });
    } finally {
      if (previousEnabled === undefined) delete process.env.GOOGLE_WALLET_ASSET_ENABLED;
      else process.env.GOOGLE_WALLET_ASSET_ENABLED = previousEnabled;
      if (previousOrigin === undefined) delete process.env.GOOGLE_WALLET_ASSET_ORIGIN;
      else process.env.GOOGLE_WALLET_ASSET_ORIGIN = previousOrigin;
    }
  });
});
