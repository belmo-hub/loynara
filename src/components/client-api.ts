import type { HappyHourWindow } from "@/lib/happy-hour";

export class ClientApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string, public readonly retryAfterMs?: number) { super(message); }
}

// Server codes whose `error` text is German copy written for the page; every other server text is a diagnostic (often
// English) and never reaches the UI. A code goes on this list only when every message the server sends with it is German.
export const GERMAN_SERVER_TEXT = new Set(["ACCOUNT_SWITCH_REQUIRED", "ALREADY_ONBOARDED", "AUTHENTICATION_REQUIRED", "BILLING_START_TIME", "CARD_EXISTS", "CHANGE_PENDING",
  "CHOICE_REQUIRED", "CONFIRM_REQUIRED", "END_DATE_TOO_EARLY", "EXPORT_CLOSED", "INVALID_ACTIVATION", "INVALID_BIRTHDAY",
  "INVALID_CODE_FORMAT", "INVALID_END_DATE", "INVALID_LEVELS", "INVALID_RECOVERY", "INVALID_TEMPLATE", "INVALID_UNSUBSCRIBE",
  "MESSAGE_REFUSED", "NO_REACH", "OWNER_INVITE_OPEN", "PLATE_UNLINKED", "PUSH_DEVICE_IN_USE", "PUSH_UNAVAILABLE", "QUIET_HOURS",
  "RECOVERY_DISABLED", "RECOVERY_REQUIRED", "SETUP_INCOMPLETE", "SHOP_CAP", "SHOP_HAS_OWNER", "STAFF_CONFIRMATION_REQUIRED",
  "TAP_AUTOMATIC_NOT_ALLOWED", "TEMPLATE_IN_USE",
  // German since ENG-152 (the shared codes many routes send).
  "BILLING_STATE", "CONTACT_DISABLED", "FORBIDDEN", "INVALID_INPUT", "NOT_FOUND", "PLAN_UNAVAILABLE",
  // Logo pipeline (ENG-134): every server line is German and names the actual fix.
  "INVALID_LOGO",
  // German in the programme settings; contact verification sends it in English, but that page shows its own state instead.
  "INVALID_CHALLENGE"]);

// The pick-time check's own line, before anything reaches the server.
export const LOGO_INVALID = "Dieses Bild können wir nicht verwenden. Wähle ein PNG, JPG oder WebP bis 2 MB.";

// Codes with mixed German and English server text that still get their own words.
const OWN_WORDS: Record<string, string> = {
  INVITE_USED: "Diese Einladung wurde schon angenommen.",
  INVALID_INVITE: "Diese Einladung gilt nicht. Bitte frage nach einer neuen.",
  PROGRAM_ENDED: "Das Programm ist beendet.",
};

// Customers have no login: an expired session there means the card link, not the sign-in page.
const STAFF_API = /^\/api\/(merchant|cashier|staff|operator|me)\b/;

/** What a failed request says on the page: by code where the server's text is German or the code has its own words, else by status. */
export function failureText(status: number, code?: string, serverText?: string, url = ""): string {
  if (status === 429 && code === "RATE_LIMIT") return "Zu viele Anfragen. Bitte warte kurz und versuche es erneut.";
  if (code && OWN_WORDS[code]) return OWN_WORDS[code];
  if (code && serverText && GERMAN_SERVER_TEXT.has(code)) return serverText;
  if (status === 401) return STAFF_API.test(url) ? "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an." : "Bitte öffne deine Karte noch einmal über deinen Kartenlink.";
  if (status === 403) return "Dafür fehlt dir die Berechtigung.";
  if (status === 404) return "Das haben wir nicht gefunden. Bitte lade die Seite neu.";
  if (status === 409) return "Das hat sich gerade geändert. Bitte lade die Seite neu und versuche es erneut.";
  if (status === 429) return "Zu viele Anfragen. Bitte warte kurz und versuche es erneut.";
  if (status >= 500) return "Gerade hat etwas nicht geklappt. Bitte versuche es gleich noch einmal.";
  return "Bitte prüfe deine Eingaben und versuche es noch einmal.";
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init }); }
  catch { throw new ClientApiError(0, "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut."); }
  const result = await response.json().catch(() => null) as (T & { error?: string; message?: string; code?: string }) | null;
  if (!response.ok) {
    const text = result?.message || failureText(response.status, result?.code, result?.error, url);
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

// The first bytes of each logo type the server accepts (merchant-brand.ts checks the same, and the same 2,000,000-byte limit).
const LOGO_MAGIC: Record<string, (head: Uint8Array) => boolean> = {
  "image/png": head => [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, i) => head[i] === byte),
  "image/jpeg": head => head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
  "image/webp": head => String.fromCharCode(...head.slice(0, 4)) === "RIFF" && String.fromCharCode(...head.slice(8, 12)) === "WEBP",
};

