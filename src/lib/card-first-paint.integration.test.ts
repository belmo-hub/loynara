import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { firstPaintQr } from "./card-first-paint";
import { closeCard } from "./card-lifecycle";
import { reissueCardByStaff } from "./card-reissue";
import { createMerchant, enroll, getCard } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", rate_limits CASCADE'); });
afterAll(async () => { await pool.end(); });

const request = () => new Request("http://card.local/card");
// The limit's row key, as rate-limit.ts derives it (scope and identity are only stored hashed).
const bucket = async (scope: string, identity: string) => (await pool.query("SELECT hits FROM rate_limits WHERE key_hash = $1",
  [createHmac("sha256", process.env.BETTER_AUTH_SECRET ?? "synthetic-test-rate-key").update(scope).update("\0").update(identity).digest("hex")])).rows[0]?.hits ?? 0;
async function card() {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, "Synthetic owner", `${owner}@example.test`]);
  const m = await createMerchant({ userId: owner, businessName: "Café Erstbild", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee", rewardCost: 8 });
  const c = await enroll({ slug: m.programSlug, acceptedTerms: true });
  return { ...c, owner, locationId: m.locationId };
}

// Web audit finding 1, option C (CTO, 22 Nov): the server's first paint gets the QR and nothing else.
describe("the card's QR in the first HTML", () => {
  it("is the very image the card draws after its own read", async () => {
    const c = await card();
    const read = await getCard(c.cardToken);
    expect(await firstPaintQr(c.cardToken, request())).toBe(`/api/qr?value=${encodeURIComponent(read.scanCode)}`);
  });

  it("gives nothing for an unknown, malformed, closed or reissued link, exactly as the page was before", async () => {
    expect(await firstPaintQr("card__unknownunknownunknownunknownunknown12", request())).toBeNull();
    expect(await firstPaintQr("not a token", request())).toBeNull();
    const closed = await card();
    await closeCard(closed.cardToken);
    expect(await firstPaintQr(closed.cardToken, request())).toBeNull();
    const old = await card();
    await reissueCardByStaff({ actorUserId: old.owner, locationId: old.locationId, membershipId: old.id, reason: "Synthetic verified lost phone", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() });
    expect(await firstPaintQr(old.cardToken, request())).toBeNull();
  });

  it("has its own limits, as strict as the card read's, and never uses the card read's", async () => {
    const c = await card();
    for (let i = 0; i < 90; i += 1) expect(await firstPaintQr(c.cardToken, request())).not.toBeNull();
    expect(await firstPaintQr(c.cardToken, request())).toBeNull();
    expect(await bucket("card_shell_token", c.cardToken)).toBeGreaterThanOrEqual(90);
    expect(await bucket("card_shell_peer", "untrusted-peer")).toBeGreaterThanOrEqual(90);
    expect(await bucket("card_read_token", c.cardToken)).toBe(0);
    expect(await bucket("card_read_peer", "untrusted-peer")).toBe(0);
    // The card's own read is untouched by the first paint's limit.
    await expect(getCard(c.cardToken)).resolves.toMatchObject({ cardLocator: expect.any(String) });
  });
});
