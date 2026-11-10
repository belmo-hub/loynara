import { describe, expect, it } from "vitest";
import { FIRST_OPEN_WINDOW_MS, unseenAwards } from "./booking-moment";

const now = Date.parse("2026-11-10T12:00:00Z");
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const award = (minutesAgo: number, delta = 1) => ({ kind: "award", delta, createdAt: at(minutesAgo) });

describe("the bookings a device has not shown yet", () => {
  it("adds up every booking since the record, bonuses included", () => {
    expect(unseenAwards([award(1), award(1, 1), award(300)], at(60), now)).toEqual({ credited: 2, newest: at(1) });
  });
  it("shows nothing twice: a booking at or before the record is seen", () => {
    expect(unseenAwards([award(5)], at(5), now).credited).toBe(0);
  });
  it("never plays for a redemption or a correction, and stops counting below one", () => {
    expect(unseenAwards([{ kind: "redemption", delta: -8, createdAt: at(1) }, award(2)], at(60), now).credited).toBe(0);
    expect(unseenAwards([award(1, 24), { kind: "reversal", delta: -1, createdAt: at(2) }, award(3)], at(60), now).credited).toBe(24);
    expect(unseenAwards([{ kind: "award", delta: 0, createdAt: at(1) }], at(60), now).credited).toBe(0);
  });
  it("on a device without a record, plays only for a booking from the last ten minutes", () => {
    expect(unseenAwards([award(9)], null, now).credited).toBe(1);
    expect(unseenAwards([award(FIRST_OPEN_WINDOW_MS / 60_000 + 1)], null, now).credited).toBe(0);
  });
  it("names the newest entry as the next record, whatever it is, and none for an empty card", () => {
    expect(unseenAwards([{ kind: "redemption", delta: -8, createdAt: at(1) }, award(2)], null, now).newest).toBe(at(1));
    expect(unseenAwards([], null, now)).toEqual({ credited: 0, newest: null });
  });
});
