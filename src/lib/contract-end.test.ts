import { describe, expect, it } from "vitest";
import { billingDaysBetween, isBillingMonthEnd, laterEnds, nextBillingMonthEnd, noticeEnd } from "./contract-end";

describe("contract end dates (pilot § 2, ENG-167)", () => {
  it("ends a billing month the day before the billing day; a shorter month uses its last day", () => {
    expect(isBillingMonthEnd("2026-11-27", 28)).toBe(true);
    expect(isBillingMonthEnd("2026-11-30", 28)).toBe(false);
    // Go-live on the 31st: billing on 31.01., 28.02., 31.03.: months end 27.02. and 30.03.
    expect(isBillingMonthEnd("2027-02-27", 31)).toBe(true);
    expect(isBillingMonthEnd("2027-03-30", 31)).toBe(true);
    expect(isBillingMonthEnd("2027-02-28", 31)).toBe(false);
    expect(nextBillingMonthEnd("2027-02-28", 31)).toBe("2027-03-30");
    // Leap year: billing on 29.02.2028, so February's month ends 28.02.
    expect(isBillingMonthEnd("2028-02-28", 31)).toBe(true);
  });

  it("finding the next end is bounded: a broken anchor fails loudly instead of spinning (review N-4)", () => {
    expect(() => nextBillingMonthEnd("2026-11-01", 0)).toThrow(/No billing-month end within 62 days/);
  });

  it("counts 14 days' notice from the request day: by 13.11. ends 27.11., from 14.11. ends 27.12. (spec worked example)", () => {
    expect(noticeEnd({ requestDay: "2026-11-13", anchorDay: 28, lastFreeDay: null })).toEqual({ endDate: "2026-11-27", freeMonth: false, late: null });
    expect(noticeEnd({ requestDay: "2026-11-14", anchorDay: 28, lastFreeDay: null })).toEqual({ endDate: "2026-12-27", freeMonth: false, late: { missedEnd: "2026-11-27", cutoff: "2026-11-13" } });
    expect(noticeEnd({ requestDay: "2026-11-01", anchorDay: 28, lastFreeDay: null }).endDate).toBe("2026-11-27");
    expect(noticeEnd({ requestDay: "2026-11-18", anchorDay: 28, lastFreeDay: null }).endDate).toBe("2026-12-27");
  });

  it("in the free month: the later of the last free day and request + 14 (Legal, 1 Nov), never late", () => {
    // Barbier Nord: go-live 20.10., last free day 19.11.
    expect(noticeEnd({ requestDay: "2026-11-01", anchorDay: 20, lastFreeDay: "2026-11-19" })).toEqual({ endDate: "2026-11-19", freeMonth: true, late: null });
    expect(noticeEnd({ requestDay: "2026-11-12", anchorDay: 20, lastFreeDay: "2026-11-19" })).toEqual({ endDate: "2026-11-26", freeMonth: true, late: null });
    expect(noticeEnd({ requestDay: "2026-11-19", anchorDay: 20, lastFreeDay: "2026-11-19" }).endDate).toBe("2026-12-03");
    // The day after the last free day is a paid-month request.
    expect(noticeEnd({ requestDay: "2026-11-20", anchorDay: 20, lastFreeDay: "2026-11-19" })).toMatchObject({ endDate: "2026-12-19", freeMonth: false });
  });

  it("lists the billing days that still open a month up to the end, and later ends one month apart", () => {
    expect(billingDaysBetween("2026-11-01", "2026-11-27", 28)).toEqual([]);
    expect(billingDaysBetween("2026-11-18", "2027-01-27", 28)).toEqual(["2026-11-28", "2026-12-28"]);
    expect(billingDaysBetween("2026-11-28", "2026-12-27", 28)).toEqual([]);
    expect(laterEnds("2026-11-27", 28, 2)).toEqual(["2026-12-27", "2027-01-27"]);
    expect(laterEnds("2027-01-30", 31, 2)).toEqual(["2027-02-27", "2027-03-30"]);
  });
});
