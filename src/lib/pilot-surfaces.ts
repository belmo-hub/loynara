import { mailgunConfig } from "./email-configuration";
import { isProductionDeployment } from "./pilot-policy";
import { nfcCapability } from "./nfc-keys";
import { anyWalletAvailable } from "./wallet/capability";

/**
 * First-merchant pilot: merchant surfaces that cannot yet do their main job on the real production
 * deployment are not offered at all (no navigation entry, no direct route). The implementations stay
 * in the code base and stay available on development, preview and device-test processes.
 *
 * - billing: no approved price, no checkout and no invoicing.
 * - automations: follows CAPABILITY on real production: withheld while promotional e-mail is not configured (rules could
 *   only be saved, never run to a result), shown automatically once it is (lib/email-configuration, "promotional").
 * - campaigns / audiences: NOT withheld. With production e-mail delivery disabled they are draft-only: the audience
 *   preview and campaign composer work, drafts are saved, and the schedule control does not exist while
 *   promotionalEmailMode() is "disabled" (the server also refuses scheduling with EMAIL_DISABLED and the dispatcher
 *   blocks any job). Nothing can be sent or shown as sent.
 * - walletPreviews / cardLogo: Apple/Google Wallet previews, Wallet readiness and the logo upload in the card studio.
 *   Like NFC these follow CAPABILITY on real production: withheld while no Wallet provider can issue a pass (the browser
 *   card does not show a logo, the Apple pass does), shown automatically once Apple or Google Wallet is configured.
 * - nfc: NFC settings, readiness and the cashier confirmation panel. Unlike the others this follows CAPABILITY, not the
 *   environment name: it is withheld wherever no verification-key provider is configured (lib/nfc-keys), so nothing is
 *   offered that could not work, and it appears automatically once production NFC is configured.
 *
 * "Real production" is the same canonical definition the other pilot guards use (PRODUCTION_ENVIRONMENT).
 */
export type PilotSurface = "billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc";
export const PILOT_HIDDEN_SURFACES: readonly PilotSurface[] = ["billing"];

type SurfaceEnv = { PRODUCTION_ENVIRONMENT?: string; [name: string]: string | undefined };

export function hiddenSurfaces(env: SurfaceEnv = process.env): PilotSurface[] {
  const production = isProductionDeployment(env);
  const hidden: PilotSurface[] = production ? [...PILOT_HIDDEN_SURFACES] : [];
  if (production && !mailgunConfig(env, "promotional")) hidden.push("automations");
  if (production && !anyWalletAvailable(env)) hidden.push("walletPreviews", "cardLogo");
  if (!nfcCapability(env).available) hidden.push("nfc");
  return hidden;
}

export function surfaceHidden(surface: PilotSurface, env: SurfaceEnv = process.env): boolean {
  return hiddenSurfaces(env).includes(surface);
}
