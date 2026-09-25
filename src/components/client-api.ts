export class ClientApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export async function apiJson<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", cache: "no-store", ...init }); }
  catch { throw new ClientApiError(0, "Keine Verbindung. Bitte prüfe deine Internetverbindung und versuche es erneut."); }
  const result = await response.json().catch(() => null) as (T & { error?: string; message?: string }) | null;
  if (!response.ok) {
    const text = result?.message || result?.error || `Anfrage fehlgeschlagen (${response.status}).`;
    throw new ClientApiError(response.status, text);
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
  programType: "stamp" | "points";
  rewardTitle: string;
  rewardCost: number;
  stats?: { members: number; awards: number; redemptions: number; periodLabel?: string };
  activity?: Array<{ id: string; kind: "award" | "redeem" | "redemption" | "reversal"; occurredAt?: string; createdAt?: string; amount?: number; delta?: number; unit?: string; reference?: string }>;
};

export type PublicProgram = {
  businessName: string;
  locationName: string;
  programName: string;
  programType: "stamp" | "points";
  locale?: "de" | "fr";
  rulesText: string;
  rewardTitle: string;
  rewardCost: number;
  brandColor?: string;
  active?: boolean;
};

export type CardResponse = {
  scanCode: string;
  balance: number;
  merchantName: string;
  locationName: string;
  programName: string;
  programType: "stamp" | "points";
  locale?: "de" | "fr";
  brandColor?: string;
  rulesText?: string;
  rewards: Array<{ id: string; title: string; cost: number; termsText?: string }>;
  activity: Array<{ delta: number; kind: string; createdAt: string }>;
};
