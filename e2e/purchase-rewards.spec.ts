import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("saved purchase rule and reward catalogue drive checkout through authenticated routes", async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    const email = `points-${randomUUID()}@example.test`;
    const signUp = await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic points merchant", email, password: `Local!${randomUUID()}Aa` } });
    expect(signUp.status()).toBe(200);

    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Points Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3,
      rulesText: "Drei Punkte je vollem Euro Einkaufswert; Punkte werden abgerundet.", rewardTitle: "Großer Kaffee", rewardCost: 30,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug } = await onboard.json() as { programSlug: string };

    const created = await owner.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Kleiner Kaffee", cost: 14, termsText: "Ein kleiner Kaffee." } });
    expect(created.status()).toBe(201);
    const { rewardId: smallRewardId } = await created.json() as { rewardId: string };
    const managed = await owner.get(`/api/merchant/program/rewards?programSlug=${encodeURIComponent(programSlug)}`);
    expect(managed.status()).toBe(200);
    const { rewards: managedRewards } = await managed.json() as { rewards: Array<{ rewardId: string; title: string }> };
    expect(managedRewards.map(row => row.title)).toEqual(["Großer Kaffee", "Kleiner Kaffee"]);
    expect((await owner.post("/api/merchant/program/rewards", { data: {
      action: "reorder", programSlug, rewardIds: [smallRewardId, managedRewards[0].rewardId],
    } })).status()).toBe(200);

    const publicResponse = await guest.get(`/api/program/${encodeURIComponent(programSlug)}`);
    expect(publicResponse.status()).toBe(200);
    const publicProgram = await publicResponse.json() as { earningMode: string; currency: string; rewards: Array<{ id: string; title: string; cost: number }> };
    expect(publicProgram).toMatchObject({ earningMode: "purchase", currency: "EUR" });
    expect(publicProgram.rewards.map(row => [row.title, row.cost])).toEqual([["Kleiner Kaffee", 14], ["Großer Kaffee", 30]]);

    const enrollment = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(enrollment.status()).toBe(201);
    const { cardToken } = await enrollment.json() as { cardToken: string };
    const initialCard = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(initialCard.status()).toBe(200);
    const { scanCode } = await initialCard.json() as { scanCode: string };
    const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
    expect(lookup.status()).toBe(200);
    const customer = await lookup.json() as { membershipId: string; ruleVersionId: string; rewards: Array<{ id: string; title: string }> };
    expect(customer.rewards.map(row => row.title)).toEqual(["Kleiner Kaffee", "Großer Kaffee"]);

    const awardData = { membershipId: customer.membershipId, purchaseAmountMinor: 499, ruleVersionId: customer.ruleVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const firstAward = await owner.post("/api/cashier/award", { data: awardData });
    expect(firstAward.status()).toBe(200);
    expect(await firstAward.json()).toMatchObject({ balance: 14, creditedQuantity: 14, duplicate: false });
    const retry = await owner.post("/api/cashier/award", { data: awardData });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({ balance: 14, duplicate: true });

    const cardAfterAward = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(cardAfterAward.status()).toBe(200);
    expect(await cardAfterAward.json()).toMatchObject({ balance: 14 });
    const rewardVersionId = customer.rewards.find(row => row.title === "Kleiner Kaffee")?.id;
    expect(rewardVersionId).toBeTruthy();
    const redeem = await owner.post("/api/cashier/redeem", { data: {
      membershipId: customer.membershipId, rewardVersionId, idempotencyKey: randomUUID(), requestId: randomUUID(),
    } });
    expect(redeem.status()).toBe(200);
    expect(await redeem.json()).toMatchObject({ balance: 0, duplicate: false });
    const reopened = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect(reopened.status()).toBe(200);
    expect(await reopened.json()).toMatchObject({ balance: 0 });

    const activity = await owner.get(`/api/merchant/customers/${customer.membershipId}`);
    expect(activity.status()).toBe(200);
    const detail = await activity.json() as { member: { qualifyingCheckouts: number; purchaseCount: number; redemptionCount: number }; timeline: Array<{ kind: string; delta: number; rewardTitle: string | null }> };
    expect(detail.member).toMatchObject({ qualifyingCheckouts: 1, purchaseCount: 1, redemptionCount: 1 });
    expect(detail.timeline.map(row => [row.kind, row.delta, row.rewardTitle])).toEqual([["redeem", -14, "Kleiner Kaffee"], ["award", 14, null]]);
  } finally {
    await Promise.all([owner.dispose(), guest.dispose()]);
  }
});
