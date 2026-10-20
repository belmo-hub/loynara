import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { createMerchant, enroll, getCard, getMerchantContext, updateProgramExtras } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const originalBaseUrl = process.env.PUBLIC_BASE_URL;
beforeEach(async () => { process.env.PUBLIC_BASE_URL = "http://localhost:3000"; await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  await pool.end();
});

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, businessName = "Synthetic News Café") => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });

describe("news on the card", () => {
  it("is hidden while empty and shown as saved, trimmed", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect((await getCard(card.cardToken)).news).toBeUndefined();
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "  Neu: Kürbissuppe <heiß> & lecker  " })).toMatchObject({ cardNews: "Neu: Kürbissuppe <heiß> & lecker" });
    expect((await getCard(card.cardToken)).news).toBe("Neu: Kürbissuppe <heiß> & lecker");
    expect((await getMerchantContext(owner))?.cardNews).toBe("Neu: Kürbissuppe <heiß> & lecker");
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "" });
    expect((await getCard(card.cardToken)).news).toBeUndefined();
  });

  it("refuses more than 140 characters and links", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "a".repeat(141) })).rejects.toMatchObject({ code: "INVALID_CARD_NEWS" });
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "Mehr unter https://example.test" })).rejects.toMatchObject({ code: "INVALID_CARD_NEWS" });
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "a".repeat(140) })).toMatchObject({ cardNews: "a".repeat(140) });
  });

  it("is written only by the shop's own owner and shown only on its own cards", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const otherOwner = await user();
    const other = await shop(otherOwner, "Synthetic Other Café");
    const otherCard = await enroll({ slug: other.programSlug, acceptedTerms: true });
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, cardNews: "Fremde Nachricht" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = await user();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'manager', $3)", [merchant.tenantId, manager, merchant.locationId]);
    await expect(updateProgramExtras({ actorUserId: manager, programId: merchant.programId, cardNews: "Vom Team" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "Nur bei uns" });
    expect((await getCard(otherCard.cardToken)).news).toBeUndefined();
  });
});
