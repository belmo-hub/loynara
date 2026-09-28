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
  // pg-connection-string gives these parameters priority over the URL fields.
  const databaseOverride = database && (["host", "port", "user", "password"].some(name => database.searchParams.has(name)) || Boolean(database.hash));

  if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || localHosts.has(database.hostname) || database.password === "looplocal_local_only" || databaseOverride) {
    issues.push("Production database must use a remote PostgreSQL target and unique credentials");
  }
  if (!auth || !base || auth.protocol !== "https:" || base.protocol !== "https:" || localHosts.has(auth.hostname) || localHosts.has(base.hostname)) {
    issues.push("Production application URLs must use HTTPS and nonlocal hosts");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.startsWith("replace-")) {
    issues.push("Production auth secret is missing, short, or a placeholder");
  }
  if (env.PUBLIC_REGISTRATION_ENABLED === "true") issues.push("Public registration is not approved for production");
  const externalEmailRequested = env.EXTERNAL_EMAIL_ENABLED === "true" || env.TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED === "true" || env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true";
  if (externalEmailRequested && (env.MAILGUN_SEND_APPROVED !== "true"
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(env.MAILGUN_EU_DOMAIN ?? "")
    || !/^[^\s@]+@[^\s@]+$/.test(env.MAILGUN_FROM_EMAIL ?? "")
    || !env.MAILGUN_FROM_EMAIL?.toLowerCase().endsWith(`@${env.MAILGUN_EU_DOMAIN?.toLowerCase()}`)
    || !env.MAILGUN_EU_API_KEY || !env.MAILGUN_EU_WEBHOOK_SIGNING_KEY
    || !base || base.pathname !== "/" || base.search || base.hash || base.username || base.password)) {
    issues.push("External email requires approved Mailgun EU sender, domain, API key and webhook signing key");
  }
  if (env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true") {
    const monthly = Number(env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT);
    const frequency = Number(env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS);
    const unsubscribe = parsedUrl(env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN);
    if (env.MAILGUN_PROMOTIONAL_SEND_APPROVED !== "true" || !env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT || !env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS || (env.PROMOTIONAL_UNSUBSCRIBE_SECRET?.length ?? 0) < 32
      || !unsubscribe || unsubscribe.protocol !== "https:" || localHosts.has(unsubscribe.hostname) || unsubscribe.origin === base?.origin || unsubscribe.pathname !== "/" || unsubscribe.search || unsubscribe.hash || unsubscribe.username || unsubscribe.password
      || !Number.isSafeInteger(monthly) || monthly < 1 || monthly > 100_000 || !Number.isSafeInteger(frequency) || frequency < 1 || frequency > 24 * 365) {
      issues.push("Promotional email requires separate approval, public unsubscribe origin and configured location/customer safety limits");
    }
  }
  if (env.LIVE_BILLING_ENABLED === "true") issues.push("Live billing is not configured and approved for production");
  if (env.BILLING_FIXTURE_MODE === "true") issues.push("Local billing fixture is forbidden in production");
  if (env.DEMO_SEED_ALLOWED === "true" || env.DEMO_MODE === "true") issues.push("Demo seed/settings are forbidden in production");
  if (env.LOOPLOCAL_PREVIEW_SEED === "true") issues.push("Preview seeding is forbidden in production");
  if (env.LOOPLOCAL_DEVICE_TEST_SEED === "true") issues.push("Device-test seeding is forbidden in production");
  return issues;
}
