import type { HappyHourWindow } from "@/lib/happy-hour";

export class ClientApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly retryAfterMs?: number) { super(message); }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init }); }
  catch { throw new ClientApiError(0, "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut."); }
  const result = await response.json().catch(() => null) as (T & { error?: string; message?: string; code?: string }) | null;
  if (!response.ok) {
    const text = response.status === 429 && result?.code === "RATE_LIMIT"
      ? "Zu viele Anfragen. Bitte warte kurz und versuche es erneut."
      : result?.message || result?.error || `Anfrage fehlgeschlagen (${response.status}).`;
    const retry = response.headers.get("retry-after");
    const delay = retry ? (/^\d+$/.test(retry.trim()) ? Number(retry) * 1000 : Date.parse(retry) - Date.now()) : NaN;
    const retryAfterMs = Number.isFinite(delay) && delay > 0 ? delay : undefined;
    throw new ClientApiError(response.status, text, result?.code, retryAfterMs);
  }
  if (!result) throw new ClientApiError(response.status, "Die Antwort des Servers war leer.");
  return result;
}

export function postJson<T>(url: string, value: unknown) {
  return apiJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
}

export function newRequestId() {
  if (typeof crypto === "undefined" || !crypto.randomUUID) throw new Error("Sichere Anfragekennung nicht verfügbar. Nutze einen aktuellen Browser über HTTPS.");
  return crypto.randomUUID();
}

export async function imageToDataUrl(file: File): Promise<string> {
  if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type))) throw new Error("Bitte ein PNG-, JPG- oder WebP-Bild wählen.");
  if (file.size > 2 * 1024 * 1024) throw new Error("Das Logo darf höchstens 2 MB groß sein.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Das Logo konnte nicht gelesen werden."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

export type MeResponse = {
  userId: string;
  tenantId: string;
  locationId: string;
  role: "owner" | "manager" | "cashier";
  businessName: string;
  locationName: string;
  publicBaseUrl: string;
  locale?: "de" | "fr";
  programSlug: string;
  programId?: string;
  programType: "stamp" | "points";
  tapMode?: "disabled" | "automatic_fixed" | "staff_confirmed";
  /** False on the production deployment (pilot policy); absent is treated as false. */
  tapAutomaticAllowed?: boolean;
  /** Merchant surfaces withheld on the real production deployment (see lib/pilot-surfaces). Absent means none. */
  hiddenSurfaces?: Array<"billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc">;
  tapCooldownSeconds?: number | null;
  /** Extra stamps or points with a card's first staff-confirmed award; 0 = off. */
  welcomeBonus?: number;
  /** Short plain-text news on the customer card; empty = hidden. */
  cardNews?: string;
  /** The shop's Google review link, or null. */
  reviewUrl?: string | null;
  happyHourEnabled?: boolean;
  happyHourWindows?: HappyHourWindow[];
  rewardTitle: string;
  rewardCost: number;
  stats?: { members: number; awards: number; redemptions: number; periodLabel?: string };
  /** occurredAt is localized display text in the merchant's timezone; only createdAt is a raw timestamp. */
  activity?: Array<{ id: string; kind: "award" | "redeem" | "redemption" | "reversal"; occurredAt?: string; createdAt?: string; amount?: number; delta?: number; unit?: string; reference?: string }>;
};

export type PublicProgram = {
  businessName: string;
  locationName: string;
  programName: string;
  programType: "stamp" | "points";
  earningMode: "manual" | "purchase";
  pointsPerCurrencyUnit: number;
  currency: "EUR" | "MAD";
  locale?: "de" | "fr";
  rulesText: string;
  rewardTitle: string;
  rewardCost: number;
  rewards: Array<{ id: string; rewardId: string; title: string; cost: number; termsText: string; sortOrder: number }>;
  brandColor?: string;
  active?: boolean;
  referral?: { enabled: boolean; referrerBonus: number; referredBonus: number };
};

export type CardResponse = {
  scanCode: string;
  cardLocator: string;
  balance: number;
  merchantName: string;
  locationName: string;
  programName: string;
  programType: "stamp" | "points";
  earningMode?: "manual" | "purchase";
  locale?: "de" | "fr";
  brandColor?: string;
  rulesText?: string;
  /** The shop's news line; absent when the owner left it empty. */
  news?: string;
  /** Present only after the card's third staff-confirmed visit and when the shop stored a link. */
  reviewUrl?: string;
  /** End time (HH:MM, shop time) of the running happy hour; absent when none is running. */
  happyHourUntil?: string;
  rewards: Array<{ id: string; rewardId?: string; title: string; cost: number; termsText?: string; sortOrder?: number }>;
  activity: Array<{ delta: number; kind: string; createdAt: string; isPurchase?: boolean; isWelcomeBonus?: boolean; isHappyHour?: boolean }>;
};
