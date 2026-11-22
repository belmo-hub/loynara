import { describe, expect, it } from "vitest";
import { dayProblem, defaultTerms, durationLabel, fromDays, hoursProblem, parsePrice, priceText, sameHours, toDays, unionHours, withinHours } from "./booking-setup-helpers";

const open = { open: true, start: "09:00", end: "18:00", breakStart: "", breakEnd: "" };

describe("booking set-up helpers", () => {
  it("round-trips working hours with one break and closed days", () => {
    const hours = [{ weekday: 2, start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "13:30" }] }, { weekday: 6, start: "10:00", end: "14:00", breaks: [] }];
    const days = toDays(hours);
    expect(days.map(day => day.open)).toEqual([false, true, false, false, false, true, false]);
    expect(fromDays(days)).toEqual(hours);
    expect(sameHours(hours, [...hours].reverse())).toBe(true);
    expect(sameHours(hours, hours.slice(1))).toBe(false);
  });
  it("names the problem of a day in one line", () => {
    expect(dayProblem(open)).toBe("");
    expect(dayProblem({ ...open, end: "08:00" })).toMatch(/Ende/);
    expect(dayProblem({ ...open, breakStart: "13:00" })).toMatch(/Pause/);
    expect(dayProblem({ ...open, breakStart: "08:00", breakEnd: "08:30" })).toMatch(/in den Öffnungszeiten/);
    expect(dayProblem({ ...open, open: false, end: "01:00" })).toBe("");
    expect(hoursProblem(toDays([]))).toMatch(/Mindestens ein Tag/);
    expect(hoursProblem([open, { ...open, end: "08:00" }])).toMatch(/^Dienstag:/);
  });
  it("joins everyone's hours per weekday without breaks", () => {
    const lena = [1, 2, 3, 4, 5].map(weekday => ({ weekday, start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "13:30" }] }));
    const sara = [{ weekday: 5, start: "08:00", end: "14:00", breaks: [] }, { weekday: 6, start: "10:00", end: "16:00", breaks: [] }];
    const union = unionHours([lena, sara]);
    expect(union.map(day => day.weekday)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(union[4]).toEqual({ weekday: 5, start: "08:00", end: "18:00", breaks: [] });
    expect(union[5]).toEqual({ weekday: 6, start: "10:00", end: "16:00", breaks: [] });
    expect(withinHours(toDays(sara), toDays(union))).toBe("");
    expect(withinHours(toDays(lena), toDays(union))).toBe("");
    expect(unionHours([])).toEqual([]);
  });
  it("parses and prints euro prices", () => {
    expect(parsePrice("25")).toBe(2500);
    expect(parsePrice("12,5")).toBe(1250);
    expect(parsePrice("12.90")).toBe(1290);
    expect(parsePrice("0")).toBe(0);
    expect(parsePrice("1000")).toBe(100000);
    for (const bad of ["", "abc", "-5", "1001", "12,999"]) expect(parsePrice(bad)).toBeNull();
    expect(priceText(2500)).toBe("25");
    expect(priceText(1250)).toBe("12,50");
  });
  it("labels durations", () => {
    expect(durationLabel(45)).toBe("45 Min.");
    expect(durationLabel(60)).toBe("1 Std.");
    expect(durationLabel(90)).toBe("1 Std. 30 Min.");
    expect(durationLabel(65)).toBe("1 Std. 5 Min.");
    expect(durationLabel(135)).toBe("2 Std. 15 Min.");
  });
  it("default terms name the deadline, the reschedule cap and the no-show pause", () => {
    expect(defaultTerms({ cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, noShowBlockAfter: 3 })).toBe("Absagen bitte bis 24 Stunden vorher; später zählt es als kurzfristige Absage. Verschieben geht online bis 24 Stunden vorher, bis zu 2-mal im Monat. Nach 3 verpassten Terminen ohne Absage ist die Online-Buchung für dich pausiert; ruf dann kurz an.");
    const lenient = defaultTerms({ cancelDeadlineHours: 0, maxReschedulesPerMonth: 0, noShowBlockAfter: 0 });
    expect(lenient).toMatch(/jederzeit/);
    expect(lenient).not.toMatch(/pausiert/);
    expect(defaultTerms({ cancelDeadlineHours: 48, maxReschedulesPerMonth: 1, noShowBlockAfter: 1 })).toMatch(/2 Tage vorher/);
    expect(defaultTerms({ cancelDeadlineHours: 48, maxReschedulesPerMonth: 1, noShowBlockAfter: 1 })).toMatch(/Nach 1 verpassten Termin ohne/);
  });
  it("keeps a person's own hours inside the opening hours", () => {
    const shop = toDays([{ weekday: 1, start: "09:00", end: "18:00", breaks: [] }]);
    expect(withinHours(toDays([{ weekday: 1, start: "10:00", end: "14:00", breaks: [] }]), shop)).toBe("");
    expect(withinHours(toDays([{ weekday: 1, start: "08:00", end: "14:00", breaks: [] }]), shop)).toBe("Montag: Die Zeiten müssen in den Öffnungszeiten liegen.");
    expect(withinHours(toDays([{ weekday: 2, start: "10:00", end: "14:00", breaks: [] }]), shop)).toMatch(/^Dienstag:/);
  });
});
