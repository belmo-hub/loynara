import { describe, expect, it, vi } from "vitest";
import type { MerchantAnalytics } from "./merchant-analytics";
import { buildRuleBasedAdvice, runModelAdvice, type AdviceModelProvider } from "./adviser";
import { RETENTION_RULES, type RetentionSummary } from "./retention";

function retention(overrides: Partial<RetentionSummary> = {}): RetentionSummary {
  return { asOf: "2030-01-31T00:00:00.000Z", inactiveDays: 30, locationId: null, openCards: 20, recent: 20, drifting: 0, never: 0, neverAfterWeek: 0,
    nearReward: 0, rewardReady: 0, driftingWeekAgo: 0, nearRewardMaxRemaining: 2, rules: RETENTION_RULES, ...overrides };
}

function report(overrides: Partial<MerchantAnalytics> = {}): MerchantAnalytics {
  return {
    windowDays: 30, from: "2030-01-01T00:00:00.000Z", asOf: "2030-01-31T00:00:00.000Z", timezone: "UTC",
    currentActiveCards: 0, newCards: 0, qualifyingCheckouts: 0, participatingCards: 0, repeatCards: 0,
    issued: { stampUnits: 0, pointUnits: 0, awardActions: 0 },
    rewards: { redemptions: 0, topTitles: [] },
    referrals: { attributed: 0, qualified: 0, reversed: 0 },
    campaignAttempts: { total: 0, complete: 0, suppressed: 0, retry: 0, failed: 0, blocked: 0 },
    series: [], countingRule: "Distinct confirmed checkouts", limits: { availableWindowsDays: [30, 90], bucketDays: 7, topRewardTitles: 5 },
    ...overrides,
  };
}

describe("retention signals in rule-based advice", () => {
  const active = report({ currentActiveCards: 20, participatingCards: 12, repeatCards: 8, qualifyingCheckouts: 30, rewards: { redemptions: 0, topTitles: [] } });

  it("flags growing lapsed cards only when the count actually grew, with a link to those cards", () => {
    const grew = buildRuleBasedAdvice(active, retention({ drifting: 6, driftingWeekAgo: 3 }));
    expect(grew.find(item => item.id === "lapsed_growing")).toMatchObject({ observed: [{ value: 6 }, { value: 3 }], link: { href: "/merchant/customers?activity=drifting&days=30" } });
    expect(buildRuleBasedAdvice(active, retention({ drifting: 6, driftingWeekAgo: 6 })).map(item => item.id)).not.toContain("lapsed_growing");
    expect(buildRuleBasedAdvice(active, retention({ drifting: 2, driftingWeekAgo: 0 })).map(item => item.id)).not.toContain("lapsed_growing");
  });

  it("replaces the generic reward-path hint with waiting rewards when cards already qualify", () => {
    const waiting = buildRuleBasedAdvice(active, retention({ rewardReady: 2 })).map(item => item.id);
    expect(waiting).toContain("reward_waiting");
    expect(waiting).not.toContain("reward_path");
    expect(buildRuleBasedAdvice(active, retention()).map(item => item.id)).toContain("reward_path");
  });

  it("points at the counter process when many sign-ups were never stamped, and never claims a cause", () => {
    const advice = buildRuleBasedAdvice(active, retention({ neverAfterWeek: 6, openCards: 20 }));
    const item = advice.find(entry => entry.id === "signup_not_stamped");
    expect(item?.missingInformation.join(" ")).toContain("nicht unterscheidbar");
    expect(buildRuleBasedAdvice(active, retention({ neverAfterWeek: 3, openCards: 40 })).map(entry => entry.id)).not.toContain("signup_not_stamped");
  });
});

