import { emailTransportMode } from "../src/lib/transactional-email";
import path from "node:path";
import { passFastStatus } from "../src/lib/wallet/passfast";
import { googleLocationClasses } from "../src/lib/wallet/google-direct";
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
  const recoveryPolicy = env.VERIFIED_RECOVERY_BEFORE_FIRST_AWARD;
  if (recoveryPolicy !== undefined && recoveryPolicy !== "true" && recoveryPolicy !== "false") issues.push("VERIFIED_RECOVERY_BEFORE_FIRST_AWARD must be exactly true or false");
  if (env.NFC_ENABLED === "true" && recoveryPolicy !== "true") issues.push("NFC requires verified recovery email before the first award");
  if (recoveryPolicy === "true" && emailTransportMode(env) !== "mailgun_eu") issues.push("Verified recovery requires an approved transactional email transport");
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
  issues.push(...walletConfigIssues(env, approved));
  return issues;
}

// Credential material that belongs to a fixture, preview or device test, never to production.
const nonProductionPath = /(^|[/\\._-])(public|fixtures?|preview|device[-_]?test|demo|synthetic|self[-_]?signed|test)([/\\._-]|$)/i;
const placeholder = /replace|placeholder|example|changeme|test-secret/i;

/**
 * Wallet fails closed. Each provider is off unless it is exactly "true", and then it needs a separate production
 * approval, complete credentials outside preview/test locations, and HTTPS endpoints on the approved origin. Messages
 * name settings only, never values.
 */
function walletConfigIssues(env: NodeJS.ProcessEnv, approved: URL | null): string[] {
  const issues: string[] = [];
  for (const name of ["PASSFAST_ENABLED", "APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "GOOGLE_WALLET_ASSET_ENABLED"]) {
    if (env[name] !== undefined && env[name] !== "true" && env[name] !== "false") issues.push(`${name} must be exactly true or false`);
  }
  if (["DEVICE_TEST_APPROVED_WALLET_PROVIDER", "DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL", "DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID"].some(name => env[name])) {
    issues.push("Device-test Wallet approvals are forbidden in production");
  }
  const apple = env.APPLE_WALLET_ENABLED === "true";
  const google = env.GOOGLE_WALLET_ENABLED === "true";
  const passfast = env.PASSFAST_ENABLED === "true";
  if (apple) issues.push("Direct native Apple Wallet is dormant; Apple production uses PassFast");
  if (passfast && !passFastStatus(env).ready) issues.push("PassFast enabled without complete approved configuration");
  if ((passfast || apple || google) && env.WALLET_PRODUCTION_APPROVED !== "true") issues.push("Wallet requires a separate production approval (WALLET_PRODUCTION_APPROVED=true)");
  if (!passfast && !apple && !google && env.WALLET_PRODUCTION_APPROVED === "true") issues.push("WALLET_PRODUCTION_APPROVED is set while no Wallet provider is enabled");
  const credentialPath = (name: string) => {
    const value = env[name];
    if (!value || !path.isAbsolute(value) || nonProductionPath.test(value)) issues.push(`${name} must be an absolute path outside public, preview, fixture and device-test locations`);
  };
  if (apple) {
    for (const name of ["APPLE_SIGNING_CERT_PATH", "APPLE_SIGNING_KEY_PATH", "APPLE_WWDR_CERT_PATH"]) credentialPath(name);
    if (!/^pass(\.[A-Za-z0-9-]+){2,}$/.test(env.APPLE_PASS_TYPE_ID ?? "") || /\.(local|test|example|invalid)(\.|$)/i.test(env.APPLE_PASS_TYPE_ID ?? "")) issues.push("APPLE_PASS_TYPE_ID must be a registered reverse-DNS Pass Type ID");
    if (!/^[A-Z0-9]{10}$/.test(env.APPLE_TEAM_ID ?? "")) issues.push("APPLE_TEAM_ID must be a 10-character Apple team identifier");
    const secret = env.APPLE_WALLET_AUTH_SECRET ?? "";
    if (secret.length < 32 || placeholder.test(secret) || new Set(secret).size < 12) issues.push("APPLE_WALLET_AUTH_SECRET must be at least 32 random characters");
    if (secret && [env.BETTER_AUTH_SECRET, env.NFC_VERIFY_MASTER_KEY, env.PROMOTIONAL_UNSUBSCRIBE_SECRET, env.MAILGUN_EU_WEBHOOK_SIGNING_KEY].includes(secret)) issues.push("APPLE_WALLET_AUTH_SECRET must not be reused as another secret");
    // Apple devices call this URL directly; it must be the approved app origin, not a preview or tunnel host.
    if (!approved || env.APPLE_WALLET_WEB_SERVICE_URL !== `${approved.origin}/api/apple`) issues.push("APPLE_WALLET_WEB_SERVICE_URL must be exactly the approved HTTPS origin followed by /api/apple");
  }
  if (google) {
    if (env.GOOGLE_WALLET_PROVIDER !== "GOOGLE_DIRECT") issues.push("Google Wallet requires explicit GOOGLE_DIRECT provider selection");
    try { googleLocationClasses(env); } catch { issues.push("Google Direct requires valid owned issuer and approved location classes"); }
    credentialPath("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE");
    if (!/^\d{10,25}$/.test(env.GOOGLE_WALLET_ISSUER_ID ?? "")) issues.push("GOOGLE_WALLET_ISSUER_ID must be the numeric Google Wallet issuer ID");
    if (env.GOOGLE_WALLET_PUBLISHING_STATUS !== "published") issues.push("Google Wallet publishing must be approved (GOOGLE_WALLET_PUBLISHING_STATUS=published); Demo Mode is not production");
    const logo = parsedUrl(env.GOOGLE_WALLET_PROGRAM_LOGO_URL);
    if (!logo || logo.protocol !== "https:" || localHosts.has(logo.hostname) || logo.username || logo.password || /preview|device[-_]?test|example|\.invalid$/i.test(logo.hostname)) issues.push("GOOGLE_WALLET_PROGRAM_LOGO_URL must be a public HTTPS image URL");
  }
  if (env.GOOGLE_WALLET_ASSET_ENABLED === "true") {
    const origin = parsedUrl(env.GOOGLE_WALLET_ASSET_ORIGIN);
    if (!google || !origin || origin.protocol !== "https:" || origin.origin !== env.GOOGLE_WALLET_ASSET_ORIGIN || localHosts.has(origin.hostname) || /preview|device[-_]?test/i.test(origin.hostname)) {
      issues.push("Google Wallet merchant logos require Google Wallet and an exact public HTTPS GOOGLE_WALLET_ASSET_ORIGIN");
    }
  }
  return issues;
}
