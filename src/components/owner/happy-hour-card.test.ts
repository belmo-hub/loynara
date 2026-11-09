import { describe, expect, it } from "vitest";
import { happyHourDraftProblem, switchHappyHour } from "./happy-hour-card";
import { removedLine, sentLine, type SentRow } from "./sent-messages";
import { keepUnits } from "@/lib/german-date";

const window = { days: [1, 2, 3, 4, 5], start: "14:00", end: "17:00" };

describe("Happy Hour question (ENG-180)", () => {
  it("starts with the default window when switched on with none, so the editor never opens empty", () => {
    expect(switchHappyHour({ enabled: false, windows: [] }, true)).toEqual({ enabled: true, windows: [window] });
    expect(switchHappyHour({ enabled: false, windows: [{ ...window, days: [6] }] }, true).windows).toEqual([{ ...window, days: [6] }]);
    expect(switchHappyHour({ enabled: true, windows: [window] }, false)).toEqual({ enabled: false, windows: [window] });
  });
  it("names the problem of the window it is in, and an empty list while on only as that", () => {
    expect(happyHourDraftProblem({ enabled: true, windows: [] })).toEqual({ window: -1, problem: "NONE" });
    expect(happyHourDraftProblem({ enabled: true, windows: [window, { ...window, days: [] }] })).toEqual({ window: 1, problem: "SHAPE" });
    expect(happyHourDraftProblem({ enabled: true, windows: [{ ...window, start: "22:00", end: "01:00" }] })).toEqual({ window: 0, problem: "MIDNIGHT" });
    expect(happyHourDraftProblem({ enabled: true, windows: [{ ...window, end: "" }] })).toEqual({ window: 0, problem: "TIME" });
    expect(happyHourDraftProblem({ enabled: false, windows: [] })).toBeNull();
    expect(happyHourDraftProblem({ enabled: true, windows: [window] })).toBeNull();
  });
});

describe("sent messages (ENG-180)", () => {
  const row = (patch: Partial<SentRow>): SentRow => ({ id: "m", text: "Hallo", status: "complete", createdAt: "2026-10-29T11:43:00Z", audience: 26, sent: 26, failed: 0, skipped: 0, removed: 0, warn: false, ...patch });
  const now = new Date("2026-11-06T12:00:00Z"), zone = "Europe/Berlin";
  it("says gesendet with the count held to its unit, and today as Heute", () => {
    expect(sentLine(row({}), zone, now)).toBe("29.10., 12:43 · an 26 Karten gesendet");
    expect(sentLine(row({ sent: 1, audience: 1 }), zone, now)).toBe("29.10., 12:43 · an 1 Karte gesendet");
    expect(sentLine(row({ sent: 24 }), zone, now)).toBe("29.10., 12:43 · an 24 von 26 gesendet");
    expect(sentLine(row({ status: "sending", sent: 6, createdAt: "2026-11-06T11:58:00Z" }), zone, now)).toBe("Heute, 12:58 · 6 von 26 gesendet");
  });
  it("shows removals only once there is one", () => {
    expect(removedLine(0)).toBe("");
    expect(removedLine(2)).toBe("2 Karten in 48 Stunden entfernt");
  });
  it("keeps every number with its unit", () => {
    expect(keepUnits("Komm bis zum 15. November vorbei, dann gibt's 1 Punkt extra.")).toBe("Komm bis zum 15. November vorbei, dann gibt's 1 Punkt extra.");
  });
});
