import { describe, expect, it } from "vitest";
import { slots, type SlotInput } from "./availability";

// Tuesday 3 Nov 2026, Berlin is UTC+1: 09:00 local = 08:00Z.
const day = "2026-11-03";
const at = (local: string) => new Date(`${day}T${String(Number(local.slice(0, 2)) - 1).padStart(2, "0")}:${local.slice(3)}:00Z`);
const hours = [{ weekday: 2, start: "09:00", end: "18:00", breaks: [{ start: "13:00", end: "13:30" }] }];
const base = (over: Partial<SlotInput> = {}): SlotInput => ({
  days: [day], service: { id: "svc", durationMin: 30, bufferMin: 0 },
  staff: [{ id: "a", sort: 0, workingHours: hours, serviceIds: [] }],
  blocks: [], appointments: [], settings: { leadTimeMin: 120, maxDaysAhead: 42 }, now: new Date("2026-11-02T08:00:00Z"), tz: "Europe/Berlin", ...over,
});
const starts = (input: SlotInput) => slots(input)[0].slots.map(s => s.start.getTime());
const has = (input: SlotInput, local: string) => starts(input).includes(at(local).getTime());

describe("slots", () => {
  it("offers working hours minus breaks on the 15-minute grid", () => {
    const list = slots(base())[0].slots;
    expect(list[0].start).toEqual(at("09:00"));
    expect(list[list.length - 1].start).toEqual(at("17:30"));
    expect(has(base(), "12:30")).toBe(true);
    expect(has(base(), "12:45")).toBe(false);
    expect(has(base(), "13:30")).toBe(true);
    expect(list.every(s => (s.start.getTime() / 60_000) % 15 === 0)).toBe(true);
    expect(list).toHaveLength(32);
  });

  it("fits a 45-minute service before closing and respects the buffer", () => {
    const long = base({ service: { id: "svc", durationMin: 45, bufferMin: 0 } });
    expect(has(long, "17:15")).toBe(true);
    expect(has(long, "17:30")).toBe(false);
    const buffered = base({ service: { id: "svc", durationMin: 30, bufferMin: 15 } });
    expect(has(buffered, "17:15")).toBe(true);
    expect(has(buffered, "17:30")).toBe(false);
    expect(has(buffered, "12:15")).toBe(true);
    expect(has(buffered, "12:30")).toBe(false);
  });

  it("starts on the grid even when hours do not", () => {
    const odd = base({ staff: [{ id: "a", sort: 0, workingHours: [{ weekday: 2, start: "09:10", end: "10:00", breaks: [] }], serviceIds: [] }] });
    expect(slots(odd)[0].slots.map(s => s.start)).toEqual([at("09:15"), at("09:30")]);
  });

  it("removes shop-wide blocks, own blocks and own open appointments, not another staff member's", () => {
    const blocked = base({ blocks: [{ staffId: null, start: at("10:00"), end: at("11:00") }, { staffId: "other", start: at("15:00"), end: at("16:00") }], appointments: [{ staffId: "a", start: at("14:00"), end: at("14:30") }, { staffId: "other", start: at("16:00"), end: at("17:00") }] });
    expect(has(blocked, "09:30")).toBe(true);
    expect(has(blocked, "09:45")).toBe(false);
    expect(has(blocked, "10:30")).toBe(false);
    expect(has(blocked, "11:00")).toBe(true);
    expect(has(blocked, "13:30")).toBe(true);
    expect(has(blocked, "14:00")).toBe(false);
    expect(has(blocked, "14:30")).toBe(true);
    expect(has(blocked, "15:00")).toBe(true);
    expect(has(blocked, "16:00")).toBe(true);
  });

  it("applies the lead time and the booking window", () => {
    const soon = base({ now: at("09:30") });
    expect(slots(soon)[0].slots[0].start).toEqual(at("11:30"));
    expect(slots(base({ now: new Date("2026-09-01T08:00:00Z") }))[0].slots).toEqual([]);
    expect(slots(base({ now: new Date("2026-09-22T08:00:00Z") }))[0].slots).toHaveLength(32);
  });

  it("unions staff for 'Egal wer': one slot per start, lowest sort wins", () => {
    const team = base({
      staff: [{ id: "a", sort: 1, workingHours: hours, serviceIds: [] }, { id: "b", sort: 0, workingHours: hours, serviceIds: [] }],
      appointments: [{ staffId: "b", start: at("10:00"), end: at("10:30") }],
      blocks: [{ staffId: "a", start: at("11:00"), end: at("11:30") }],
    });
    const list = slots(team)[0].slots;
    expect(list).toHaveLength(32);
    expect(list.find(s => s.start.getTime() === at("09:00").getTime())?.staffId).toBe("b");
    expect(list.find(s => s.start.getTime() === at("10:00").getTime())?.staffId).toBe("a");
    expect(list.find(s => s.start.getTime() === at("11:00").getTime())?.staffId).toBe("b");
  });

  it("has no slots without staff or when nobody offers the service", () => {
    expect(slots(base({ staff: [] }))[0].slots).toEqual([]);
    expect(slots(base({ staff: [{ id: "a", sort: 0, workingHours: hours, serviceIds: ["other-service"] }] }))[0].slots).toEqual([]);
    expect(slots(base({ staff: [{ id: "a", sort: 0, workingHours: hours, serviceIds: ["svc"] }] }))[0].slots).toHaveLength(32);
  });
});
