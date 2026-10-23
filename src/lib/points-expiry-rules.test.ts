import { describe, expect, it } from "vitest";
import { addMonths, duePoints, expiryBatches, expiryBuckets, expiryReminderText, upcomingExpiry, type ExpiryLedgerRow } from "./points-expiry-rules";

const at = (iso: string) => new Date(iso);
const row = (delta: number, iso: string, kind = delta > 0 ? "award" : "redeem"): ExpiryLedgerRow => ({ delta, kind, createdAt: at(iso) });
const rule = { months: 6, since: at("2026-01-01T00:00:00Z") };

describe("addMonths", () => {
  it("keeps the day and time, and clamps to the end of a shorter month", () => {
    expect(addMonths(at("2026-01-15T09:30:00Z"), 6).toISOString()).toBe("2026-07-15T09:30:00.000Z");
    expect(addMonths(at("2026-08-31T12:00:00Z"), 6).toISOString()).toBe("2027-02-28T12:00:00.000Z");
    expect(addMonths(at("2027-08-31T12:00:00Z"), 6).toISOString()).toBe("2028-02-29T12:00:00.000Z");
    expect(addMonths(at("2026-03-31T12:00:00Z"), 24).toISOString()).toBe("2028-03-31T12:00:00.000Z");
  });
});

describe("expiryBuckets (oldest first)", () => {
  it("never dates points earned before the rule started", () => {
    expect(expiryBuckets([row(30, "2025-12-31T23:59:59Z"), row(20, "2026-01-01T00:00:00Z")], rule)).toEqual([{ amount: 20, expiresAt: at("2026-07-01T00:00:00Z") }]);
  });

  it("lets a redemption use up the oldest points first, undated ones included", () => {
    const rows = [row(30, "2025-12-01T10:00:00Z"), row(50, "2026-02-01T10:00:00Z"), row(50, "2026-03-01T10:00:00Z"), row(-60, "2026-04-01T10:00:00Z")];
    expect(expiryBuckets(rows, rule)).toEqual([{ amount: 20, expiresAt: at("2026-08-01T10:00:00Z") }, { amount: 50, expiresAt: at("2026-09-01T10:00:00Z") }]);
  });

  it("is due exactly at the expiry instant, not a millisecond before", () => {
    const buckets = expiryBuckets([row(40, "2026-02-01T10:00:00Z")], rule);
    expect(duePoints(buckets, at("2026-08-01T09:59:59.999Z"))).toBe(0);
    expect(duePoints(buckets, at("2026-08-01T10:00:00Z"))).toBe(40);
  });

  it("an expiry row uses up the lots that were due, not older undated ones", () => {
    const rows = [row(30, "2025-12-01T10:00:00Z"), row(40, "2026-02-01T10:00:00Z"), row(-40, "2026-08-01T10:00:00Z", "expiry")];
    const buckets = expiryBuckets(rows, rule);
    expect(buckets).toEqual([]);
    expect(duePoints(buckets, at("2030-01-01T00:00:00Z"))).toBe(0);
  });

  it("treats points given back by a correction as freshly earned", () => {
    const rows = [row(40, "2026-02-01T10:00:00Z"), row(-40, "2026-08-01T10:00:00Z", "expiry"), row(40, "2026-08-02T10:00:00Z", "reversal")];
    expect(expiryBuckets(rows, rule)).toEqual([{ amount: 40, expiresAt: at("2027-02-02T10:00:00Z") }]);
  });
});

describe("upcomingExpiry and the reminder text", () => {
  it("looks 30 days ahead and names the first date", () => {
    const buckets = [{ amount: 10, expiresAt: at("2026-08-05T10:00:00Z") }, { amount: 70, expiresAt: at("2026-08-31T10:00:00Z") }, { amount: 5, expiresAt: at("2026-09-01T10:00:02Z") }];
    const soon = upcomingExpiry(buckets, at("2026-08-02T10:00:01Z"));
    expect(soon).toEqual({ amount: 80, firstAt: at("2026-08-05T10:00:00Z"), lastAt: at("2026-08-31T10:00:00Z") });
    expect(upcomingExpiry(buckets, at("2026-07-01T00:00:00Z"))).toBeNull();
    expect(expiryReminderText(soon!, "Europe/Berlin")).toBe("Deine 80 Punkte verfallen bis zum 31.08.2026.");
    const one = at("2026-08-05T10:00:00Z");
    expect(expiryReminderText({ amount: 120, firstAt: one, lastAt: one }, "Europe/Berlin")).toBe("Deine 120 Punkte verfallen am 05.08.2026.");
    expect(expiryReminderText({ amount: 1, firstAt: one, lastAt: one }, "Europe/Berlin")).toBe("Dein 1 Punkt verfällt am 05.08.2026.");
  });

  it("lists each expiry date once, nearest first", () => {
    const buckets = [{ amount: 10, expiresAt: at("2026-08-05T08:00:00Z") }, { amount: 5, expiresAt: at("2026-08-05T20:00:00Z") }, { amount: 1, expiresAt: at("2026-09-01T10:00:00Z") }];
    expect(expiryBatches(buckets, "Europe/Berlin")).toEqual(["15 Punkte am 05.08.2026", "1 Punkt am 01.09.2026"]);
  });
});
