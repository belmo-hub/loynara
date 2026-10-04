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
});
