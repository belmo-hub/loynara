import { describe, expect, it } from "vitest";
import { activeHappyHour, happyHourProblem, happyHourSentence, type HappyHourWindow } from "./happy-hour";

const weekdays: HappyHourWindow = { days: [1, 2, 3, 4, 5], start: "14:00", end: "17:00" };
const BERLIN = "Europe/Berlin";

describe("activeHappyHour", () => {
  it("includes the start minute and excludes the end minute", () => {
    // Monday 19 Oct 2026, CEST (UTC+2).
    expect(activeHappyHour([weekdays], new Date("2026-10-19T11:59:59Z"), BERLIN)).toBeNull();
    expect(activeHappyHour([weekdays], new Date("2026-10-19T12:00:00Z"), BERLIN)).toBe(weekdays);
    expect(activeHappyHour([weekdays], new Date("2026-10-19T14:59:59Z"), BERLIN)).toBe(weekdays);
    expect(activeHappyHour([weekdays], new Date("2026-10-19T15:00:00Z"), BERLIN)).toBeNull();
  });

  it("uses the shop's timezone and weekday, not UTC", () => {
    // Saturday 24 Oct 2026 22:30Z is already Sunday 00:30 in Berlin; Sunday is not in the window.
    expect(activeHappyHour([{ days: [7], start: "00:00", end: "01:00" }], new Date("2026-10-24T22:30:00Z"), BERLIN)).not.toBeNull();
    expect(activeHappyHour([{ days: [6], start: "00:00", end: "01:00" }], new Date("2026-10-24T22:30:00Z"), BERLIN)).toBeNull();
    // 12:00Z is 08:00 in New York, outside the window.
    expect(activeHappyHour([weekdays], new Date("2026-10-19T12:00:00Z"), "America/New_York")).toBeNull();
  });

  it("follows wall-clock time over the clock change on Sunday 25 Oct 2026 (03:00 CEST -> 02:00 CET)", () => {
    const night: HappyHourWindow = { days: [7], start: "02:00", end: "03:00" };
    // 02:30 happens twice: 00:30Z (CEST) and 01:30Z (CET). Both are inside; 03:00 CET (02:00Z) is the exclusive end.
    expect(activeHappyHour([night], new Date("2026-10-25T00:30:00Z"), BERLIN)).toBe(night);
    expect(activeHappyHour([night], new Date("2026-10-25T01:30:00Z"), BERLIN)).toBe(night);
    expect(activeHappyHour([night], new Date("2026-10-25T01:59:59Z"), BERLIN)).toBe(night);
    expect(activeHappyHour([night], new Date("2026-10-25T02:00:00Z"), BERLIN)).toBeNull();
    // An afternoon window keeps its local hours on the day after the change: 14:00 CET is 13:00Z.
    expect(activeHappyHour([{ days: [7], start: "14:00", end: "17:00" }], new Date("2026-10-25T13:00:00Z"), BERLIN)).not.toBeNull();
    expect(activeHappyHour([{ days: [7], start: "14:00", end: "17:00" }], new Date("2026-10-25T12:59:00Z"), BERLIN)).toBeNull();
  });
});

describe("happyHourProblem", () => {
  it("accepts up to three same-day windows, including none", () => {
    expect(happyHourProblem([])).toBeNull();
    expect(happyHourProblem([weekdays, weekdays, { days: [6], start: "10:00", end: "24:00" }])).toBeNull();
  });
  it("refuses windows that cross midnight or are empty", () => {
    expect(happyHourProblem([{ days: [1], start: "22:00", end: "02:00" }])).toBe("MIDNIGHT");
    expect(happyHourProblem([{ days: [1], start: "14:00", end: "14:00" }])).toBe("MIDNIGHT");
  });
  it("refuses a fourth window, bad times, bad days and extra fields", () => {
    expect(happyHourProblem([weekdays, weekdays, weekdays, weekdays])).toBe("COUNT");
    expect(happyHourProblem("x")).toBe("COUNT");
    expect(happyHourProblem([{ ...weekdays, start: "9:00" }])).toBe("TIME");
    expect(happyHourProblem([{ ...weekdays, start: "24:00" }])).toBe("TIME");
    expect(happyHourProblem([{ ...weekdays, days: [] }])).toBe("SHAPE");
    expect(happyHourProblem([{ ...weekdays, days: [0] }])).toBe("SHAPE");
    expect(happyHourProblem([{ ...weekdays, days: [1, 1] }])).toBe("SHAPE");
    expect(happyHourProblem([{ ...weekdays, multiplier: 5 }])).toBe("SHAPE");
  });
});

describe("happyHourSentence", () => {
  it("names the days and the times", () => {
    expect(happyHourSentence(weekdays)).toBe("Mo–Fr 14:00–17:00: doppelte Punkte");
    expect(happyHourSentence({ days: [2, 4], start: "09:00", end: "11:30" })).toBe("Di, Do 09:00–11:30: doppelte Punkte");
    expect(happyHourSentence({ days: [6, 7], start: "10:00", end: "12:00" })).toBe("Sa, So 10:00–12:00: doppelte Punkte");
    expect(happyHourSentence({ days: [1, 2, 3, 4, 5, 6, 7], start: "14:00", end: "17:00" })).toBe("täglich 14:00–17:00: doppelte Punkte");
  });
});
