import { z } from "zod";

export type EmailPurpose = "transactional" | "promotional";
type ConfigurationEnvironment = Readonly<Record<string, string | undefined>>;

const domainPattern = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
function externalOrigin(value?: string) {
  try {
    const url = new URL(value ?? "");
    return url.protocol === "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.pathname === "/" && !url.username && !url.password && !url.search && !url.hash;
  } catch { return false; }
}
function distinctOrigins(first?: string, second?: string) {
  try { return new URL(first ?? "").origin !== new URL(second ?? "").origin; }
  catch { return false; }
}

/** The adapter and operator diagnostic share these existing configuration predicates. */
function configurationGates(env: ConfigurationEnvironment, purpose: EmailPurpose) {
  const domain = env.MAILGUN_EU_DOMAIN?.toLowerCase();
  const from = env.MAILGUN_FROM_EMAIL?.toLowerCase();
  const monthly = Number(env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT);
  const frequency = Number(env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS);
  return {
    ...(purpose === "transactional" ? {
      transactional_enabled: (env.TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED ?? env.EXTERNAL_EMAIL_ENABLED) === "true",
    } : {
      promotional_enabled: env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED === "true",
      promotional_approval: env.MAILGUN_PROMOTIONAL_SEND_APPROVED === "true",
    }),
    sender_approval: env.MAILGUN_SEND_APPROVED === "true",
    sender_domain: Boolean(domain && domainPattern.test(domain)),
    sender_address: Boolean(from && z.email().safeParse(from).success),
    sender_domain_match: Boolean(domain && from && from.endsWith(`@${domain}`)),
    api_key: Boolean(env.MAILGUN_EU_API_KEY),
    webhook_signing_key: Boolean(env.MAILGUN_EU_WEBHOOK_SIGNING_KEY),
    public_origin: externalOrigin(env.PUBLIC_BASE_URL),
    ...(purpose === "promotional" ? {
      unsubscribe_origin: externalOrigin(env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN),
      unsubscribe_origin_isolation: distinctOrigins(env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN, env.PUBLIC_BASE_URL),
      unsubscribe_secret: (env.PROMOTIONAL_UNSUBSCRIBE_SECRET?.length ?? 0) >= 32,
      monthly_location_limit: env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT !== "" && Number.isSafeInteger(monthly) && monthly >= 1 && monthly <= 100_000,
      customer_cooldown: env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS !== "" && Number.isSafeInteger(frequency) && frequency >= 1 && frequency <= 24 * 365,
    } : {}),
  };
}

export type EmailConfigurationGate = keyof ReturnType<typeof configurationGates>;
function missingConfigurationGates(env: ConfigurationEnvironment, purpose: EmailPurpose): EmailConfigurationGate[] {
  const gates = configurationGates(env, purpose);
  return (Object.keys(gates) as EmailConfigurationGate[]).filter(gate => gates[gate] === false);
}

/** Private provider values: never include this result in diagnostics or logs. */
export function mailgunConfig(env: ConfigurationEnvironment = process.env, purpose: EmailPurpose = "transactional") {
  if (missingConfigurationGates(env, purpose).length) return null;
  return {
    domain: env.MAILGUN_EU_DOMAIN!.toLowerCase(), from: env.MAILGUN_FROM_EMAIL!.toLowerCase(),
    apiKey: env.MAILGUN_EU_API_KEY!, signingKey: env.MAILGUN_EU_WEBHOOK_SIGNING_KEY!,
  };
}

/** Pure local configuration assessment, with no DNS, provider or receipt verification.
 * Fixed codes only: no environment values, addresses, domains or credentials escape.
 * Configuration approval flags cannot prove the separate external acceptance gates.
 */
export function campaignReadiness(env: ConfigurationEnvironment) {
  const missingGates = missingConfigurationGates(env, "promotional");
  return {
    scope: "local_configuration_only" as const,
    provider: "mailgun_eu" as const,
    purpose: "promotional" as const,
    configurationReady: missingGates.length === 0,
    missingGates,
    externalAcceptance: {
      approvedSender: "not_verified_locally" as const,
      spf: "not_verified_locally" as const,
      dkim: "not_verified_locally" as const,
      dmarc: "not_verified_locally" as const,
      syntheticReceipt: "not_verified_locally" as const,
    },
  };
}
