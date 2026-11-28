import type { WorkingDay } from "@/db/schema";
import { addDays, instantToWall, wallToInstant } from "./time";

export const GRID_MIN = 15;

export type SlotStaff = { id: string; sort: number; workingHours: WorkingDay[]; serviceIds: string[] };
export type Busy = { staffId: string | null; start: Date; end: Date };
export type SlotInput = {
  days: string[];
  service: { id: string; durationMin: number; bufferMin: number };
  staff: SlotStaff[];
  /** staffId null = the whole shop. */
  blocks: Busy[];
  /** Open appointments only. */
  appointments: Busy[];
  settings: { leadTimeMin: number; maxDaysAhead: number };
  now: Date;
  tz: string;
};

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const overlaps = (start: number, end: number, busy: { start: Date; end: Date }) => busy.start.getTime() < end && start < busy.end.getTime();

/**
 * Free starts per day on the 15-minute wall-clock grid. A start fits when [start, start + duration + buffer) lies inside a
 * working window minus its breaks and overlaps no block and no open appointment of that staff member. Several staff
 * ("Egal wer"): one slot per start, the staff member with the lowest `sort` wins. Staff with an empty service list offer all.
 */
export function slots(input: SlotInput): { date: string; slots: { start: Date; staffId: string }[] }[] {
  const { service, now, tz } = input;
  const earliest = now.getTime() + input.settings.leadTimeMin * 60_000;
  const lastDay = addDays(instantToWall(now, tz).date, input.settings.maxDaysAhead);
  const length = (service.durationMin + service.bufferMin) * 60_000;
  const staff = input.staff.filter(s => s.serviceIds.length === 0 || s.serviceIds.includes(service.id)).sort((a, b) => a.sort - b.sort);
  return input.days.map(date => {
    const found = new Map<number, string>();
    if (date <= lastDay) {
      const weekday = new Date(`${date}T00:00:00Z`).getUTCDay() || 7;
      for (const member of staff) {
        const busy = [...input.blocks.filter(b => b.staffId === null || b.staffId === member.id), ...input.appointments.filter(a => a.staffId === member.id)];
        for (const window of member.workingHours.filter(w => w.weekday === weekday)) {
          const close = wallToInstant(date, window.end, tz)?.getTime();
          if (close === undefined) continue;
          const breaks = window.breaks.flatMap(b => { const start = wallToInstant(date, b.start, tz), end = wallToInstant(date, b.end, tz); return start && end ? [{ start, end }] : []; });
          for (let m = Math.ceil(minutes(window.start) / GRID_MIN) * GRID_MIN; m < minutes(window.end); m += GRID_MIN) {
            const start = wallToInstant(date, hhmm(m), tz)?.getTime();
            if (start === undefined || start < earliest || found.has(start)) continue;
            const end = start + length;
            if (end > close || breaks.some(b => overlaps(start, end, b)) || busy.some(b => overlaps(start, end, b))) continue;
            found.set(start, member.id);
          }
        }
      }
    }
    return { date, slots: [...found].sort(([a], [b]) => a - b).map(([start, staffId]) => ({ start: new Date(start), staffId })) };
  });
}
