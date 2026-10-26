import { describe, expect, it } from "vitest";
import { actionError, actionsFor, awardLine, dayName, dayRows, euroInput, STATUS_WORD, wallTime, wallToIso, type OwnerAppointment } from "./booking-day-model";

const appointment = (id: string, start: string, status: OwnerAppointment["status"] = "confirmed") => ({ id, start, status } as OwnerAppointment);

describe("booking day model", () => {
  it("merges blocks and appointments in time order, the block first at the same minute", () => {
    const rows = dayRows({
      appointments: [appointment("b", "2026-10-27T10:00:00.000Z"), appointment("a", "2026-10-27T08:00:00.000Z")],
      blocks: [{ id: "x", staffId: null, start: "2026-10-27T10:00:00.000Z", end: "2026-10-27T11:00:00.000Z", reason: "Arzt" }],
    });
    expect(rows.map(row => row.kind === "block" ? row.block.id : row.appointment.id)).toEqual(["a", "x", "b"]);
  });

  it("names every status in words and offers only allowed transitions", () => {
    expect(STATUS_WORD).toMatchObject({ requested: "angefragt", confirmed: "fix", done: "erledigt", no_show: "nicht erschienen", cancelled_by_shop: "abgesagt", cancelled_by_customer: "abgesagt" });
    expect(actionsFor("requested")).toEqual(["confirm", "done", "no_show", "cancel", "move"]);
    expect(actionsFor("confirmed")).toEqual(["done", "no_show", "cancel", "move"]);
    const now = Date.parse("2026-10-27T08:00:00.000Z");
    expect(actionsFor("confirmed", "2026-10-27T09:00:00.000Z", now)).toEqual(["cancel", "move"]);
    expect(actionsFor("requested", "2026-10-27T08:10:00.000Z", now)).toEqual(["confirm", "done", "no_show", "cancel", "move"]);
    for (const end of ["done", "no_show", "cancelled_by_customer", "cancelled_by_shop"] as const) expect(actionsFor(end)).toEqual([]);
  });

  it("prefills euros with a comma and words the award", () => {
    expect(euroInput(2500)).toBe("25,00");
    expect(euroInput(1995)).toBe("19,95");
    expect(euroInput(5)).toBe("0,05");
    expect(awardLine("stamp", 1)).toBe("+1 Stempel gutgeschrieben");
    expect(awardLine("points", 1)).toBe("+1 Punkt gutgeschrieben");
    expect(awardLine("points", 75)).toBe("+75 Punkte gutgeschrieben");
  });

  it("reads and writes shop wall time, also on the DST day", () => {
    expect(wallTime("2026-10-25T09:00:00.000Z", "Europe/Berlin")).toBe("10:00");
    expect(wallToIso("2026-10-25", "10:00", "Europe/Berlin")).toBe("2026-10-25T09:00:00.000Z");
    expect(wallToIso("2026-10-24", "10:00", "Europe/Berlin")).toBe("2026-10-24T08:00:00.000Z");
    expect(dayName("2026-10-27", "2026-10-27")).toBe("Heute");
    expect(dayName("2026-10-26", "2026-10-27")).toBe("Gestern");
    expect(dayName("2026-10-28", "2026-10-27")).toBe("Morgen");
    expect(dayName("2026-10-30", "2026-10-27")).toBe("Freitag");
  });

  it("turns error codes into one German line", () => {
    expect(actionError({ code: "STALE" })).toBe("Schon geändert, Liste aktualisiert.");
    expect(actionError({ code: "TOO_EARLY" }, { start: "2026-10-27T09:00:00.000Z" })).toBe("Geht erst ab 09:50 Uhr.");
    expect(actionError({ status: 0, message: "Keine Verbindung." })).toBe("Keine Verbindung.");
    expect(actionError({ status: 500, message: "Internal error" })).toBe("Das hat nicht geklappt. Versuch es noch einmal.");
  });
});
