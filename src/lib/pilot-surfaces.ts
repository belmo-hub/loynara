import { isProductionDeployment } from "./pilot-policy";
import { nfcCapability } from "./nfc-keys";
import { anyWalletAvailable } from "./wallet/capability";

/**
 * First-merchant pilot: merchant surfaces that cannot yet do their main job on the real production
 * deployment are not offered at all (no navigation entry, no direct route). The implementations stay
 * in the code base and stay available on development, preview and device-test processes.
 *
 * - billing: no approved price, no checkout and no invoicing.
 * - automations: production e-mail delivery is disabled, so rules could only be configured, never run to a result.
 * - cancellation: the owner's "Programm beenden" card and its route, until Legal closes the DS-05 gate. Only the request is
 *   withheld: the ended-programme owner page and its 30-day export stay visible, because the operator can still end a
 *   programme from the console.
 * - walletMessages: owner messages on Apple Wallet cards (ENG-043): the owner page, its API routes and the consent box on the card page.
 *   Withheld on real production until Legal's documents are live and the founder switches it on; preview and development show it.
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
export type PilotSurface = "billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc" | "cancellation" | "walletMessages";
export const PILOT_HIDDEN_SURFACES: readonly PilotSurface[] = ["billing", "automations", "cancellation", "walletMessages"];

type SurfaceEnv = { PRODUCTION_ENVIRONMENT?: string; [name: string]: string | undefined };

export function hiddenSurfaces(env: SurfaceEnv = process.env): PilotSurface[] {
  const production = isProductionDeployment(env);
  // The founder's switch for owner messages on real production; absent or anything but "true" keeps them withheld.
  const hidden: PilotSurface[] = production ? PILOT_HIDDEN_SURFACES.filter(surface => !(surface === "walletMessages" && env.WALLET_MESSAGES_ENABLED === "true")) : [];
  if (production && !anyWalletAvailable(env)) hidden.push("walletPreviews", "cardLogo");
  if (!nfcCapability(env).available) hidden.push("nfc");
  return hidden;
}

export function surfaceHidden(surface: PilotSurface, env: SurfaceEnv = process.env): boolean {
  return hiddenSurfaces(env).includes(surface);
}
