/**
 * First-merchant pilot policy. Automatic NFC awards (`automatic_fixed`) prove a
 * fresh read of a genuine tag, not a purchase, and have no policy-change audit
 * or guardrails yet. They stay implemented for development, preview and device
 * tests but must never be enabled on the real production deployment.
 *
 * "Real production" is defined exactly as Loynara's other guards define it:
 * PRODUCTION_ENVIRONMENT=loynara-production (config gate, ingress check,
 * migrate and backup guards). NODE_ENV is deliberately NOT part of the test:
 * the device-test and preview web processes also run `next start` with
 * NODE_ENV=production and must keep their automatic-tap testing capability.
 */
export const PRODUCTION_ENVIRONMENT_MARKER = "loynara-production";

type PolicyEnv = { PRODUCTION_ENVIRONMENT?: string; [name: string]: string | undefined };

export function isProductionDeployment(env: PolicyEnv = process.env): boolean {
  return env.PRODUCTION_ENVIRONMENT === PRODUCTION_ENVIRONMENT_MARKER;
}

export function automaticTapAllowed(env: PolicyEnv = process.env): boolean {
  return !isProductionDeployment(env);
}

export const AUTOMATIC_TAP_REFUSAL = "Automatische NFC-Vergabe ist im Pilotbetrieb nicht verfügbar. Bitte „Mit Bestätigung“ oder „Aus“ wählen.";
