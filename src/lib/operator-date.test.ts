import { expect, it } from "vitest";
import { earliestEndDate } from "./operator-date";

it("is tomorrow's Berlin day, across midnight, the year end and the zone offset", () => {
  expect(earliestEndDate(new Date("2026-10-21T10:00:00Z"))).toBe("2026-10-22");
  expect(earliestEndDate(new Date("2026-10-21T22:30:00Z"))).toBe("2026-10-23"); // already the 22nd in Berlin
  expect(earliestEndDate(new Date("2026-12-31T12:00:00Z"))).toBe("2027-01-01");
  expect(earliestEndDate(new Date("2026-10-31T23:30:00Z"))).toBe("2026-11-02");
});
