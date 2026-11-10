import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_OPEN_WINDOW_MS, laterMark, markJoined, momentFor, peekJoined, readSeen, takeJoined, unseenAwards } from "./booking-moment";

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

describe("what one read of the card may celebrate", () => {
  afterEach(() => { vi.unstubAllGlobals(); });
  it("with the card open: a booking plays, never for more than the balance grew", () => {
    expect(momentFor({ activity: [award(0)], balance: 5 }, { balance: 4, seenAt: at(30) }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(0), award(0)], balance: 5 }, { balance: 4, seenAt: at(30) }, now).credited).toBe(1);
  });
  it("an undone redemption or a correction grows the balance and plays nothing", () => {
    const undo = { kind: "reversal", delta: 8, createdAt: at(0) };
    expect(momentFor({ activity: [undo, award(40)], balance: 9 }, { balance: 1, seenAt: at(30) }, now).credited).toBe(0);
  });
  it("a booking the tap page already showed does not play again on the open card", () => {
    expect(momentFor({ activity: [award(1)], balance: 5 }, { balance: 4, seenAt: laterMark(at(30), at(-1)) }, now).credited).toBe(0);
  });
  it("on the first read the record decides; with storage blocked nothing plays, on any reload", () => {
    expect(momentFor({ activity: [award(2)], balance: 5 }, { balance: null, seenAt: at(30) }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(2)], balance: 5 }, { balance: null, seenAt: null }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(2)], balance: 5 }, { balance: null, seenAt: undefined }, now).credited).toBe(0);
  });
  it("with storage blocked the open card still plays a booking that arrives", () => {
    expect(momentFor({ activity: [award(0), award(20)], balance: 5 }, { balance: 4, seenAt: laterMark(at(20), undefined) }, now).credited).toBe(1);
  });
  it("tells a missing record from blocked storage", () => {
    vi.stubGlobal("localStorage", { getItem: () => null });
    expect(readSeen("K-TEST01")).toBeNull();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); } });
    expect(readSeen("K-TEST01")).toBeUndefined();
  });
  it("takes the later of two marks", () => {
    expect(laterMark(at(5), at(1))).toBe(at(1));
    expect(laterMark(null, at(3))).toBe(at(3));
    expect(laterMark(undefined, null)).toBeNull();
  });
});

describe("the card page after the join page (ENG-205)", () => {
  it("opens as a return once, for the card the join page created, and stays quiet without storage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("sessionStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value); }, removeItem: (key: string) => { store.delete(key); } });
    markJoined("card_new");
    // Peeking (the card page's paint before its read) does not use the mark up.
    expect([peekJoined("card_new"), peekJoined("card_new"), peekJoined("card_other")]).toEqual([true, true, false]);
    expect(takeJoined("card_other")).toBe(false);
    expect(takeJoined("card_new")).toBe(true);
    expect(takeJoined("card_new")).toBe(false);
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(() => markJoined("card_new")).not.toThrow();
    expect(takeJoined("card_new")).toBe(false);
    expect(peekJoined("card_new")).toBe(false);
    vi.unstubAllGlobals();
  });
  it("celebrates nothing on that first read: a booking made before the join page's mark counts as seen", () => {
    const now = Date.parse("2026-11-10T12:00:00Z");
    const read = { balance: 2, activity: [{ kind: "award", delta: 2, createdAt: new Date(now - 1500).toISOString() }], stampMoment: {} };
    expect(momentFor(read, { balance: null, seenAt: null }, now).credited).toBe(2);
    expect(momentFor(read, { balance: null, seenAt: new Date(now).toISOString() }, now).credited).toBe(0);
  });
});
