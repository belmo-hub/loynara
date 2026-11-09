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

/** A demo lasts this long; the worker voids its passes then, and erases it an hour later. */
export const DEMO_HOURS = 24;

const offOrUnset = ["EXTERNAL_EMAIL_ENABLED", "TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED", "PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "WALLET_MESSAGES_ENABLED", "LIVE_BILLING_ENABLED", "GOOGLE_WALLET_ENABLED"];

/**
 * Why a demo environment must not start: anything that could reach people beyond the owner's own Wallet card. The keys
 * for email, Wallet messages, Stripe and Google are not allowed to exist there. Names settings, never values.
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
