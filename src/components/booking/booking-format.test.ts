import { describe, expect, it } from "vitest";
import { attemptKey, daysWithSlots, formatDay, formatPrice, formatTime, formatWhen, wallDate } from "./booking-format";

describe("booking display helpers", () => {
  it("formats in the shop's zone, across the DST change", () => {
    expect(formatWhen("2026-10-28T09:00:00.000Z", "Europe/Berlin")).toBe("Mi 28.10., 10:00");
    expect(formatWhen("2026-10-24T22:30:00.000Z", "Europe/Berlin")).toBe("So 25.10., 00:30");
    expect(formatTime("2026-10-26T09:45:00.000Z", "Europe/Berlin")).toBe("10:45");
    expect(formatDay("2026-10-27")).toBe("Di 27.10.");
    expect(wallDate(new Date("2026-10-27T23:30:00Z"), "Europe/Berlin")).toBe("2026-10-28");
  });

  it("keeps only days with a free slot", () => {
    const slot = { start: "2026-10-28T09:00:00.000Z", staffId: "a" };
    expect(daysWithSlots([{ date: "2026-10-27", slots: [] }, { date: "2026-10-28", slots: [slot] }])).toEqual([{ date: "2026-10-28", slots: [slot] }]);
  });

  it("shows prices without needless cents and marks variable ones", () => {
    expect(formatPrice(2500, false)).toBe("25\u00a0€");
    expect(formatPrice(1250, true)).toBe("ab 12,50\u00a0€");
  });

  it("makes a key the booking route accepts", () => {
    expect(attemptKey()).toMatch(/^[0-9a-f-]{32,36}$/);
  });
});
