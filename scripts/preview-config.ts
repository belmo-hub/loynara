// PostgreSQL connection-string query parameters can override a URL's checked
// host, port and credentials. The preview uses one generated canonical URL.
const previewDatabaseUrl = "postgresql://looplocal_preview:looplocal_preview_local_only@127.0.0.1:54330/looplocal_preview";

function isPreviewDatabase(value?: string): boolean {
  return value === previewDatabaseUrl;
}

export function previewConfigIssues(env: Record<string, string | undefined>): string[] {
  const issues: string[] = [];
  if (env.TRUSTED_INGRESS !== undefined && env.TRUSTED_INGRESS !== "local") issues.push("Synthetic preview requires local ingress policy");
  if (!isPreviewDatabase(env.DATABASE_URL)) issues.push("Preview requires its isolated loopback PostgreSQL database");
  if (env.BETTER_AUTH_URL !== "http://localhost:3001" || env.PUBLIC_BASE_URL !== "http://localhost:3001") {
    issues.push("Preview requires the exact localhost:3001 application origin");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.startsWith("replace-")) {
    issues.push("Preview requires a generated auth secret");
  }
  for (const name of ["PUBLIC_REGISTRATION_ENABLED", "EXTERNAL_EMAIL_ENABLED", "LIVE_BILLING_ENABLED", "APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "TRUST_PROXY_CLIENT_IP"]) {
    if (env[name] !== "false") issues.push(`${name} must be false in the local preview`);
  }
  if (env.GOOGLE_WALLET_ASSET_ENABLED === "true") issues.push("Google provider assets must be disabled in the local preview");
  if (env.BILLING_FIXTURE_MODE === "true") issues.push("Local billing fixture must be disabled in the compiled preview");
  if (env.SMTP_HOST !== "disabled") issues.push("Preview must disable mail transport");
  if (env.DEMO_MODE === "true" || env.DEMO_SEED_ALLOWED === "true") issues.push("Legacy demo runtime flags are forbidden");
  return issues;
}
