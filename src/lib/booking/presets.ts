import type { WorkingDay } from "@/db/schema";

// Starting points for the set-up wizard; every price is an illustration the owner edits.
const days = (from: number, to: number, start: string, end: string, breaks: WorkingDay["breaks"]): WorkingDay[] =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ weekday: from + i, start, end, breaks }));
const service = (name: string, durationMin: number, priceEuro: number, rebookAfterDays: number, priceFrom = false) =>
  ({ name, durationMin, bufferMin: 0, priceMinor: priceEuro * 100, priceFrom, rebookAfterDays });

const tuesdayToSaturday = days(2, 6, "09:00", "18:00", [{ start: "13:00", end: "13:30" }]);

export const PRESETS = {
  nagelstudio: {
    autoConfirm: false,
    workingHours: tuesdayToSaturday,
    services: [service("Maniküre", 45, 35, 21), service("Gel neu", 90, 55, 21, true), service("Auffüllen", 60, 40, 21), service("Pediküre", 60, 45, 21)],
  },
  barber: {
    autoConfirm: true,
    workingHours: days(1, 6, "09:00", "19:00", []),
    services: [service("Haarschnitt", 30, 25, 35), service("Bart", 15, 12, 35), service("Haare + Bart", 45, 35, 35), service("Kinderhaarschnitt", 20, 18, 35)],
  },
  kosmetik: {
    autoConfirm: false,
    workingHours: tuesdayToSaturday,
    services: [service("Gesichtsbehandlung", 60, 65, 42), service("Augenbrauen", 20, 15, 42), service("Wimpern", 90, 80, 42, true)],
  },
};
