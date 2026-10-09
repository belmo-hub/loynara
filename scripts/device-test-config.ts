import { isIP } from "node:net";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { googleDirectStatus } from "../src/lib/wallet/google-direct";

type DeviceTestEnv = Record<string, string | undefined>;

// URL query parameters can override checked fields in pg-connection-string.
// Requiring the exact generated URL also rejects a copied preview or live DB.
function databaseIsolated(env: DeviceTestEnv): boolean {
  return Boolean(
    env.DEVICE_TEST_DB_PASSWORD &&
    /^[0-9a-f]{64}$/.test(env.DEVICE_TEST_DB_PASSWORD) &&
    env.DATABASE_URL === `postgresql://looplocal_device:${env.DEVICE_TEST_DB_PASSWORD}@127.0.0.1:54331/looplocal_device_test`,
  );
}

export function approvedDeviceTestOrigin(value?: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    const host = url.hostname;
    const labels = host.split(".");
    return url.protocol === "https:"
      && value === url.origin
      && !url.username && !url.password && !url.search && !url.hash
      && url.pathname === "/" && !isIP(host)
      && labels.length >= 2
      && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
      && /^[a-z]{2,}$/.test(labels.at(-1) ?? "")
      && !["invalid", "test", "example", "local", "localhost"].includes(labels.at(-1) ?? "")
      && host !== "example.com";
  } catch {
    return false;
  }
}

export function deviceTestPreparationIssues(env: DeviceTestEnv): string[] {
  const issues = deviceTestDatabaseIssues(env);
  if (env.TRUSTED_INGRESS !== undefined && env.TRUSTED_INGRESS !== "local") issues.push("Synthetic preview requires local ingress policy");
  if (!env.BETTER_AUTH_SECRET || !/^[0-9a-f]{64}$/.test(env.BETTER_AUTH_SECRET)) {
    issues.push("Device test requires its generated auth secret");
  }
  if (env.LOOPLOCAL_NEXT_DIST_DIR !== ".next-device-test") issues.push("Device test requires its separate compiled build directory");
  for (const name of ["PUBLIC_REGISTRATION_ENABLED", "LIVE_BILLING_ENABLED", "APPLE_WALLET_ENABLED", "TRUST_PROXY_CLIENT_IP"]) {
    if (env[name] !== "false") issues.push(`${name} must be false in the device test`);
  }
  const transactionalEmail = env.EXTERNAL_EMAIL_ENABLED === "true";
  const promotionalEmail = env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true";
  if (transactionalEmail || promotionalEmail) {
    if (env.DEVICE_TEST_APPROVED_EMAIL_PROVIDER !== "mailgun-eu"
      || env.MAILGUN_SEND_APPROVED !== "true"
      || env.MAILGUN_EU_DOMAIN !== "mail.getloynara.com"
      || env.MAILGUN_FROM_EMAIL !== "karten@mail.getloynara.com"
      || (env.MAILGUN_EU_API_KEY?.length ?? 0) < 32
      || (env.MAILGUN_EU_WEBHOOK_SIGNING_KEY?.length ?? 0) < 32) {
      issues.push("Device-test external email requires the approved Mailgun EU sender and complete credentials");
    }
  } else if (env.EXTERNAL_EMAIL_ENABLED !== "false" || env.DEVICE_TEST_APPROVED_EMAIL_PROVIDER) {
    issues.push("Device-test external email must remain disabled without the approved provider");
  }
  if (promotionalEmail) {
    if (env.DEVICE_TEST_APPROVED_PROMOTIONAL_EMAIL_TEST !== "true"
      || env.MAILGUN_PROMOTIONAL_SEND_APPROVED !== "true"
      || env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN !== "https://unsubscribe.getloynara.com"
      || !env.PROMOTIONAL_UNSUBSCRIBE_SECRET || !/^[0-9a-f]{64}$/.test(env.PROMOTIONAL_UNSUBSCRIBE_SECRET)
      || env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT !== "2"
      || env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS !== "24"
      || env.TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED === "true") {
      issues.push("Device-test promotional email requires the separately approved bounded Mailgun EU test and public unsubscribe origin");
    }
  } else if (env.DEVICE_TEST_APPROVED_PROMOTIONAL_EMAIL_TEST === "true" || env.MAILGUN_PROMOTIONAL_SEND_APPROVED === "true") {
    issues.push("Device-test promotional approval flags must be off when promotional sending is disabled");
  }
  if (env.DEVICE_TEST_APPROVED_WALLET_PROVIDER === "google-demo") {
    // Approval values record a reviewed owner decision; they do not grant it.
    // Preparation can run the worker, so the browser gate applies here too.
    issues.push(...deviceTestAccessIssues(env), ...deviceTestGoogleIssues(env));
  } else {
    if (env.DEVICE_TEST_APPROVED_WALLET_PROVIDER) issues.push("Only an explicitly approved Google Demo provider test is supported");
    if (env.GOOGLE_WALLET_ENABLED !== "false") issues.push("GOOGLE_WALLET_ENABLED must be false without Google Demo test approval");
    if (env.GOOGLE_WALLET_ASSET_ENABLED === "true") issues.push("Google provider assets require separate routing approval");
  }
  if (env.BILLING_FIXTURE_MODE === "true") issues.push("Local billing fixture must be disabled in the device test");
  if (env.SMTP_HOST !== "disabled") issues.push("Device test must disable mail transport");
  if (env.DEMO_MODE === "true" || env.DEMO_SEED_ALLOWED === "true" || env.LOOPLOCAL_PREVIEW_SEED === "true") {
    issues.push("Other demo and preview runtime flags are forbidden");
  }
  return issues;
}

