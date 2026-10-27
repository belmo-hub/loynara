import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { productionConfigIssues } from "./config-check";
import { appleCredentialStartupIssues } from "./apple-wallet-credential";
import { googleServiceAccountStartupIssues } from "./google-wallet-credential";
import { productionWalletRuntimeIssues } from "./wallet-runtime-config";

const environment = { ...process.env, NODE_ENV: "production" as const };
const issues = productionConfigIssues(environment);
// Wallet keys delivered as values are written to their files only once the configuration passed, before the runtime check reads them.
if (!issues.length) issues.push(...googleServiceAccountStartupIssues(environment), ...appleCredentialStartupIssues(environment));
issues.push(...productionWalletRuntimeIssues(environment));
if (["var/demo-access.json", "var/preview-access.json", "var/preview.env", "var/device-test-access.json", "var/device-test.env", "var/nfc-development-keys.json"].some((file) => existsSync(path.resolve(file)))) {
  issues.push("Local demo, preview or device-test credentials exist in this application directory");
}
if (issues.length) {
  console.error("Production startup rejected:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Production configuration gate passed.");
}
