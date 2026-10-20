import { afterEach, expect, it, vi } from "vitest";
import { readPersonalExport } from "./personal-export-download";
afterEach(() => vi.unstubAllGlobals());
const names = ["programContext", "ruleVersions", "rewardVersions", "ledger", "redemptions", "purchaseAwards", "contacts", "consentEvents", "securityEvents", "contactVerificationEvents", "exportProofEvents", "nfcOutcomes", "offlineLeases", "offlineOutcomes", "referralCodes", "referrals", "campaignParticipation", "campaignAttempts", "automationParticipation", "outboxOutcomes", "emailDeliveries", "emailProviderEvents", "emailSuppression", "walletPasses", "walletRegistrations", "inactivityReviews", "retentionExceptions"];
function complete() { return { formatVersion: 2, scope: "complete-own-card-personal-data", membership: { id: "synthetic-card" }, ...Object.fromEntries(names.map(name => [name, []])) }; }
it("prepares a download only after receiving all required personal-export categories", async () => {
  const payload = JSON.stringify(complete()), fetcher = vi.fn(async () => new Response(payload));
  vi.stubGlobal("fetch", fetcher);
  expect(await (await readPersonalExport("/api/customer-data-export", { proof: "synthetic" }, new AbortController().signal)).text()).toBe(payload);
  expect(fetcher).toHaveBeenCalledWith("/api/customer-data-export", expect.objectContaining({ method: "POST", credentials: "same-origin", cache: "no-store" }));
});
it.each(["partial", "missing-category", "legacy"])("refuses %s content without preparing a downloadable blob", async kind => {
  const data = complete();
  if (kind === "missing-category") delete (data as Record<string, unknown>).retentionExceptions;
  if (kind === "legacy") data.formatVersion = 1;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(kind === "partial" ? JSON.stringify(data).slice(0, -10) : JSON.stringify(data))));
  await expect(readPersonalExport("/api/customer-data-export", {}, new AbortController().signal)).rejects.toThrow();
});
it("uses explicit assisted-access guidance for an export-size refusal", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ code: "EXPORT_ASSISTANCE_REQUIRED" }, { status: 400 })));
  await expect(readPersonalExport("/api/customer-data-export", {}, new AbortController().signal)).rejects.toThrow("begleitete Datenauskunft");
});