// Stopping this Compose database must remain possible after a provider key is
// removed or its approval expires. This mode never starts a worker or web app.
export function deviceTestDatabaseIssues(env: DeviceTestEnv): string[] {
  return databaseIsolated(env) ? [] : ["Device test requires its generated isolated loopback PostgreSQL database"];
}

function deviceTestAccessIssues(env: DeviceTestEnv): string[] {
  const issues: string[] = [];
  const approved = env.DEVICE_TEST_APPROVED_ORIGIN;
  if (!approvedDeviceTestOrigin(approved) || env.PUBLIC_BASE_URL !== approved || env.BETTER_AUTH_URL !== approved) {
    issues.push("Device test requires the exact approved HTTPS origin for public and auth URLs");
  }
  if (!env.DEVICE_TEST_ACCESS_TEAM || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(env.DEVICE_TEST_ACCESS_TEAM)) {
    issues.push("Device test requires the reviewed Cloudflare Access team name");
  }
  if (!env.DEVICE_TEST_ACCESS_AUD || !/^[a-zA-Z0-9_-]{16,128}$/.test(env.DEVICE_TEST_ACCESS_AUD)) {
    issues.push("Device test requires the reviewed Cloudflare Access application audience");
  }
  return issues;
}

function deviceTestGoogleIssues(env: DeviceTestEnv): string[] {
  const issues: string[] = [];
  if (env.GOOGLE_WALLET_ENABLED !== "true" || env.GOOGLE_WALLET_PUBLISHING_STATUS !== "demo") {
    issues.push("Approved Google device tests require enabled Google Wallet in Demo Mode");
  }
  if (!env.DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID || !/^\d+$/.test(env.DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID)
    || env.GOOGLE_WALLET_ISSUER_ID !== env.DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID) {
    issues.push("Google issuer must match the explicitly approved test issuer");
  }
  if (!env.DEVICE_TEST_GOOGLE_TESTER_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.DEVICE_TEST_GOOGLE_TESTER_EMAIL)) {
    issues.push("Google Demo test requires a named designated tester account");
  }
  try {
    const approved = new URL(env.DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL ?? "");
    if (!approvedDeviceTestOrigin(approved.origin) || approved.origin === env.DEVICE_TEST_APPROVED_ORIGIN
      || !/^\/api\/wallet\/assets\/google-logo\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/i.test(approved.pathname)
      || env.DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL !== `${approved.origin}${approved.pathname}`
      || env.GOOGLE_WALLET_PROGRAM_LOGO_URL !== env.DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL
      || env.GOOGLE_WALLET_ASSET_ORIGIN !== approved.origin || env.GOOGLE_WALLET_ASSET_ENABLED !== "true") throw new Error("Unapproved asset route");
  } catch {
    issues.push("Google requires one exact approved merchant PNG URL on a separate provider-facing HTTPS origin");
  }
  try {
    const filename = env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE ?? "";
    const stat = lstatSync(filename);
    const relative = path.relative(realpathSync(process.cwd()), realpathSync(filename));
    if (!path.isAbsolute(filename) || !stat.isFile() || stat.isSymbolicLink()
      || (stat.mode & 0o077) !== 0 || (stat.mode & 0o400) === 0
      || (process.getuid && stat.uid !== process.getuid())
      || (relative !== ".." && !relative.startsWith(`..${path.sep}`))) throw new Error("Unrestricted credential path");
    if (!googleDirectStatus(env).ready) throw new Error("Invalid local Google credential or Direct class approval");
  } catch {
    issues.push("Google requires a valid owner-only service-account file outside the repository (no symlink)");
  }
  return issues;
}

export function deviceTestRuntimeIssues(env: DeviceTestEnv): string[] {
  return [...new Set([...deviceTestPreparationIssues(env), ...deviceTestAccessIssues(env)])];
}
