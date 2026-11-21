import { describe, expect, it } from "vitest";
import { IDLE, placeCoordinates, searchReducer, searchStatus, type SearchState } from "./shop-search";

describe("shop search client parsing", () => {
  it("keeps a valid point exactly as the onboarding payload takes it", () => {
    expect(placeCoordinates({ latitude: 51.3127, longitude: 9.4797 })).toEqual({ latitude: 51.3127, longitude: 9.4797 });
    expect(placeCoordinates({ latitude: -90, longitude: 180, name: "ignored" })).toEqual({ latitude: -90, longitude: 180 });
  });
  it.each([null, undefined, {}, { latitude: "51.3", longitude: 9.4 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }])("refuses %o", body => {
    expect(placeCoordinates(body)).toBeNull();
  });
});

// Design's review of #324: the combobox's states and its one live region.
describe("shop search states", () => {
  const rows = [1, 2, 3].map(n => ({ id: `p${n}`, main: `Café ${n}`, secondary: "Kassel" }));
  const run = (...events: Parameters<typeof searchReducer>[1][]) => events.reduce<SearchState>(searchReducer, IDLE);
  const shown = run({ type: "type", text: "Café" }, { type: "results", options: rows });

  it("says it is searching, then counts the suggestions", () => {
    expect(searchStatus(run({ type: "type", text: "Café" }))).toBe("Suche …");
    expect(searchStatus(shown)).toBe("3 Vorschläge");
    expect(searchStatus(run({ type: "type", text: "Café" }, { type: "results", options: rows.slice(0, 1) }))).toBe("1 Vorschlag");
    expect(searchStatus(IDLE)).toBe("");
  });

  it("shows an empty result calmly and keeps the list closed", () => {
    const empty = run({ type: "type", text: "Zzyzx" }, { type: "results", options: [] });
    expect(empty.open).toBe(false);
    expect(searchStatus(empty)).toBe("Nichts gefunden. Du kannst auch ohne Standort starten.");
    expect(searchStatus(run({ type: "type", text: "Café" }, { type: "failed" }))).toBe("Die Suche klappt gerade nicht. Du kannst auch ohne Standort starten.");
  });

  it("closes the list when focus leaves and opens it again on return", () => {
    expect(shown.open).toBe(true);
    expect(searchReducer(shown, { type: "blur" }).open).toBe(false);
    expect(searchReducer(searchReducer(shown, { type: "blur" }), { type: "focus" }).open).toBe(true);
  });

  it("goes to the last row on ArrowUp with none active, and wraps both ways", () => {
    expect(searchReducer(shown, { type: "move", down: false }).active).toBe(2);
    expect(run({ type: "type", text: "Café" }, { type: "results", options: rows }, { type: "move", down: true }, { type: "move", down: false }, { type: "move", down: false }).active).toBe(1);
    expect(run({ type: "type", text: "Café" }, { type: "results", options: rows }, { type: "move", down: false }, { type: "move", down: true }).active).toBe(0);
  });

  it("does not search again for a trailing space", () => {
    expect(searchReducer(shown, { type: "type", text: "Café " })).toEqual({ ...shown, text: "Café " });
  });

  it("says the pick is being taken over, and after a failed one keeps the options for ArrowDown", () => {
    const picking = searchReducer(shown, { type: "pick", option: rows[1] });
    expect(searchStatus(picking)).toBe("Wird übernommen …");
    expect(picking.picking).toEqual(rows[1]);
    const failed = searchReducer(searchReducer(picking, { type: "blur" }), { type: "pickFailed" });
    expect(searchStatus(failed)).toBe("Der Ort ließ sich gerade nicht übernehmen. Wähl ihn bitte noch einmal.");
    expect(failed.options).toEqual(rows);
    expect(searchReducer(searchReducer(failed, { type: "escape" }), { type: "move", down: true })).toMatchObject({ open: true, active: 0 });
    expect(searchReducer(picking, { type: "picked" })).toEqual(IDLE);
  });
});