describe("rule-based merchant advice", () => {
  it("uses recorded checkout counts and states when unrecorded visits are unknown", () => {
    const advice = buildRuleBasedAdvice(report({ currentActiveCards: 2, newCards: 2 }));
    expect(advice[0]).toMatchObject({ id: "checkout_flow", observed: [{ label: "Aktive Karten", value: 2 }, { label: "Bestätigte Kassenvorgänge", value: 0 }] });
    expect(advice[0].reasoning).toContain("0 bestätigten Kassenvorgängen");
    expect(advice[0].missingInformation.join(" ")).toContain("nicht erfasste Besuche");
    expect(advice[0].nextAction).toContain("Kassenvorgang");
    expect(JSON.stringify(advice)).not.toContain("KI");
  });

  it("changes the repeat-participation suggestion when actual checkout activity changes", () => {
    const low = buildRuleBasedAdvice(report({ currentActiveCards: 10, participatingCards: 10, repeatCards: 1, qualifyingCheckouts: 11, rewards: { redemptions: 1, topTitles: [] } }));
    expect(low.map(item => item.id)).toContain("repeat_participation");
    const higher = buildRuleBasedAdvice(report({ currentActiveCards: 10, participatingCards: 10, repeatCards: 5, qualifyingCheckouts: 15, rewards: { redemptions: 1, topTitles: [] } }));
    expect(higher.map(item => item.id)).not.toContain("repeat_participation");
    expect(low.every(item => item.observed.length > 0 && item.reasoning && item.missingInformation.length > 0 && item.nextAction)).toBe(true);
  });

  it("reports local delivery failures as attempts, not proof of merchant sales", () => {
    const advice = buildRuleBasedAdvice(report({ campaignAttempts: { total: 3, complete: 1, suppressed: 0, retry: 0, failed: 2, blocked: 0 } }));
    expect(advice.map(item => item.id)).toContain("delivery_failures");
    expect(JSON.stringify(advice)).not.toMatch(/incremental sales|Umsatzsteigerung/);
  });
});

describe("disabled model provider boundary", () => {
  const provider = (output: unknown): AdviceModelProvider => ({
    id: "synthetic-test-provider", inputCostPerMillionMinor: 100, outputCostPerMillionMinor: 100,
    generate: vi.fn().mockResolvedValue(output),
  });

  it("never invokes a provider without both runtime enablement and a run approval", async () => {
    const adapter = provider({ recommendations: [] });
    const metrics = report({ currentActiveCards: 3 });
    await expect(runModelAdvice({ report: metrics, provider: adapter, policy: { enabled: false, approvedForRun: true, maxCostMinor: 1 } })).rejects.toMatchObject({ code: "MODEL_DISABLED" });
    await expect(runModelAdvice({ report: metrics, provider: adapter, policy: { enabled: true, approvedForRun: false, maxCostMinor: 1 } })).rejects.toMatchObject({ code: "APPROVAL_REQUIRED" });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it("enforces a worst-case cost cap before invoking a provider", async () => {
    const adapter = provider({ recommendations: [] });
    await expect(runModelAdvice({ report: report(), provider: adapter, policy: { enabled: true, approvedForRun: true, maxCostMinor: 0 } })).rejects.toMatchObject({ code: "MODEL_BUDGET" });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it("rejects non-finite or out-of-range input metrics before invoking a provider", async () => {
    const adapter = provider({ recommendations: [] });
    await expect(runModelAdvice({ report: report({ currentActiveCards: Number.NaN }), provider: adapter, policy: { enabled: true, approvedForRun: true, maxCostMinor: 10 } })).rejects.toMatchObject({ code: "MODEL_INPUT_INVALID" });
    await expect(runModelAdvice({ report: report({ currentActiveCards: 1_000_000_001 }), provider: adapter, policy: { enabled: true, approvedForRun: true, maxCostMinor: 10 } })).rejects.toMatchObject({ code: "MODEL_INPUT_INVALID" });
    expect(adapter.generate).not.toHaveBeenCalled();
  });

  it("passes bounded numeric metrics only and rejects malformed structured output", async () => {
    const adapter = provider({ recommendations: [{ id: "bad", title: "Call everyone", observed: [], reasoning: "send", missingInformation: [], nextAction: "Send email automatically", action: "send_campaign" }] });
    await expect(runModelAdvice({ report: report({ currentActiveCards: 3 }), provider: adapter, policy: { enabled: true, approvedForRun: true, maxCostMinor: 10 } })).rejects.toMatchObject({ code: "MODEL_OUTPUT_INVALID" });
    expect(adapter.generate).toHaveBeenCalledTimes(1);
    const request = vi.mocked(adapter.generate).mock.calls[0][0];
    expect(request.maxOutputTokens).toBeLessThanOrEqual(512);
    expect(JSON.stringify(request)).not.toContain("membership");
    expect(JSON.stringify(request)).not.toContain("email");
    expect(JSON.stringify(request)).not.toContain("cardToken");
  });
});