/** Checked when the file is picked: a file over the server's limit, or one whose contents are not its claimed type (a renamed JPEG), fails here. */
export async function imageToDataUrl(file: File): Promise<string> {
  const matches = LOGO_MAGIC[file.type];
  if (!matches) throw new Error(LOGO_INVALID);
  if (file.size > 2_000_000) throw new Error("Dein Logo ist größer als 2 MB. Wähle eine kleinere Datei.");
  if (!matches(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) throw new Error(LOGO_INVALID);
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
  /** The active location's colour (#RRGGBB) for card previews. Owner only, like the brand read; absent for managers and cashiers. */
  brandColor?: string;
  publicBaseUrl: string;
  locale?: "de" | "fr";
  programSlug: string;
  programId?: string;
  programType: "stamp" | "points";
  earningMode?: "manual" | "purchase";
  tapMode?: "disabled" | "automatic_fixed" | "staff_confirmed";
  /** False on the production deployment (pilot policy); absent is treated as false. */
  tapAutomaticAllowed?: boolean;
  /** Merchant surfaces withheld on the real production deployment (see lib/pilot-surfaces). Absent means none. */
  hiddenSurfaces?: Array<"billing" | "campaigns" | "automations" | "audiences" | "walletPreviews" | "cardLogo" | "nfc" | "cancellation">;
  tapCooldownSeconds?: number | null;
  /** Extra stamps or points with a card's first staff-confirmed award; 0 = off. */
  welcomeBonus?: number;
  /** Short plain-text news on the customer card; empty = hidden. */
  cardNews?: string;
  /** The shop's Google review link, or null. */
  reviewUrl?: string | null;
  happyHourEnabled?: boolean;
  happyHourWindows?: HappyHourWindow[];
  pointsExpiryMonths?: number | null;
  challengeVisits?: number | null;
  challengeBonus?: number;
  /** A change to the running challenge that starts on the 1st of a later month (ENG-065); visits null = off from then. */
  challengeNext?: { from: string; visits: number | null; bonus: number | null } | null;
  levelsEnabled?: boolean;
  /** Owner-entered average spend per visit (minor units) for the estimated results figure; null = not entered. */
  averageVisitSpendMinor?: number | null;
  levelSilverVisits?: number;
  levelGoldVisits?: number;
  levelBronzePerk?: string;
  levelSilverPerk?: string;
  levelGoldPerk?: string;
  /** Last day of the programme (YYYY-MM-DD) once the owner has asked to end it, else null. */
  cancellationEndDate?: string | null;
  /** True once the operator has confirmed the end date; before that it is provisional. */
  cancellationConfirmed?: boolean;
  rewardTitle: string;
  rewardCost: number;
  stats?: { members: number; awards: number; redemptions: number; periodLabel?: string };
  /** occurredAt is localized display text in the merchant's timezone; only createdAt is a raw timestamp. */
  activity?: Array<{ id: string; kind: "award" | "redeem" | "redemption" | "reversal"; occurredAt?: string; createdAt?: string; amount?: number; delta?: number; unit?: string; reference?: string }>;
};

/** `/api/me` for a shop whose programme has ended: the owner area shows only the export. */
export type EndedAccountResponse = { userId: string; tenantId: string; publicBaseUrl: string; programEnded: { role: "owner" | "manager" | "cashier"; businessName: string; endedOn: string; exportUntil: string; exportOpen: boolean } };

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
  /** The owner's own rules text, without the bonus lines the system adds (the rule editor saves only this). */
  ownerRulesText?: string;
  /** Shown before the card is created whenever the shop lets points expire. */
  pointsExpiryRule?: string;
  rewardTitle: string;
  rewardCost: number;
  /** ENG-100: a dated change waiting for its day (YYYY-MM-DD, the shop's calendar) and the day an archive takes effect. */
  rewards: Array<{ id: string; rewardId: string; title: string; cost: number; sortOrder: number; pending?: { effectiveOn: string; title: string; cost: number } | null; endsOn?: string | null }>;
  /** The day a change to customers' disadvantage saved now would take effect (four weeks on). */
  noticeOn?: string;
  /** ENG-100: a rule change waiting for its day (the rule in force is above), and a waiting expiry with the months before it. */
  pending?: { effectiveOn: string; earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; rulesText: string; old: { earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; rulesText: string } } | null;
  pendingExpiry?: { effectiveOn: string; months: number; before: number | null } | null;
  brandColor?: string;
  active?: boolean;
  referral?: { enabled: boolean; referrerBonus: number; referredBonus: number };
  /** ENG-100 D7: the newest rule and reward versions shown, sent back with the join. */
  ruleVersionId?: string;
  rewardVersionIds?: string[];
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
  /** Last day of the programme (YYYY-MM-DD) once the shop has cancelled; absent otherwise. */
  endsOn?: string;
  /** Present only after the card's third staff-confirmed visit and when the shop stored a link. */
  reviewUrl?: string;
  /** End time (HH:MM, shop time) of the running happy hour; absent when none is running. */
  happyHourUntil?: string;
  winback?: { bonus: number; until: string };
  /** The shop's points expiry rule, each batch's expiry date and, when points expire within 30 days, the notice; absent while expiry is off. */
  pointsExpiry?: { rule: string; batches: string[]; notice?: string };
  /** This month's challenge and the card's visit days so far; absent while the shop runs none. */
  challenge?: { text: string; conditions: string; visits: number; target: number; done: boolean };
  /** The card's level (visit days in 90 days), its perk and the next step; absent while the shop has no levels. */
  level?: { name: "Bronze" | "Silber" | "Gold" | null; perk?: string; until?: string; visits: number; next: { name: string; visits: number } | null };
  rewards: Array<{ id: string; rewardId?: string; title: string; cost: number; sortOrder?: number; pending?: { effectiveOn: string; title: string; cost: number } | null; endsOn?: string | null }>;
  /** ENG-100: a rule or expiry change waiting for its date (the card shows the rule in force until then). */
  pending?: PublicProgram["pending"];
  pendingExpiry?: PublicProgram["pendingExpiry"];
  activity: Array<{ delta: number; kind: string; createdAt: string; isPurchase?: boolean; isWelcomeBonus?: boolean; isHappyHour?: boolean; isWinbackBonus?: boolean; isBirthdayBonus?: boolean; isChallengeBonus?: boolean }>;
};
