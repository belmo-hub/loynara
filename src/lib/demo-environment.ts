import { isProductionDeployment } from "./pilot-policy";

/**
 * The separate demo environment (demo-mode design v3): its own web, worker and database, where every shop is a demo.
 * Demo-only paths run only here: DEMO_ENVIRONMENT exactly "true", and never on the real production deployment.
 * Pure, so the startup check and client-facing code may import it.
 */
type Env = Record<string, string | undefined>;

export function demoEnvironment(env: Env = process.env): boolean {
  return env.DEMO_ENVIRONMENT === "true" && !isProductionDeployment(env);
}

/** A demo shop's slug: the client key of „Demo starten“. A shop from the setup never has it (slugOf(name)-5 characters). */
export const DEMO_SLUG_SQL = "^demo-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
export const DEMO_SLUG = new RegExp(DEMO_SLUG_SQL);

/** The ledger sources the owner's board counts as visits (SQL list). In the demo environment its sample visits
 *  (synthetic_seed, „Demo-Daten“) count too, so a fresh demo does not read as a dead shop; elsewhere unchanged. */
export function visitSources(env: Env = process.env): string {
  return demoEnvironment(env) ? "'staff_online','staff_offline','synthetic_seed'" : "'staff_online','staff_offline'";
}

/** A demo lasts this long; the worker voids its passes then, and erases it an hour later. */
export const DEMO_HOURS = 24;

const offOrUnset = ["EXTERNAL_EMAIL_ENABLED", "TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "WALLET_MESSAGES_ENABLED", "LIVE_BILLING_ENABLED", "GOOGLE_WALLET_ENABLED"];

/**
 * Why a demo environment must not start: email, Stripe and Google keys are not allowed to exist there, and billing runs
 * on the local fixture. Owner messages do reach the running demo's consenting cards (founder, 9 Nov; the send path in
 * lib/wallet-messages scopes them); WALLET_MESSAGES_ENABLED is still refused, harmless since only production reads it.
 * Names settings, never values.
 */
export function demoConfigIssues(env: Env): string[] {
  const issues: string[] = [];
  if (env.DEMO_ENVIRONMENT !== "true") {
    if (env.DEMO_ENVIRONMENT !== undefined && env.DEMO_ENVIRONMENT !== "false") issues.push("DEMO_ENVIRONMENT must be exactly true or false");
    return issues;
  }
  if (isProductionDeployment(env)) issues.push("DEMO_ENVIRONMENT=true on the production deployment: refused. The demo runs only in its own environment");
  const set = (name: string) => env[name] !== undefined && env[name] !== "";
  const mailgun = Object.keys(env).filter(name => name.startsWith("MAILGUN_") && set(name));
  if (mailgun.length) issues.push(`Mailgun settings are forbidden in the demo environment: ${mailgun.sort().join(", ")}`);
  for (const name of offOrUnset) if (set(name) && env[name] !== "false") issues.push(`${name} must be unset or false in the demo environment`);
  const stripe = Object.keys(env).filter(name => name.startsWith("STRIPE_") && set(name));
  if (stripe.length) issues.push(`Stripe settings are forbidden in the demo environment: ${stripe.sort().join(", ")}`);
  if (env.BILLING_FIXTURE_MODE !== "true") issues.push("The demo environment requires BILLING_FIXTURE_MODE=true");
  return issues;
}
