import { describe, expect, it } from "vitest";
import { readBoardCache, standLabel, type BoardCache } from "./board-cache";

const cache = (at: string): BoardCache => ({ at, board: { timezone: "Europe/Berlin", today: "2026-11-04", days: [], lastBookingOn: null, fullTwoWeeks: false, over90: false, bookings: 3 } });

describe("the board's last numbers on this device (ENG-085)", () => {
  it("is used for 7 days at most and never when unreadable", () => {
    const now = Date.parse("2026-11-04T11:00:00Z");
    expect(readBoardCache(JSON.stringify(cache("2026-10-28T11:00:00Z")), now)?.board.bookings).toBe(3);
    expect(readBoardCache(JSON.stringify(cache("2026-10-28T10:59:59Z")), now)).toBeNull();
    expect(readBoardCache(JSON.stringify(cache("2026-11-05T11:00:00Z")), now)).toBeNull(); // from the future: not trusted
    expect(readBoardCache("{not json", now)).toBeNull();
    expect(readBoardCache(null, now)).toBeNull();
  });
  it("says „Stand heute, 9:14“, „Stand gestern“ or the weekday, in the location's time, never seconds", () => {
    const now = new Date("2026-11-04T15:00:00Z"); // Wednesday, 16:00 in Berlin
    expect(standLabel("2026-11-04T08:14:59Z", now, "Europe/Berlin")).toBe("Stand heute, 9:14");
    expect(standLabel("2026-11-03T22:59:00Z", now, "Europe/Berlin")).toBe("Stand gestern"); // 23:59 the day before
    expect(standLabel("2026-11-03T23:00:00Z", now, "Europe/Berlin")).toBe("Stand heute, 0:00"); // local midnight
    expect(standLabel("2026-11-03T21:00:00Z", now, "Europe/Berlin")).toBe("Stand gestern");
    expect(standLabel("2026-11-02T10:00:00Z", now, "Europe/Berlin")).toBe("Stand Montag");
  });
});
