import { formatMinor } from "./spend-copy";

/** Single source of truth for per-role manual award caps; the server enforces them, the cashier UI mirrors them. */
export type StaffRole = "owner" | "manager" | "cashier";

export function manualAwardLimit(role: StaffRole | null | undefined): number {
  return role === "manager" ? 100 : role === "owner" ? 1000 : 10;
}

/** The quantity picker never offers more than the server accepts, and never more than its long-standing 100 ceiling. */
export function quantityPickerMax(role: StaffRole | null | undefined): number {
  return Math.min(manualAwardLimit(role), 100);
}

/** Per-role caps on one purchase booking: the amount in minor units and the points it earns. The server enforces them. */
export function purchaseAwardLimits(role: StaffRole | null | undefined): { amountMinor: number; points: number } {
  return role === "cashier" ? { amountMinor: 50_000, points: 500 } : role === "manager" ? { amountMinor: 200_000, points: 2_000 } : { amountMinor: 1_000_000, points: 10_000 };
}

/** The counter's answer to LIMIT_EXCEEDED on a booking: the limit of this role, and what to do next. French keeps its
 * earlier sentence (no new French copy, founder 28 Oct). */
export function awardLimitText(role: StaffRole | null | undefined, purchase: boolean, unit: "stamp" | "points", currency: string, locale: "de" | "fr" = "de"): string {
  if (locale === "fr") return "Le montant ou les points dépassent la limite de ce rôle. Demandez à la personne propriétaire de vérifier cet achat.";
  const n = (value: number) => new Intl.NumberFormat("de-DE").format(value);
  const limits = purchaseAwardLimits(role);
  const limit = purchase
    ? `Höchstens ${formatMinor(limits.amountMinor, currency)} oder ${n(limits.points)} Punkte pro Buchung.`
    : `Höchstens ${n(manualAwardLimit(role))} ${unit === "points" ? "Punkte" : "Stempel"} pro Buchung.`;
  const next = role === "owner" ? `Bitte ${purchase ? "den Betrag" : "die Menge"} prüfen.`
    : `Bitte ${purchase ? "den Betrag" : "die Menge"} prüfen. Stimmt alles, bucht die Inhaberin oder der Inhaber.`;
  return `${limit} ${next}`;
}
