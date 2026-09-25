import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { pool } from "../src/db";
import { appleWalletStatus } from "../src/lib/wallet/apple";
import { googleWalletStatus } from "../src/lib/wallet/google";
import { productionConfigIssues } from "./config-check";

async function main() {
  const issues: string[] = [...productionConfigIssues(process.env)];
  if (process.env.NODE_ENV === "production" && ["var/demo-access.json", "var/preview-access.json", "var/preview.env"].some((file) => existsSync(path.resolve(file)))) {
    issues.push("Local demo or preview credentials exist in this application directory");
  }

  console.log("LoopLocal environment diagnostic");
  console.log(`Mode: ${process.env.NODE_ENV ?? "development"}`);
  console.log(`Public registration: ${process.env.PUBLIC_REGISTRATION_ENABLED === "true" ? "enabled" : "disabled"}`);
  console.log(`External email: ${process.env.EXTERNAL_EMAIL_ENABLED === "true" ? "enabled" : "disabled"}`);
  console.log(`Live billing: ${process.env.LIVE_BILLING_ENABLED === "true" ? "enabled" : "disabled"}`);
  if (!process.env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET.length < 32 || process.env.BETTER_AUTH_SECRET.startsWith("replace-")) issues.push("Auth secret is missing, short, or a placeholder");

  const apple = appleWalletStatus();
  const google = googleWalletStatus();
  console.log(`Apple Wallet: ${apple.ready ? "configured (provider/device not verified)" : apple.reason}`);
  if (apple.enabled && apple.opensslVersion) console.log(`OpenSSL: ${apple.opensslVersion}`);
  if (apple.enabled && apple.zipVersion) console.log(`zip: ${apple.zipVersion}`);
  if (apple.certificateExpiresAt) console.log(`Apple certificate expires: ${apple.certificateExpiresAt} (${apple.certificateDaysRemaining} days)`);
  console.log(`Google Wallet: ${google.ready ? `configured (${google.publishingStatus}; provider/device not verified)` : google.reason}`);
  if (apple.enabled && !apple.ready) issues.push(`Apple Wallet enabled but unavailable: ${apple.reason}`);
  if (google.enabled && !google.ready) issues.push(`Google Wallet enabled but unavailable: ${google.reason}`);

  try {
    const tables = await pool.query<{ auth: string | null; tenant: string | null; outbox: string | null }>("SELECT to_regclass('public.user')::text AS auth, to_regclass('public.tenants')::text AS tenant, to_regclass('public.outbox_jobs')::text AS outbox");
    if (!tables.rows[0]?.auth || !tables.rows[0]?.tenant || !tables.rows[0]?.outbox) {
      issues.push("Database is reachable but required migrations are missing");
      console.log("Database: reachable, schema incomplete");
    } else {
      const jobs = await pool.query<{ status: string; count: number }>("SELECT status, count(*)::int AS count FROM outbox_jobs GROUP BY status ORDER BY status");
      console.log(`Database: reachable; auth, tenant and outbox tables present`);
      console.log(`Outbox jobs: ${jobs.rows.length ? jobs.rows.map((row) => `${row.status}=${row.count}`).join(", ") : "none"}`);
      const stalled = await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM outbox_jobs WHERE status = 'processing' AND next_attempt_at <= now()");
      if (stalled.rows[0]?.count) console.log(`Stalled worker leases ready for recovery: ${stalled.rows[0].count}`);
    }
  } catch {
    issues.push("Database is unreachable");
    console.log("Database: unreachable");
  }

  if (process.env.SMTP_HOST === "localhost" || process.env.SMTP_HOST === "127.0.0.1") {
    try {
      const response = await fetch("http://127.0.0.1:8026/api/v1/info", { signal: AbortSignal.timeout(3000) });
      if (!response.ok) throw new Error("Mailpit HTTP error");
      console.log("Mailpit: reachable (local inbox only; no message sent)");
    } catch {
      issues.push("Local Mailpit is unreachable");
      console.log("Mailpit: unreachable");
    }
  } else {
    console.log("Mailpit: not expected for this SMTP host");
  }

  if (issues.length) {
    console.error("Configuration issues:");
    for (const issue of issues) console.error(`- ${issue}`);
    process.exitCode = 1;
  } else {
    console.log("Diagnostic: local infrastructure ready; provider and device verification remain separate checks.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Diagnostic failed");
  process.exitCode = 1;
}).finally(() => pool.end());
