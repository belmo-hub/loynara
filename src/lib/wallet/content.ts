import type { RevokeReason, WalletLocale, WalletPassData } from "./types";

/**
 * Customer-facing Wallet wording, shared by the Apple and Google adapters so both passes say the same thing. German is
 * the product default; French follows the merchant locale like the browser card. No infrastructure vocabulary.
 */
const TEXT = {
  de: {
    stamps: "Stempel", points: "Punkte", nextReward: "Nächste Prämie", rewardReady: "Prämie bereit", status: "Status",
    redeemAtCounter: "An der Kasse einlösen", remaining: (n: number, unit: string) => `Noch ${n} ${unit}`,
    card: "Karte", location: "Standort", programme: "Programm", updated: "Zuletzt aktualisiert", memberCard: "Mitgliedskarte",
    note: "Hinweis", noteBody: "Stempel, Punkte und Prämien werden nur an der Kasse gebucht. Diese Karte zeigt den aktuellen Stand deiner Treuekarte und aktualisiert sich automatisch.",
    revokedLabel: "Karte", invalid: "Karte ungültig",
    revoked: { reissued: "Ersetzt", closed: "Geschlossen", superseded: "Ersetzt" } as Record<RevokeReason, string>,
    revokedBody: {
      reissued: "Für diese Treuekarte wurde ein neuer Zugang ausgestellt. Öffne deinen neuen Kartenlink und füge die Karte dort erneut zu Wallet hinzu. Dein Stand bleibt erhalten.",
      closed: "Diese Treuekarte wurde geschlossen und kann nicht mehr verwendet werden.",
      superseded: "Diese Wallet-Karte wurde durch eine neuere ersetzt. Öffne deinen Kartenlink und füge die Karte erneut zu Wallet hinzu.",
    } as Record<RevokeReason, string>,
    logoAlt: (merchant: string) => `${merchant} Logo`,
  },
  fr: {
    stamps: "tampons", points: "points", nextReward: "Prochaine récompense", rewardReady: "Récompense disponible", status: "Statut",
    redeemAtCounter: "À utiliser en caisse", remaining: (n: number, unit: string) => `Encore ${n} ${unit}`,
    card: "Carte", location: "Établissement", programme: "Programme", updated: "Dernière mise à jour", memberCard: "Carte de fidélité",
    note: "Remarque", noteBody: "Les tampons, points et récompenses sont enregistrés uniquement en caisse. Cette carte affiche l’état actuel de votre carte de fidélité et se met à jour automatiquement.",
    revokedLabel: "Carte", invalid: "Carte invalide",
    revoked: { reissued: "Remplacée", closed: "Fermée", superseded: "Remplacée" } as Record<RevokeReason, string>,
    revokedBody: {
      reissued: "Un nouvel accès a été émis pour cette carte de fidélité. Ouvrez votre nouveau lien de carte et ajoutez-la de nouveau à Wallet. Votre solde est conservé.",
      closed: "Cette carte de fidélité a été fermée et ne peut plus être utilisée.",
      superseded: "Cette carte Wallet a été remplacée par une plus récente. Ouvrez votre lien de carte et ajoutez-la de nouveau à Wallet.",
    } as Record<RevokeReason, string>,
    logoAlt: (merchant: string) => `Logo ${merchant}`,
  },
} as const;

export function walletText(locale: WalletLocale) { return TEXT[locale]; }

export type WalletProgress = {
  unit: string;
  /** "7 / 10" for a stamp card with a target, otherwise the plain balance. */
  balanceText: string;
  rewardTitle?: string;
  ready: boolean;
  /** "Noch 3 Stempel" or "An der Kasse einlösen"; absent without a target reward. */
  statusText?: string;
};

export function walletProgress(pass: WalletPassData): WalletProgress {
  const t = walletText(pass.locale);
  const unit = pass.programType === "points" ? t.points : t.stamps;
  const reward = pass.reward;
  if (!reward) return { unit, balanceText: String(pass.balance), ready: false };
  const ready = pass.balance >= reward.cost;
  return {
    unit,
    balanceText: pass.programType === "stamp" ? `${Math.min(pass.balance, 9999)} / ${reward.cost}` : String(pass.balance),
    rewardTitle: reward.title,
    ready,
    statusText: ready ? t.redeemAtCounter : t.remaining(reward.cost - pass.balance, unit),
  };
}

function luminance(hex: string) {
  const [r, g, b] = [1, 3, 5].map(index => { const c = parseInt(hex.slice(index, index + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Same rule as the browser card and Card Studio: white text when it reaches 4.5:1 on the brand colour, otherwise dark. */
export function passInk(hex: string): "light" | "dark" {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid brand color");
  return 1.05 / (luminance(hex) + 0.05) >= 4.5 ? "light" : "dark";
}

export function hexToRgb(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error("Invalid brand color");
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
}
