const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

function parsedUrl(value?: string): URL | null {
  if (!value) return null;
  try { return new URL(value); } catch { return null; }
}

export function productionConfigIssues(env: NodeJS.ProcessEnv): string[] {
  if (env.NODE_ENV !== "production") return [];
  const issues: string[] = [];
  const database = parsedUrl(env.DATABASE_URL);
  const auth = parsedUrl(env.BETTER_AUTH_URL);
  const base = parsedUrl(env.PUBLIC_BASE_URL);

  if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || localHosts.has(database.hostname) || database.password === "looplocal_local_only") {
    issues.push("Production database must use a remote PostgreSQL target and unique credentials");
  }
  if (!auth || !base || auth.protocol !== "https:" || base.protocol !== "https:" || localHosts.has(auth.hostname) || localHosts.has(base.hostname)) {
    issues.push("Production application URLs must use HTTPS and nonlocal hosts");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.startsWith("replace-")) {
    issues.push("Production auth secret is missing, short, or a placeholder");
  }
  if (env.PUBLIC_REGISTRATION_ENABLED === "true") issues.push("Public registration is not approved for production");
  if (env.EXTERNAL_EMAIL_ENABLED === "true") issues.push("External email delivery is not configured and approved for production");
  if (env.LIVE_BILLING_ENABLED === "true") issues.push("Live billing is not configured and approved for production");
  if (env.DEMO_SEED_ALLOWED === "true" || env.DEMO_MODE === "true") issues.push("Demo seed/settings are forbidden in production");
  return issues;
}
