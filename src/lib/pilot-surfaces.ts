import { isProductionDeployment } from "./pilot-policy";

/**
 * First-merchant pilot: merchant surfaces that cannot yet do their main job on the real production
 * deployment are not offered at all (no navigation entry, no direct route). The implementations stay
 * in the code base and stay available on development, preview and device-test processes.
 *
 * - billing: no approved price, no checkout and no invoicing.
 * - campaigns / automations: production e-mail delivery is disabled, so they could only be drafted, never sent.
 * - audiences: a segment preview whose only purpose is to feed campaigns.
 * - walletPreviews: Apple/Google Wallet previews in the card studio; both wallets are off in the pilot.
 * - nfc: the NFC policy card; there is no production key provider or provisioned tag, so no choice made there could ever take effect.
 *   (The server-side refusal of automatic taps stays in force regardless; this only removes the dead control.)
 * - cardLogo: the logo upload; the browser card does not show an uploaded logo yet, so the control would do nothing visible.
 *
 * "Real production" is the same canonical definition the other pilot guards use (PRODUCTION_ENVIRONMENT).
 */
export type PilotSurface = "billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc";
export const PILOT_HIDDEN_SURFACES: readonly PilotSurface[] = ["billing", "campaigns", "automations", "audiences", "walletPreviews", "cardLogo", "nfc"];

type SurfaceEnv = { PRODUCTION_ENVIRONMENT?: string; [name: string]: string | undefined };

export function hiddenSurfaces(env: SurfaceEnv = process.env): PilotSurface[] {
  return isProductionDeployment(env) ? [...PILOT_HIDDEN_SURFACES] : [];
}

export function surfaceHidden(surface: PilotSurface, env: SurfaceEnv = process.env): boolean {
  return hiddenSurfaces(env).includes(surface);
}
