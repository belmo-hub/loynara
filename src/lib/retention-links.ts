import type { RetentionFilter, RetentionSummary } from "./retention";

/** Keep each customer destination on the same location and age rule as its count. */
export function retentionCustomerHref(summary: Pick<RetentionSummary, "inactiveDays" | "locationId">, activity: RetentionFilter, minAgeDays?: 7) {
  const params = new URLSearchParams({ activity });
  if (activity === "recent" || activity === "drifting") params.set("days", String(summary.inactiveDays));
  if (minAgeDays) params.set("minAgeDays", String(minAgeDays));
  if (summary.locationId) params.set("locationId", summary.locationId); else params.set("scope", "all");
  return `/merchant/customers?${params}`;
}
