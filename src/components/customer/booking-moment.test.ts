import { afterEach, describe, expect, it, vi } from "vitest";
import { FIRST_OPEN_WINDOW_MS, laterMark, momentFor, readSeen, referralHoldFor, referralPlace, unseenAwards } from "./booking-moment";

const now = Date.parse("2026-11-10T12:00:00Z");
const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
const award = (minutesAgo: number, delta = 1) => ({ kind: "award", delta, createdAt: at(minutesAgo) });
// What the server adds to a card read while STAMP_ANIMATION_ENABLED is on.
const on = { referralDue: false };

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
    expect(momentFor({ activity: [award(0)], balance: 5, stampMoment: on }, { balance: 4, seenAt: at(30) }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(0), award(0)], balance: 5, stampMoment: on }, { balance: 4, seenAt: at(30) }, now).credited).toBe(1);
  });
  it("an undone redemption or a correction grows the balance and plays nothing", () => {
    const undo = { kind: "reversal", delta: 8, createdAt: at(0) };
    expect(momentFor({ activity: [undo, award(40)], balance: 9, stampMoment: on }, { balance: 1, seenAt: at(30) }, now).credited).toBe(0);
  });
  it("a booking the tap page already showed does not play again on the open card", () => {
    expect(momentFor({ activity: [award(1)], balance: 5, stampMoment: on }, { balance: 4, seenAt: laterMark(at(30), at(-1)) }, now).credited).toBe(0);
  });
  it("on the first read the record decides; with storage blocked nothing plays, on any reload", () => {
    expect(momentFor({ activity: [award(2)], balance: 5, stampMoment: on }, { balance: null, seenAt: at(30) }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(2)], balance: 5, stampMoment: on }, { balance: null, seenAt: null }, now).credited).toBe(1);
    expect(momentFor({ activity: [award(2)], balance: 5, stampMoment: on }, { balance: null, seenAt: undefined }, now).credited).toBe(0);
  });
  it("with storage blocked the open card still plays a booking that arrives", () => {
    expect(momentFor({ activity: [award(0), award(20)], balance: 5, stampMoment: on }, { balance: 4, seenAt: laterMark(at(20), undefined) }, now).credited).toBe(1);
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

describe("STAMP_ANIMATION_ENABLED off: the read carries no stampMoment (ENG-206)", () => {
  it("plays no moment and names no record to store, on the first read and on a later one", () => {
    expect(momentFor({ activity: [award(1)], balance: 5 }, { balance: null, seenAt: null }, now)).toEqual({ credited: 0, newest: null });
    expect(momentFor({ activity: [award(0)], balance: 5 }, { balance: 4, seenAt: at(30) }, now)).toEqual({ credited: 0, newest: null });
  });
  it("keeps the referral block where it was, whatever the card's bookings", () => {
    expect(referralPlace(undefined)).toBe("below");
  });
});

describe("the referral block while the flag is on", () => {
  const share = { shareUrl: "https://example.test/join/x?ref=ref_1" };
  it("is neither rendered nor fetched before the second team-confirmed booking, and stands under the card from it on", () => {
    expect(referralPlace({ referralDue: false })).toBeNull();
    expect(referralPlace({ referralDue: true, referral: share })).toBe("card");
  });
  it("is not rendered when the read brings nothing to share (the shop has referrals off)", () => {
    expect(referralPlace({ referralDue: true })).toBeNull();
  });
  it("is held shut only on the visit whose booking is the second, until that stamp has landed", () => {
    expect(referralHoldFor({ referralNew: true }, { stepped: false })).toBe("held");
    expect(referralHoldFor({ referralNew: true }, { stepped: true })).toBe("released");
  });
  it("stands in the first paint on the third booking's visit and on every visit without a moment", () => {
    expect(referralHoldFor({ referralNew: false }, { stepped: false })).toBe("none");
    expect(referralHoldFor({ referralNew: true }, null)).toBe("none");
    expect(referralHoldFor(undefined, { stepped: false })).toBe("none");
  });
});
