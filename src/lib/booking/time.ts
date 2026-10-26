// Wall clock in the location's timezone <-> instants, with the Intl pattern of happy-hour.ts and promotion-policy.ts.

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

/** The wall clock at `instant` in `timeZone`: date YYYY-MM-DD, time HH:MM, ISO weekday (1 = Monday). */
export function instantToWall(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(instant).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, second: Number(parts.second), weekday: WEEKDAY[parts.weekday] };
}

const wallMs = (date: string, time: string) => Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), Number(time.slice(0, 2)), Number(time.slice(3, 5)));

/** The instant of a wall-clock time; null in the spring-forward gap, the first occurrence in the repeated autumn hour. "24:00" = next midnight. */
export function wallToInstant(date: string, time: string, timeZone: string): Date | null {
  const wall = wallMs(date, time);
  const offset = (at: number) => { const w = instantToWall(new Date(at), timeZone); return wallMs(w.date, w.time) - at; };
  // The offsets 12 h either side cover both readings of a wall time next to a change.
  const candidates = [wall - offset(wall - 43_200_000), wall - offset(wall + 43_200_000)].filter(at => offset(at) === wall - at).sort((a, b) => a - b);
  return candidates.length ? new Date(candidates[0]) : null;
}

/** YYYY-MM-DD plus `days` calendar days. */
export function addDays(date: string, days: number) {
  return new Date(wallMs(date, "00:00") + days * 86_400_000).toISOString().slice(0, 10);
}
