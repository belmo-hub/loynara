import { describe, expect, it } from "vitest";
import { assertInWindow, assertTransition, blocksAfterNoShow, isLateCancel, rescheduleAllowed } from "./appointments";

const start = new Date("2026-11-03T09:00:00Z");
const code = (fn: () => void) => { try { fn(); return "OK"; } catch (error) { return (error as { code: string }).code; } };

describe("owner transitions", () => {
  it.each([
    ["requested", "confirmed", "OK"], ["requested", "done", "OK"], ["requested", "no_show", "OK"], ["requested", "cancelled_by_shop", "OK"],
    ["confirmed", "done", "OK"], ["confirmed", "no_show", "OK"], ["confirmed", "cancelled_by_shop", "OK"], ["confirmed", "requested", "INVALID_TRANSITION"],
    ["done", "no_show", "INVALID_TRANSITION"], ["no_show", "done", "INVALID_TRANSITION"], ["cancelled_by_customer", "confirmed", "INVALID_TRANSITION"], ["cancelled_by_shop", "done", "INVALID_TRANSITION"],
  ])("%s -> %s: %s", (from, to, expected) => expect(code(() => assertTransition(from, from, to, start, start))).toBe(expected));

  it("is STALE when the expected status no longer matches", () => {
    expect(code(() => assertTransition("done", "confirmed", "done", start, start))).toBe("STALE");
  });

  it("refuses done and no-show earlier than 10 minutes before the start, not confirm or cancel", () => {
    const early = new Date(start.getTime() - 11 * 60_000), justInTime = new Date(start.getTime() - 10 * 60_000);
    expect(code(() => assertTransition("confirmed", "confirmed", "done", start, early))).toBe("TOO_EARLY");
    expect(code(() => assertTransition("confirmed", "confirmed", "no_show", start, early))).toBe("TOO_EARLY");
    expect(code(() => assertTransition("confirmed", "confirmed", "done", start, justInTime))).toBe("OK");
    expect(code(() => assertTransition("requested", "requested", "confirmed", start, early))).toBe("OK");
    expect(code(() => assertTransition("confirmed", "confirmed", "cancelled_by_shop", start, early))).toBe("OK");
  });
});

describe("customer rules", () => {
  it("flags a cancellation inside the deadline as late", () => {
    expect(isLateCancel(start, 24, new Date("2026-11-02T08:59:59Z"))).toBe(false);
    expect(isLateCancel(start, 24, new Date("2026-11-02T09:00:00Z"))).toBe(true);
    expect(isLateCancel(start, 0, new Date("2026-11-03T08:59:00Z"))).toBe(false);
  });

  it("allows reschedules below the monthly limit", () => {
    expect(rescheduleAllowed(1, 2)).toBe(true);
    expect(rescheduleAllowed(2, 2)).toBe(false);
    expect(rescheduleAllowed(0, 0)).toBe(false);
  });

  it("blocks after the configured number of no-shows, never with 0", () => {
    expect(blocksAfterNoShow(2, 3)).toBe(false);
    expect(blocksAfterNoShow(3, 3)).toBe(true);
    expect(blocksAfterNoShow(9, 0)).toBe(false);
  });

  it("accepts only grid starts between now + lead time and today + max days", () => {
    const settings = { leadTimeMin: 120, maxDaysAhead: 42 }, now = new Date("2026-11-02T08:00:00Z"), tz = "Europe/Berlin";
    expect(code(() => assertInWindow(start, settings, now, tz))).toBe("OK");
    expect(code(() => assertInWindow(new Date("2026-11-03T09:10:00Z"), settings, now, tz))).toBe("OUT_OF_WINDOW");
    expect(code(() => assertInWindow(new Date("2026-11-02T09:45:00Z"), settings, now, tz))).toBe("OUT_OF_WINDOW");
    expect(code(() => assertInWindow(new Date("2026-11-02T10:00:00Z"), settings, now, tz))).toBe("OK");
    expect(code(() => assertInWindow(new Date("2026-12-14T09:00:00Z"), settings, now, tz))).toBe("OK");
    expect(code(() => assertInWindow(new Date("2026-12-15T09:00:00Z"), settings, now, tz))).toBe("OUT_OF_WINDOW");
  });
});
