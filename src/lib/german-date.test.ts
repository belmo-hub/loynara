import { describe, expect, it } from "vitest";
import { germanDate } from "./german-date";

describe("germanDate", () => {
  it("short: contract and billing dates with no leading zeros", () => {
    expect(germanDate("2026-12-01")).toBe("1.12.2026");
    expect(germanDate("2026-11-30")).toBe("30.11.2026");
    expect(germanDate("2026-11-01T10:00:00Z")).toBe("1.11.2026");
    expect(germanDate("2026-11-30T23:30:00Z")).toBe("1.12.2026"); // a timestamp is the Berlin day
    expect(germanDate("not a date")).toBe("");
  });

  it("long: the year only when it isn't the current Berlin year", () => {
    const now = new Date("2026-11-07T12:00:00Z");
    expect(germanDate("2026-12-04", "long", { now })).toBe("4.\u00a0Dezember");
    expect(germanDate("2027-01-01", "long", { now })).toBe("1.\u00a0Januar 2027");
    expect(germanDate("2026-12-01T09:00:00Z", "long", { now })).toBe("1.\u00a0Dezember");
  });

  it("long: the year boundary is Berlin's, not UTC's", () => {
    // 31 Dec 23:30 UTC is already 1 January in Berlin: the new year counts as the current one.
    const now = new Date("2026-12-31T23:30:00Z");
    expect(germanDate("2027-01-04", "long", { now })).toBe("4.\u00a0Januar");
    expect(germanDate("2026-12-31", "long", { now })).toBe("31.\u00a0Dezember 2026");
    // And the evening before, still 2026 in Berlin.
    expect(germanDate("2027-01-04", "long", { now: new Date("2026-12-31T22:30:00Z") })).toBe("4.\u00a0Januar 2027");
  });

  it("feed: day, month and time, no leading zero on day or month", () => {
    expect(germanDate("2026-10-29T11:43:00Z", "feed")).toBe("29.10., 12:43"); // the shop's clock by default (time-zone rule, 22 Nov)
    expect(germanDate("2026-10-29T11:43:00Z", "feed", { timeZone: "Europe/Berlin" })).toBe("29.10., 12:43");
    expect(germanDate("2026-10-09T06:05:00Z", "feed", { timeZone: "Europe/Berlin" })).toBe("9.10., 08:05");
  });
});
