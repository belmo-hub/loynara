import { DERIVED_KEY_PROVIDER, parseMaster } from "../src/lib/nfc-keys";
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
  const approved = parsedUrl(env.PRODUCTION_APPROVED_ORIGIN);
  // pg-connection-string gives these parameters priority over the URL fields.
  const databaseOverride = database && (["host", "port", "user", "password"].some(name => database.searchParams.has(name)) || Boolean(database.hash));

  if (!database || !["postgres:", "postgresql:"].includes(database.protocol) || localHosts.has(database.hostname) || database.password === "looplocal_local_only" || databaseOverride
    || /preview|device[-_]?test|demo/i.test(`${database.hostname}/${database.pathname}/${database.username}`)) {
    issues.push("Production database must use a remote PostgreSQL target and unique credentials");
  }
  if (!auth || !base || auth.protocol !== "https:" || base.protocol !== "https:" || localHosts.has(auth.hostname) || localHosts.has(base.hostname)) {
    issues.push("Production application URLs must use HTTPS and nonlocal hosts");
  }
  if (env.PRODUCTION_ENVIRONMENT !== "loynara-production") {
    issues.push("Production environment identity is missing or incorrect");
  }
  if (!approved || approved.protocol !== "https:" || approved.origin !== env.PRODUCTION_APPROVED_ORIGIN
    || approved.hostname.startsWith("preview.") || approved.hostname.endsWith(".pages.dev")
    || auth?.origin !== approved.origin || base?.origin !== approved.origin
    || auth?.href !== `${approved.origin}/` || base?.href !== `${approved.origin}/`) {
    issues.push("Production origin must be the exact approved HTTPS app origin, never preview");
  }
  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || env.BETTER_AUTH_SECRET.startsWith("replace-")) {
    issues.push("Production auth secret is missing, short, or a placeholder");
  }
  if (env.PUBLIC_REGISTRATION_ENABLED === "true") issues.push("Public registration is not approved for production");
  // Invite-gated staff sign-up (approved for the pilot) is a narrow exception, not a form of registration: an account may be
  // created only for the exact invited address with the invitation's secret token while it is pending, unexpired, unrevoked
  // and unused (src/lib/auth.ts + invite-signup.ts; no other setting can relax that). It therefore requires public
  // registration to be explicitly off, and the flag itself must be unambiguous. Absent or "false" keeps it off.
  const invite = env.STAFF_INVITE_SIGNUP_ENABLED;
  if (invite !== undefined && invite !== "true" && invite !== "false") {
    issues.push("STAFF_INVITE_SIGNUP_ENABLED must be exactly true or false when set");
  } else if (invite === "true" && env.PUBLIC_REGISTRATION_ENABLED !== undefined && env.PUBLIC_REGISTRATION_ENABLED !== "false" && env.PUBLIC_REGISTRATION_ENABLED !== "true") {
    // "true" is already refused above; this catches ambiguous values that the application would treat as closed.
    issues.push("Invite-gated staff sign-up requires PUBLIC_REGISTRATION_ENABLED to be exactly false (or unset)");
  }
  const poolMax = Number(env.PG_POOL_MAX);
  if (!Number.isSafeInteger(poolMax) || poolMax < 1 || poolMax > 10) issues.push("Production PostgreSQL pool limit must be an integer from 1 to 10 per pool");
  if (env.SMTP_HOST !== "disabled") issues.push("Local Mailpit/SMTP transport must be disabled in production");
  if (env.TRUST_PROXY_CLIENT_IP !== undefined && env.TRUST_PROXY_CLIENT_IP !== "false") issues.push("Generic proxy client-IP trust is forbidden; use the reviewed ingress policy");
  if (env.TRUSTED_INGRESS !== "cloudflare_tunnel") issues.push("Production requires TRUSTED_INGRESS=cloudflare_tunnel and a private origin with no public bypass");
  if (env.BILLING_FIXTURE_SECRET) issues.push("Billing fixture secret is forbidden in production");
  if ([env.MAILGUN_EU_API_KEY, env.MAILGUN_EU_WEBHOOK_SIGNING_KEY, env.PROMOTIONAL_UNSUBSCRIBE_SECRET]
    .some(value => value && /replace|placeholder|example|test-secret/i.test(value))) {
    issues.push("Placeholder provider credentials are forbidden in production");
  }
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
  // NFC. Enabled only with the derived verification-key provider; development keys and the administrative master never reach production.
  if (env.TAP_SYNTHETIC_KEY_FILE) issues.push("Synthetic NFC development keys are forbidden in production");
  if (env.NFC_ADMIN_MASTER_KEY) issues.push("The NFC administrative master key must stay on the operator machine and is forbidden in the production environment");
  if (env.NFC_ENABLED === "true") {
    let masterValid = env.NFC_KEY_PROVIDER === DERIVED_KEY_PROVIDER;
    try { parseMaster(env.NFC_VERIFY_MASTER_KEY); } catch { masterValid = false; }
    if (!masterValid) issues.push("NFC requires NFC_KEY_PROVIDER=derived_v1 and a valid 64-hex NFC_VERIFY_MASTER_KEY");
    if (env.NFC_VERIFY_MASTER_KEY && [env.BETTER_AUTH_SECRET, env.BILLING_FIXTURE_SECRET, env.PROMOTIONAL_UNSUBSCRIBE_SECRET].some(value => value === env.NFC_VERIFY_MASTER_KEY)) issues.push("The NFC verification master key must not be reused as another secret");
  } else if (env.NFC_ENABLED !== undefined && env.NFC_ENABLED !== "false") {
    issues.push("NFC_ENABLED must be exactly true or false");
  } else if (env.NFC_VERIFY_MASTER_KEY || env.NFC_KEY_PROVIDER) {
    issues.push("NFC key settings are present while NFC is not enabled");
  }
  if (env.LIVE_BILLING_ENABLED === "true") issues.push("Live billing is not configured and approved for production");
  if (env.BILLING_FIXTURE_MODE === "true") issues.push("Local billing fixture is forbidden in production");
  if (env.DEMO_SEED_ALLOWED === "true" || env.DEMO_MODE === "true") issues.push("Demo seed/settings are forbidden in production");
  if (env.LOOPLOCAL_PREVIEW_SEED === "true") issues.push("Preview seeding is forbidden in production");
  if (env.LOOPLOCAL_DEVICE_TEST_SEED === "true") issues.push("Device-test seeding is forbidden in production");
  return issues;
}
