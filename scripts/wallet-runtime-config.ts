import { appleWalletStatus } from "../src/lib/wallet/apple";
import { googleWalletStatus } from "../src/lib/wallet/google";

/** Shared web/worker startup check. Local file/tool inspection only; no database or provider requests. */
export function productionWalletRuntimeIssues(env: Record<string, string | undefined> = process.env): string[] {
  if (env.NODE_ENV !== "production") return [];
  const issues: string[] = [];
  const apple = appleWalletStatus(env), google = googleWalletStatus(env);
  if (apple.enabled && !apple.ready) issues.push(`Apple Wallet enabled without working configuration: ${apple.reason}`);
  if (google.enabled && !google.ready) issues.push(`Google Wallet enabled without working configuration: ${google.reason}`);
  if (google.enabled && google.publishingStatus !== "published") issues.push("Google Wallet demo publishing status is not approved for production");
  return issues;
}
