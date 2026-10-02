/**
 * First-merchant pilot policy. Automatic NFC awards (`automatic_fixed`) prove a
 * fresh read of a genuine tag, not a purchase, and have no policy-change audit
 * or guardrails yet. They stay implemented for development and device tests but
 * must never be enabled on the production deployment.
 *
 * Loynara's production marker is PRODUCTION_ENVIRONMENT=loynara-production (the
 * same marker the config gate, ingress check and backup guard use). NODE_ENV is
 * checked as well, so either signal is enough to refuse.
 */
export const PRODUCTION_ENVIRONMENT_MARKER = "loynara-production";

type PolicyEnv = { NODE_ENV?: string; PRODUCTION_ENVIRONMENT?: string };

export function isProductionDeployment(env: PolicyEnv = process.env): boolean {
  return env.NODE_ENV === "production" || env.PRODUCTION_ENVIRONMENT === PRODUCTION_ENVIRONMENT_MARKER;
}

export function automaticTapAllowed(env: PolicyEnv = process.env): boolean {
  return !isProductionDeployment(env);
}

export const AUTOMATIC_TAP_REFUSAL = "Automatische NFC-Vergabe ist im Pilotbetrieb nicht verfügbar. Bitte „Mit Bestätigung“ oder „Aus“ wählen.";
