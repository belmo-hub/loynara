import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { appleWalletStatus } from "../src/lib/wallet/apple";
import { googleWalletStatus } from "../src/lib/wallet/google";
import { productionConfigIssues } from "./config-check";

const issues = productionConfigIssues({ ...process.env, NODE_ENV: "production" });
if (["var/demo-access.json", "var/preview-access.json", "var/preview.env", "var/device-test-access.json", "var/device-test.env", "var/nfc-development-keys.json"].some((file) => existsSync(path.resolve(file)))) {
  issues.push("Local demo, preview or device-test credentials exist in this application directory");
}
const apple = appleWalletStatus();
const google = googleWalletStatus();
if (apple.enabled && !apple.ready) issues.push(`Apple Wallet enabled without working configuration: ${apple.reason}`);
if (google.enabled && !google.ready) issues.push(`Google Wallet enabled without working configuration: ${google.reason}`);
if (google.enabled && google.publishingStatus !== "published") issues.push("Google Wallet demo publishing status is not approved for production");

if (issues.length) {
  console.error("Production startup rejected:");
  for (const issue of issues) console.error(`- ${issue}`);
  process.exitCode = 1;
} else {
  console.log("Production configuration gate passed.");
}
