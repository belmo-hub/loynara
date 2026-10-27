// Display helpers for the customer booking flow: every instant is shown in the shop's timezone, never the phone's.

export type Slot = { start: string; staffId: string };
export type SlotDay = { date: string; slots: Slot[] };

function parts(date: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  const values: Record<string, string> = {};
  for (const part of new Intl.DateTimeFormat("de-DE", { ...options, timeZone }).formatToParts(date)) values[part.type] = part.value;
  return values;
}

/** "Di 28.10." for a wall date (YYYY-MM-DD) that is already in the shop's zone. */
export function formatDay(date: string) {
  const p = parts(new Date(`${date}T12:00:00Z`), "UTC", { weekday: "short", day: "2-digit", month: "2-digit" });
  return `${p.weekday.replace(".", "")} ${p.day}.${p.month}.`;
}

/** "10:00" in the shop's zone. */
export function formatTime(iso: string, timeZone: string) {
  const p = parts(new Date(iso), timeZone, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${p.hour}:${p.minute}`;
}

/** "Di 28.10., 10:00" in the shop's zone. */
export function formatWhen(iso: string, timeZone: string) {
  return `${formatDay(wallDate(new Date(iso), timeZone))}, ${formatTime(iso, timeZone)}`;
}

/** YYYY-MM-DD of an instant in the shop's zone (today's date for the slots request). */
export function wallDate(date: Date, timeZone: string) {
  const p = parts(date, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}

/** Days that still have a free slot, in order. */
export const daysWithSlots = (days: SlotDay[]) => days.filter(day => day.slots.length > 0);

/** "25 €", "ab 25 €", "12,50 €". */
export function formatPrice(minor: number, from: boolean) {
  // shortcut: euro only, the booking API carries no currency yet; upgrade when a non-euro shop books.
  const text = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: minor % 100 ? 2 : 0 }).format(minor / 100);
  return from ? `ab ${text}` : text;
}

/** Random key per booking attempt; older phones lack crypto.randomUUID. */
export function attemptKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

export type Appointment = {
  id: string; status: "requested" | "confirmed" | "done" | "no_show" | "cancelled_by_customer" | "cancelled_by_shop"; start: string; durationMin: number; priceMinor: number;
  service: { id: string; name: string }; staff: { id: string; name: string }; rescheduleCount: number; lateCancel: boolean; canCancel: boolean; canReschedule: boolean; cancelDeadline: string;
};
export type Service = { id: string; name: string; durationMin: number; priceMinor: number; priceFrom: boolean };
export type BookingView = { enabled: false } | {
  enabled: true; blocked: boolean;
  shop: { name: string; timezone: string; termsText: string; cancelDeadlineHours: number; maxReschedulesPerMonth: number; autoConfirm: boolean; noShowBlockAfter: number; maxOpenPerCard: number; maxDaysAhead: number };
  services: Service[]; staff: { id: string; name: string; serviceIds: string[] }[]; upcoming: Appointment[]; past: Appointment[];
  push: PushView;
};
export type PushView = { publicKey?: string; subscribed: boolean; rebookConsent: boolean };
