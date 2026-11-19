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

/** The counter's answer to LIMIT_EXCEEDED on a booking: the limit of this role, and what to do next. */
export function awardLimitText(role: StaffRole | null | undefined, purchase: boolean, unit: "stamp" | "points", currency: string, locale: "de" | "fr" = "de"): string {
  const fr = locale === "fr";
  const n = (value: number, digits = 0) => new Intl.NumberFormat(fr ? "fr-FR" : "de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
  const limits = purchaseAwardLimits(role);
  const limit = purchase
    ? fr ? `Maximum ${n(limits.amountMinor / 100, 2)} ${currency} ou ${n(limits.points)} points par opération.` : `Höchstens ${n(limits.amountMinor / 100, 2)} ${currency} oder ${n(limits.points)} Punkte pro Buchung.`
    : fr ? `Maximum ${n(manualAwardLimit(role))} ${unit === "points" ? "points" : "tampons"} par opération.` : `Höchstens ${n(manualAwardLimit(role))} ${unit === "points" ? "Punkte" : "Stempel"} pro Buchung.`;
  const next = role === "owner"
    ? fr ? "Vérifiez la saisie." : purchase ? "Bitte den Betrag prüfen." : "Bitte die Menge prüfen."
    : fr ? "Vérifiez la saisie ; si elle est juste, la personne propriétaire l’enregistre." : `Bitte ${purchase ? "den Betrag" : "die Menge"} prüfen. Stimmt alles, bucht die Inhaberin oder der Inhaber.`;
  return `${limit} ${next}`;
}
