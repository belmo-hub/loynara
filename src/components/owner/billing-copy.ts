/** What /api/merchant/billing returns (lib/billing.ts getBillingOverview), read by Abrechnung and the „Mehr“ page. */
export type BillingOverview = {
  status: string; currency: "EUR" | "MAD"; locationCount: number; monthlySubtotalMinor: number;
  currentPeriodEnd: string | null; cancelAtPeriodEnd: boolean; graceUntil: string | null;
  liveBilling: boolean; charge: { planCode: "founding" | "list"; unitMinor: number; quantity: number; totalMinor: number } | null; taxNote: string; planCode: "founding" | "list" | null; paymentAccount: boolean; guaranteeApplied: boolean; fixtureAvailable: boolean; countingRule: string;
  locations: Array<{ locationId: string; locationName: string; planCode: string; priceMinor: number; memberLimit: number; activeMembers: number }>;
  invoices: Array<{ id: string; providerInvoiceId: string; status: string; amountMinor: number; currency: "EUR" | "MAD"; taxMinor: null; periodEnd: string; createdAt: string }>;
};

const LIVE_STATUS: Record<string, string> = { manual_pending: "Noch kein Abo", pending_checkout: "Zahlung noch nicht abgeschlossen", active: "Abo aktiv", past_due: "Zahlung fehlgeschlagen", suspended: "Abo ausgesetzt", cancelled: "Abo beendet" };
// Without live billing the states belong to the local payment test (development and preview only).
const STATUS: Record<string, string> = { manual_pending: "Entwurf ohne Zahlung", pending_checkout: "Lokaler Testvorgang offen", active_fixture: "Lokale Testperiode aktiv", grace_fixture: "Lokale Test-Nachfrist", suspended_fixture: "Lokale Testperiode ausgesetzt", cancelled: "Lokale Testperiode beendet" };

export const billingStatus = (o: Pick<BillingOverview, "liveBilling" | "status">) => (o.liveBilling ? LIVE_STATUS : STATUS)[o.status] ?? o.status;
