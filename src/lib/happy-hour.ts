// Happy hour: up to three weekly windows in the shop's own timezone during which a confirmed purchase award books the same
// points a second time. Pure functions only (imported by client code); the server checks every value again.

export const HAPPY_HOUR_MAX_WINDOWS = 3;
/** Day numbers are ISO weekdays: 1 = Monday ... 7 = Sunday. */
export type HappyHourWindow = { days: number[]; start: string; end: string };

const START = /^([01]\d|2[0-3]):[0-5]\d$/;
const END = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/; // "24:00" = end of day, the only way to run until midnight
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

/** Why a window list cannot be saved, or null. A window must end after it starts on the same day: windows that cross
 *  midnight are not supported in v1 (split them into "until 23:59" and "from 00:00" on the next day). */
export function happyHourProblem(windows: unknown): "COUNT" | "SHAPE" | "TIME" | "MIDNIGHT" | null {
  if (!Array.isArray(windows) || windows.length > HAPPY_HOUR_MAX_WINDOWS) return "COUNT";
  for (const w of windows) {
    if (!w || typeof w !== "object" || !Array.isArray(w.days) || typeof w.start !== "string" || typeof w.end !== "string"
      || Object.keys(w).length !== 3 || w.days.length === 0 || new Set(w.days).size !== w.days.length
      || !w.days.every((d: unknown) => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)) return "SHAPE";
    if (!START.test(w.start) || !END.test(w.end)) return "TIME";
    if (minutes(w.end) <= minutes(w.start)) return "MIDNIGHT";
  }
  return null;
}

const WEEKDAY = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 } as const;

/** The window that is running at `at` in `timeZone`, or null. Start is inclusive, end exclusive. Local wall-clock time
 *  decides, so on the autumn clock change the repeated hour counts twice and the skipped spring hour never happens. */
export function activeHappyHour(windows: HappyHourWindow[], at: Date, timeZone: string): HappyHourWindow | null {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (type: string) => parts.find(p => p.type === type)!.value;
  const day = WEEKDAY[get("weekday") as keyof typeof WEEKDAY];
  const now = Number(get("hour")) * 60 + Number(get("minute"));
  return windows.find(w => w.days.includes(day) && now >= minutes(w.start) && now < minutes(w.end)) ?? null;
}

const DAY_NAMES = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/** „Mo–Fr 14:00–17:00: doppelte Punkte“ */
export function happyHourSentence(w: HappyHourWindow): string {
  const days = [...w.days].sort((a, b) => a - b);
  const runs: number[][] = [];
  for (const d of days) { const last = runs[runs.length - 1]; if (last && d === last[last.length - 1] + 1) last.push(d); else runs.push([d]); }
  const label = days.length === 7 ? "täglich" : runs.map(r => r.length >= 3 ? `${DAY_NAMES[r[0] - 1]}–${DAY_NAMES[r[r.length - 1] - 1]}` : r.map(d => DAY_NAMES[d - 1]).join(", ")).join(", ");
  return `${label} ${w.start}–${w.end}: doppelte Punkte`;
}
