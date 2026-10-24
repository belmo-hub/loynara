import type { SpendFigures } from "./merchant-analytics";
import type { DayCount } from "./overview-day";
import { localNow } from "./overview-day";

/**
 * ENG-085 (CTO, 24 Oct): the Übersicht board's last numbers on this device, shown with „Stand …“ when a read fails.
 * Board numbers only (no names, no diary, no tiles), per user and location, at most 7 days old, cleared on sign-out.
 * Every storage access is wrapped: the page must work without it.
 */
export type BoardData = {
  timezone: string;
  today: string;
  days: DayCount[];
  lastBookingOn: string | null;
  fullTwoWeeks: boolean;
  /** No booking in the read's 90 days although the programme ran longer (the „vor über 90 Tagen“ headline). */
  over90: boolean;
  /** Confirmed bookings in the last 30 days (the board number of a shop without till amounts). */
  bookings: number;
  /** Owner: the active location's spend figures. */
  spend?: { currency: string; figures: SpendFigures };
  /** Leitung: the card stock. */
  stock?: { recent: number; openCards: number; drifting: number; never: number };
};
export type BoardCache = { at: string; board: BoardData };

const PREFIX = "loynara:board:";
const MAX_AGE_MS = 7 * 86_400_000;

export const boardCacheKey = (userId: string, locationId: string) => `${PREFIX}${userId}:${locationId}`;

export function readBoardCache(raw: string | null, now = Date.now()): BoardCache | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as BoardCache;
    const age = now - Date.parse(value.at);
    return Number.isFinite(age) && age >= 0 && age <= MAX_AGE_MS && value.board ? value : null;
  } catch { return null; }
}

export function writeBoardCache(key: string, value: BoardCache) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* no storage: nothing to fall back on later */ }
}

/** Called on sign-out: the next person on this device never sees these numbers. */
export function clearBoardCache() {
  try {
    const keys = Array.from({ length: window.localStorage.length }, (_, index) => window.localStorage.key(index)).filter((key): key is string => key?.startsWith(PREFIX) ?? false);
    for (const key of keys) window.localStorage.removeItem(key);
  } catch { /* no storage: nothing stored */ }
}

const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];

/** „Stand heute, 9:14“, „Stand gestern“ or „Stand Montag“, in the location's time, never seconds (copy R1). */
export function standLabel(at: string, now: Date, timeZone: string): string {
  const then = new Date(at);
  const thenDay = localNow(then, timeZone).date;
  const today = localNow(now, timeZone).date;
  const yesterday = new Date(new Date(`${today}T12:00:00Z`).getTime() - 86_400_000).toISOString().slice(0, 10);
  if (thenDay === today) {
    const time = new Intl.DateTimeFormat("de-DE", { timeZone, hour: "numeric", minute: "2-digit", hourCycle: "h23" }).format(then);
    return `Stand heute, ${time}`;
  }
  return thenDay === yesterday ? "Stand gestern" : `Stand ${WEEKDAYS[new Date(`${thenDay}T12:00:00Z`).getUTCDay()]}`;
}
