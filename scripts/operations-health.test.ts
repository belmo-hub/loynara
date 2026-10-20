import { describe, expect, it } from "vitest";
import { operationsAlerts } from "./operations-health";

const healthy = { failed: 0, blocked: 0, overdue: 0, expiredLeases: 0, emailFailures: 0, errors: 0, rateLimited: 0, pushFailures: 0, walletFailures: 0, budgetWarnings: 0, overdueCards: 0, overdueTenants: 0, holdReviews: 0, remoteIncomplete: 0, unclassifiedTenants: 0 };
describe("actionable operations alerts", () => {
  it("accepts only complete valid measurements", () => {
    expect(operationsAlerts(healthy)).toEqual([]);
    for (const invalid of [NaN, Infinity, -1, 0.5]) expect(operationsAlerts({ ...healthy, failed: invalid })).toContain("invalid_measurement");
    expect(operationsAlerts({} as typeof healthy)).toContain("invalid_measurement");
  });
  it.each(["failed", "blocked", "overdue", "expiredLeases", "emailFailures", "errors", "pushFailures", "walletFailures", "budgetWarnings", "overdueCards", "overdueTenants", "holdReviews", "remoteIncomplete", "unclassifiedTenants"] as const)("alerts on %s even when other checks are healthy", field => {
    expect(operationsAlerts({ ...healthy, [field]: 1 })).not.toEqual([]);
  });
  it("alerts at 100 rate-limit refusals in the five-minute window", () => {
    expect(operationsAlerts({ ...healthy, rateLimited: 99 })).toEqual([]);
    expect(operationsAlerts({ ...healthy, rateLimited: 100 })).toContain("rate_limit_spike");
  });
});
