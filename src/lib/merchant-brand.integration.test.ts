import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll, getCard, getPublicProgram } from "./product";
import { getMerchantBrand, updateMerchantBrand } from "./merchant-brand";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Brand tests require looplocal_test");
const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+iBncAAAAASUVORK5CYII=";

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

  it("rejects a different merchant owner and a mislabeled logo", async () => {
    const first = await fixture();
    const otherOwner = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [otherOwner, "Other synthetic owner", `${otherOwner}@example.test`]);
    await createMerchant({ userId: otherOwner, businessName: "Other Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Other card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
    await expect(updateMerchantBrand({ actorUserId: otherOwner, programSlug: first.merchant.programSlug, businessName: "Unauthorized", locationName: "Nope", brandColor: "#123456" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateMerchantBrand({ actorUserId: first.ownerId, programSlug: first.merchant.programSlug, businessName: "Before Café", locationName: "Before Mitte", brandColor: "#123456", logoData: "data:image/png;base64,ZmFrZQ==" })).rejects.toMatchObject({ code: "INVALID_LOGO" });
  });
});
