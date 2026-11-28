import { expect, it } from "vitest";
import { addDays, instantToWall, wallToInstant } from "./time";

const tz = "Europe/Berlin";

it("returns null in the spring-forward gap and the first occurrence in the repeated autumn hour", () => {
  expect(wallToInstant("2027-03-28", "02:30", tz)).toBeNull();
  expect(wallToInstant("2027-10-31", "02:30", tz)?.toISOString()).toBe("2027-10-31T00:30:00.000Z");
});

it("turns Berlin wall time into the right instant on both sides of the 25 Oct 2026 change", () => {
  expect(wallToInstant("2026-10-25", "09:00", tz)?.toISOString()).toBe("2026-10-25T08:00:00.000Z");
  expect(wallToInstant("2026-10-24", "09:00", tz)?.toISOString()).toBe("2026-10-24T07:00:00.000Z");
  expect(wallToInstant("2026-10-24", "24:00", tz)?.toISOString()).toBe("2026-10-24T22:00:00.000Z");
});

it("reads an instant back as wall clock and walks calendar days", () => {
  expect(instantToWall(new Date("2026-10-25T08:00:00Z"), tz)).toEqual({ date: "2026-10-25", time: "09:00", second: 0, weekday: 7 });
  expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  expect(addDays("2026-03-28", 1)).toBe("2026-03-29");
});
