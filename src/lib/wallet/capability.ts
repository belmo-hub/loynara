import { appleWalletStatus } from "./apple";
import { googleWalletStatus } from "./google";
import { passFastConfig, passFastStatus } from "./passfast";

/**
 * Everything a browser may learn about Wallet: whether each provider can issue a pass on this deployment. No reasons,
 * configuration names, certificate dates, tool versions or paths; those stay in operator tooling (npm run diagnose).
 * "test_only": Google Demo Mode, where only issuer-approved test accounts can save. Production refuses Demo Mode at start.
 */
export type WalletAvailability = { apple: "available" | "unavailable"; google: "available" | "test_only" | "unavailable" };

export function walletAvailability(env: Record<string, string | undefined> = process.env, tenantId?: string, locationId?: string): WalletAvailability {
  if (env.NODE_ENV === "production" || env.PASSFAST_ENABLED === "true") {
    const ready = Boolean(tenantId && locationId) && passFastStatus(env, tenantId, locationId).ready;
    const platforms = ready ? passFastConfig(env, tenantId, locationId).platforms : [];
    return { apple: platforms.includes("apple") ? "available" : "unavailable", google: platforms.includes("google") ? "available" : "unavailable" };
  }
  const google = googleWalletStatus(env);
  return {
    apple: appleWalletStatus(env).ready ? "available" : "unavailable",
    google: !google.ready ? "unavailable" : google.publishingStatus === "published" ? "available" : "test_only",
  };
}

export function anyWalletAvailable(env: Record<string, string | undefined> = process.env): boolean {
  const availability = walletAvailability(env);
  return availability.apple !== "unavailable" || availability.google !== "unavailable";
}
