import { describe, expect, it } from "vitest";
import { bookingsText, dayLabel, greeting, headline, localNow, quietDays, type DayCount } from "./overview-day";

const NBSP = "\u00a0";
/** 15 local days ending yesterday (20.10.–3.11.2026, across the 25 Oct clock change), with the given counts, oldest first. */
const days = (counts: number[]): DayCount[] => counts.map((bookings, index) => {
  const date = new Date(Date.UTC(2026, 9, 20 + index, 12));
  return { date: date.toISOString().slice(0, 10), bookings };
});
const quiet14 = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

describe("Übersicht headline rules (spec §3)", () => {
  const today = "2026-11-04";
  it("1: yesterday beat every one of the 14 days before, with at least 2 bookings and two complete weeks", () => {
    expect(headline({ days: days([1, 0, 2, 0, 1, 0, 0, 0, 1, 1, 0, 0, 0, 2, 3]), lastBookingOn: "2026-11-03", today, fullTwoWeeks: true }))
      .toBe(`Gestern war der beste Tag seit zwei Wochen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
  });
  it("1 needs a strict best (a tie gets rule 2), at least 2 bookings, and complete weeks (a shop younger than 15 days gets rule 2)", () => {
    expect(headline({ days: days([...quiet14.slice(0, 13), 3, 3]), lastBookingOn: "2026-11-03", today, fullTwoWeeks: true })).toBe(`Gestern: 3${NBSP}Buchungen am${NBSP}Tresen.`);
    expect(headline({ days: days([...quiet14, 1]), lastBookingOn: "2026-11-03", today, fullTwoWeeks: true })).toBe(`Gestern: 1${NBSP}Buchung am${NBSP}Tresen.`);
    expect(headline({ days: days([...quiet14, 3]), lastBookingOn: "2026-11-03", today, fullTwoWeeks: false })).toBe(`Gestern: 3${NBSP}Buchungen am${NBSP}Tresen.`);
  });
  it("3: none yesterday, some in the 7 days ending yesterday", () => {
    expect(headline({ days: days([5, 5, 5, 5, 5, 5, 5, 5, 1, 0, 1, 0, 1, 0, 0]), lastBookingOn: "2026-11-01", today, fullTwoWeeks: true }))
      .toBe(`In den letzten 7 Tagen: 3${NBSP}Buchungen am${NBSP}Tresen.`);
  });
  it("4: a quiet week names the day of the last booking; never a negative comparison", () => {
    const text = headline({ days: days([2, 1, 3, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), lastBookingOn: "2026-10-23", today, fullTwoWeeks: true });
    expect(text).toBe("Eine ruhige Woche. Die letzte Buchung war am Freitag, 23.10.");
    expect(text).not.toMatch(/weniger|nur noch|schlechter/);
  });
  it("5: never a booking, no headline; bookings only today, no headline yet", () => {
    expect(headline({ days: days([...quiet14, 0]), lastBookingOn: null, today, fullTwoWeeks: false })).toBeNull();
    expect(headline({ days: days([...quiet14, 0]), lastBookingOn: today, today, fullTwoWeeks: false })).toBeNull();
  });
});

describe("quiet-week next step (spec §2.3)", () => {
  it("fires at 7 days since the last booking, not at 6", () => {
    expect(quietDays("2026-10-28", "2026-11-03")).toBeNull();
    expect(quietDays("2026-10-27", "2026-11-03")).toBe(7);
    expect(quietDays("2026-10-21", "2026-10-29")).toBe(8);
    expect(quietDays(null, "2026-10-29")).toBeNull();
  });
  it("counts calendar days across the clock change", () => {
    expect(quietDays("2026-10-24", "2026-10-31")).toBe(7);
  });
});

describe("greeting and local days", () => {
  it("greets by the location's hour: before 11, until 17, after", () => {
    expect([10, 11, 16, 17].map(greeting)).toEqual(["Guten Morgen", "Guten Tag", "Guten Tag", "Guten Abend"]);
    expect(localNow(new Date("2026-10-25T00:30:00Z"), "Europe/Berlin")).toEqual({ date: "2026-10-25", hour: 2 });
    expect(localNow(new Date("2026-10-24T22:30:00Z"), "Europe/Berlin")).toEqual({ date: "2026-10-25", hour: 0 });
  });
  it("labels days the German way and keeps a number with its noun", () => {
    expect(dayLabel("2026-10-21")).toBe("Mittwoch, 21.10.");
    expect(bookingsText(1)).toBe(`1${NBSP}Buchung`);
    expect(bookingsText(1200)).toBe(`1.200${NBSP}Buchungen`);
  });
});
