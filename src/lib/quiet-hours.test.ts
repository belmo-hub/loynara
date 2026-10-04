import { describe, expect, it } from "vitest";
import { quietHoursDeferral } from "./promotion-policy";

const at = (iso: string) => new Date(iso);
describe("quiet hours in the location's timezone", () => {
  it("allows sends between 09:00 and 21:00 local time", () => {
    expect(quietHoursDeferral(at("2026-10-05T07:00:00Z"), "Europe/Berlin")).toBeNull(); // 09:00 CEST
    expect(quietHoursDeferral(at("2026-10-05T18:59:59Z"), "Europe/Berlin")).toBeNull(); // 20:59:59 CEST
  });
  it("defers evening sends to 09:00 the next local morning", () => {
    expect(quietHoursDeferral(at("2026-10-05T19:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-06T07:00:00.000Z");
  });
  it("defers early-morning sends to 09:00 the same local day", () => {
    expect(quietHoursDeferral(at("2026-10-05T04:30:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-05T07:00:00.000Z");
  });
  it("handles the night the clocks go back (CEST to CET)", () => {
    // 2026-10-25: 03:00 CEST becomes 02:00 CET. 22:00 CEST on the 24th defers to 09:00 CET (08:00Z) on the 25th.
    expect(quietHoursDeferral(at("2026-10-24T20:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  });
  it("handles the night the clocks go forward (CET to CEST)", () => {
    // 2027-03-28: 02:00 CET becomes 03:00 CEST. 23:00 CET on the 27th defers to 09:00 CEST (07:00Z) on the 28th.
    expect(quietHoursDeferral(at("2027-03-27T22:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-03-28T07:00:00.000Z");
  });
  it("uses the location's own zone, not the server's", () => {
    // 20:30 in Casablanca (UTC+1 in October 2026) is allowed; the same instant is 21:30 in Berlin.
    expect(quietHoursDeferral(at("2026-10-05T19:30:00Z"), "Africa/Casablanca")).toBeNull();
    expect(quietHoursDeferral(at("2026-10-05T19:30:00Z"), "Europe/Berlin")).not.toBeNull();
  });

  it("treats 21:00:00 as quiet and 20:59:59 as open, 08:59:59 as quiet and 09:00:00 as open", () => {
    expect(quietHoursDeferral(at("2026-07-01T18:59:59Z"), "Europe/Berlin")).toBeNull(); // 20:59:59 CEST
    expect(quietHoursDeferral(at("2026-07-01T19:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-07-02T07:00:00.000Z");
    expect(quietHoursDeferral(at("2026-07-02T06:59:59Z"), "Europe/Berlin")?.toISOString()).toBe("2026-07-02T07:00:00.000Z");
    expect(quietHoursDeferral(at("2026-07-02T07:00:00Z"), "Europe/Berlin")).toBeNull();
  });

  it("crosses local midnight, including the last second of the month and year", () => {
    expect(quietHoursDeferral(at("2026-12-31T22:30:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-01-01T08:00:00.000Z"); // 23:30 CET -> 09:00 CET next year
    expect(quietHoursDeferral(at("2026-12-31T23:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-01-01T08:00:00.000Z"); // 00:00 CET
    expect(quietHoursDeferral(at("2026-09-30T21:59:59Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-01T07:00:00.000Z"); // 23:59:59 CEST
    expect(quietHoursDeferral(at("2026-02-28T20:30:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-03-01T08:00:00.000Z"); // non-leap February
  });

  it("is correct on the day clocks go forward (Berlin, 2027-03-28)", () => {
    expect(quietHoursDeferral(at("2027-03-27T23:30:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-03-28T07:00:00.000Z"); // 00:30 CET -> 09:00 CEST
    expect(quietHoursDeferral(at("2027-03-28T06:59:59Z"), "Europe/Berlin")?.toISOString()).toBe("2027-03-28T07:00:00.000Z"); // 08:59:59 CEST
    expect(quietHoursDeferral(at("2027-03-28T07:30:00Z"), "Europe/Berlin")).toBeNull(); // 09:30 CEST
    expect(quietHoursDeferral(at("2027-03-28T19:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-03-29T07:00:00.000Z"); // 21:00 CEST
  });

  it("is correct on the day clocks go back (Berlin, 2026-10-25)", () => {
    expect(quietHoursDeferral(at("2026-10-24T22:30:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-25T08:00:00.000Z"); // 00:30 CEST -> 09:00 CET
    expect(quietHoursDeferral(at("2026-10-25T07:59:59Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-25T08:00:00.000Z"); // 08:59:59 CET
    expect(quietHoursDeferral(at("2026-10-25T08:30:00Z"), "Europe/Berlin")).toBeNull(); // 09:30 CET
    expect(quietHoursDeferral(at("2026-10-25T20:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2026-10-26T08:00:00.000Z"); // 21:00 CET
  });

  it("uses each zone's own transition dates (New York changes on 2027-03-14)", () => {
    expect(quietHoursDeferral(at("2027-03-14T04:00:00Z"), "America/New_York")?.toISOString()).toBe("2027-03-14T13:00:00.000Z"); // 00:00 EST -> 09:00 EDT
    expect(quietHoursDeferral(at("2027-03-14T13:00:00Z"), "America/New_York")).toBeNull();
    // On the same instant Berlin (still CET until 03-28) is in a different phase.
    expect(quietHoursDeferral(at("2027-03-14T13:00:00Z"), "Europe/Berlin")).toBeNull();
    expect(quietHoursDeferral(at("2027-03-14T20:00:00Z"), "Europe/Berlin")?.toISOString()).toBe("2027-03-15T08:00:00.000Z"); // 21:00 CET
  });
});
