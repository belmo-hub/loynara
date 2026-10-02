import { isProductionDeployment } from "./pilot-policy";
import { nfcCapability } from "./nfc-keys";

/**
 * First-merchant pilot: merchant surfaces that cannot yet do their main job on the real production
 * deployment are not offered at all (no navigation entry, no direct route). The implementations stay
 * in the code base and stay available on development, preview and device-test processes.
 *
 * - billing: no approved price, no checkout and no invoicing.
 * - campaigns / automations: production e-mail delivery is disabled, so they could only be drafted, never sent.
 * - audiences: a segment preview whose only purpose is to feed campaigns.
 * - walletPreviews: Apple/Google Wallet previews in the card studio; both wallets are off in the pilot.
 * - nfc: NFC settings, readiness and the cashier confirmation panel. Unlike the others this follows CAPABILITY, not the
 *   environment name: it is withheld wherever no verification-key provider is configured (lib/nfc-keys), so nothing is
 *   offered that could not work, and it appears automatically once production NFC is configured.
 * - cardLogo: the logo upload; the browser card does not show an uploaded logo yet, so the control would do nothing visible.
 *
 * "Real production" is the same canonical definition the other pilot guards use (PRODUCTION_ENVIRONMENT).
 */
export type PilotSurface = "billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc";
export const PILOT_HIDDEN_SURFACES: readonly PilotSurface[] = ["billing", "campaigns", "automations", "audiences", "walletPreviews", "cardLogo"];

type SurfaceEnv = { PRODUCTION_ENVIRONMENT?: string; [name: string]: string | undefined };

export function hiddenSurfaces(env: SurfaceEnv = process.env): PilotSurface[] {
  const hidden: PilotSurface[] = isProductionDeployment(env) ? [...PILOT_HIDDEN_SURFACES] : [];
  if (!nfcCapability(env).available) hidden.push("nfc");
  return hidden;
}

export function surfaceHidden(surface: PilotSurface, env: SurfaceEnv = process.env): boolean {
  return hiddenSurfaces(env).includes(surface);
}
