import { isIP } from "node:net";

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
  const issues: string[] = [];
  if (!databaseIsolated(env)) issues.push("Device test requires its generated isolated loopback PostgreSQL database");
  if (!env.BETTER_AUTH_SECRET || !/^[0-9a-f]{64}$/.test(env.BETTER_AUTH_SECRET)) {
    issues.push("Device test requires its generated auth secret");
  }
  if (env.LOOPLOCAL_NEXT_DIST_DIR !== ".next-device-test") issues.push("Device test requires its separate compiled build directory");
  for (const name of ["PUBLIC_REGISTRATION_ENABLED", "EXTERNAL_EMAIL_ENABLED", "LIVE_BILLING_ENABLED", "APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "TRUST_PROXY_CLIENT_IP"]) {
    if (env[name] !== "false") issues.push(`${name} must be false in the device test`);
  }
  if (env.SMTP_HOST !== "disabled") issues.push("Device test must disable mail transport");
  if (env.DEMO_MODE === "true" || env.DEMO_SEED_ALLOWED === "true" || env.LOOPLOCAL_PREVIEW_SEED === "true") {
    issues.push("Other demo and preview runtime flags are forbidden");
  }
  return issues;
}

export function deviceTestRuntimeIssues(env: DeviceTestEnv): string[] {
  const issues = deviceTestPreparationIssues(env);
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
