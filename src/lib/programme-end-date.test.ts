import { describe, expect, it } from "vitest";
import { cancellationEnd, cancellationTimeline, germanDate, lastDayOfBerlinMonth, MIN_NOTICE_DAYS } from "./programme-end-date";

const end = (iso: string) => cancellationEnd(new Date(iso));

describe("cancellation end date with the minimum notice", () => {
  it("uses 14 days", () => { expect(MIN_NOTICE_DAYS).toBe(14); });

  it("keeps this month with 14 or more days left and moves to the next month with fewer", () => {
    expect(end("2026-10-17T10:00:00Z")).toEqual({ endDate: "2026-10-31", nextMonth: false }); // day 17 of 31: 14 left
    expect(end("2026-10-18T10:00:00Z")).toEqual({ endDate: "2026-11-30", nextMonth: true }); // day 18: 13 left
    expect(end("2026-10-31T10:00:00Z")).toEqual({ endDate: "2026-11-30", nextMonth: true }); // the last day itself
    expect(end("2026-10-01T10:00:00Z")).toEqual({ endDate: "2026-10-31", nextMonth: false });
  });

  it("runs from December into January and through short months", () => {
    expect(end("2026-12-17T10:00:00Z")).toEqual({ endDate: "2026-12-31", nextMonth: false });
    expect(end("2026-12-20T10:00:00Z")).toEqual({ endDate: "2027-01-31", nextMonth: true });
    expect(end("2026-02-14T10:00:00Z")).toEqual({ endDate: "2026-02-28", nextMonth: false });
    expect(end("2026-02-15T10:00:00Z")).toEqual({ endDate: "2026-03-31", nextMonth: true });
    expect(end("2028-02-15T10:00:00Z")).toEqual({ endDate: "2028-02-29", nextMonth: false });
  });

  it("counts Berlin calendar days at midnight and across both time changes", () => {
    expect(end("2026-10-17T21:59:59Z")).toEqual({ endDate: "2026-10-31", nextMonth: false }); // 23:59:59 on 17 Oct in Berlin (CEST)
    expect(end("2026-10-17T22:00:00Z")).toEqual({ endDate: "2026-11-30", nextMonth: true }); // 00:00 on 18 Oct
    expect(end("2026-03-17T22:59:59Z")).toEqual({ endDate: "2026-03-31", nextMonth: false }); // 23:59:59 on 17 Mar (CET)
    expect(end("2026-03-17T23:00:00Z")).toEqual({ endDate: "2026-04-30", nextMonth: true });
    expect(end("2026-03-28T23:30:00Z")).toEqual({ endDate: "2026-04-30", nextMonth: true }); // 29 Mar, the day the clocks go forward
    expect(end("2026-12-31T23:30:00Z")).toEqual({ endDate: "2027-01-31", nextMonth: false }); // already 1 January in Berlin
  });

  it("still formats the date for the owner and the card", () => {
    expect(lastDayOfBerlinMonth(new Date("2026-10-21T10:00:00Z"))).toBe("2026-10-31");
    expect(germanDate("2027-01-31")).toBe("31.01.2027");
  });
});

describe("cancellationTimeline", () => {
  const t = (end: string, now: string) => cancellationTimeline(end, new Date(now));
  it("counts Berlin calendar days: running before the end date, last-day on it, past after it", () => {
    expect(t("2026-11-30", "2026-11-10T10:00:00Z")).toMatchObject({ daysLeft: 20, phase: "running", exportUntil: "2026-12-30" });
    expect(t("2026-11-30", "2026-11-29T23:30:00Z")).toMatchObject({ daysLeft: 0, phase: "last-day" }); // already 30 Nov, 00:30 in Berlin
    expect(t("2026-11-30", "2026-11-30T22:59:59Z")).toMatchObject({ phase: "last-day" });
    expect(t("2026-11-30", "2026-11-30T23:00:00Z")).toMatchObject({ daysLeft: -1, phase: "past" });
  });
  it("is DST-safe across both time changes and a year end", () => {
    expect(t("2026-10-25", "2026-10-24T22:00:00Z")).toMatchObject({ phase: "last-day" }); // 00:00 CEST on the 25-hour day
    expect(t("2026-10-25", "2026-10-25T23:00:00Z")).toMatchObject({ phase: "past" });
    expect(t("2026-03-29", "2026-03-28T23:00:00Z")).toMatchObject({ phase: "last-day" }); // the 23-hour day
    expect(t("2026-12-31", "2026-12-30T23:00:00Z")).toMatchObject({ phase: "last-day", exportUntil: "2027-01-30" });
  });
});
