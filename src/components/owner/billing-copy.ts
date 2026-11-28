/** What /api/merchant/billing returns (lib/billing.ts getBillingOverview), read by Abrechnung and the „Mehr“ page. */
export type BillingOverview = {
  status: string; currency: "EUR" | "MAD"; locationCount: number; monthlySubtotalMinor: number;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null;
  liveBilling: boolean; charge: { planCode: "list"; unitMinor: number; quantity: number; totalMinor: number } | null; taxNote: string; planCode: "list" | null; paymentAccount: boolean; checkoutOpen: boolean; guaranteeApplied: boolean; fixtureAvailable: boolean; countingRule: string;
  locations: Array<{ locationId: string; locationName: string; planCode: string; priceMinor: number; memberLimit: number; bookingEnabled?: boolean; activeMembers: number }>;
  invoices: Array<{ id: string; providerInvoiceId: string; status: string; amountMinor: number; currency: "EUR" | "MAD"; taxMinor: null; periodEnd: string; createdAt: string }>;
};

const LIVE_STATUS: Record<string, string> = { manual_pending: "Noch kein Abo", pending_checkout: "Zahlung noch nicht abgeschlossen", active: "Abo aktiv", past_due: "Zahlung fehlgeschlagen", suspended: "Abo ausgesetzt", cancelled: "Abo beendet" };
// Without live billing the states belong to the local payment test (development and preview only).
const STATUS: Record<string, string> = { manual_pending: "Noch kein Abo", pending_checkout: "Lokaler Testvorgang offen", active_fixture: "Lokale Testperiode aktiv", grace_fixture: "Lokale Test-Nachfrist", suspended_fixture: "Lokale Testperiode ausgesetzt", cancelled: "Lokale Testperiode beendet" };

/** „49 €“, cents only where there are some (Marketing's „1 Standort · 49 € im Monat“). Amounts always come from the read. */
export const money = (minor: number, currency: string) => new Intl.NumberFormat("de-DE", { style: "currency", currency, minimumFractionDigits: minor % 100 ? 2 : 0, maximumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
/** The price card's sub-line, copy-rest R17 FINAL: „{n} Standorte · {Summe} im Monat“; no VAT wording of its own. */
export const perMonth = (locations: number, totalMinor: number, currency: string) => `${locations} ${locations === 1 ? "Standort" : "Standorte"} · ${money(totalMinor, currency)} im Monat`;

export const billingStatus =(o: Pick<BillingOverview, "liveBilling" | "status">) => (o.liveBilling ? LIVE_STATUS : STATUS)[o.status] ?? o.status;

/** The live status row's sub: the end once cancelled, a next charge only while the subscription runs and charges (fault 1). */
export const liveStatusSub = (o: Pick<BillingOverview, "status" | "cancelAtPeriodEnd" | "currentPeriodEnd" | "currency" | "checkoutOpen">, date: (value: string) => string) =>
  o.cancelAtPeriodEnd && o.currentPeriodEnd ? `Gekündigt zum ${date(o.currentPeriodEnd)}.`
    : o.currentPeriodEnd && ["active", "past_due"].includes(o.status) ? `Nächste Abrechnung am ${date(o.currentPeriodEnd)}.`
    // Only a euro shop starts at go-live (startBilling refuses another currency).
    : o.status === "manual_pending" && o.currency === "EUR" && !o.checkoutOpen ? "Die Abrechnung startet mit deinem Go‑live. Der erste Monat ist kostenlos." : undefined;
