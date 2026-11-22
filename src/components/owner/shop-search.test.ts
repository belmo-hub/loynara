import { describe, expect, it } from "vitest";
import { handTypedPoint, IDLE, latestOnly, pickedPoint, placeCoordinates, pointRequest, searchReducer, searchStatus, type SearchState } from "./shop-search";

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

  it("takes the caller's way on for an empty or failed search (the operator console)", () => {
    const fallback = "Gib die Koordinaten unten ein.";
    expect(searchStatus(run({ type: "type", text: "Zzyzx" }, { type: "results", options: [] }), fallback)).toBe("Nichts gefunden. Gib die Koordinaten unten ein.");
    expect(searchStatus(run({ type: "type", text: "Café" }, { type: "failed" }), fallback)).toBe("Die Suche klappt gerade nicht. Gib die Koordinaten unten ein.");
  });

  it("keeps the shown options open while typing on, and swaps them when the answer comes", () => {
    const typing = searchReducer(searchReducer(shown, { type: "move", down: true }), { type: "type", text: "Café am" });
    expect(typing).toMatchObject({ options: rows, open: true, active: -1, status: "searching" });
    expect(searchReducer(typing, { type: "results", options: rows.slice(0, 1) })).toMatchObject({ options: rows.slice(0, 1), open: true });
    expect(searchReducer(shown, { type: "type", text: "C" })).toEqual({ ...IDLE, text: "C" });
  });

  it("closes the list when focus leaves and opens it again on return", () => {
    expect(shown.open).toBe(true);
    expect(searchReducer(shown, { type: "blur" }).open).toBe(false);
    expect(searchStatus(searchReducer(shown, { type: "blur" }))).toBe(""); // a closed list no longer counts its suggestions
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
    expect(searchStatus(picking)).toBe("Café 2 wird übernommen …");
    expect(picking.picking).toEqual(rows[1]);
    const failed = searchReducer(searchReducer(searchReducer(shown, { type: "move", down: true }), { type: "pick", option: rows[1] }), { type: "pickFailed" });
    expect(failed.active).toBe(-1);
    expect(searchStatus(failed)).toBe("Der Ort ließ sich gerade nicht übernehmen. Wähl ihn bitte noch einmal.");
    expect(failed.options).toEqual(rows);
    expect(searchReducer(searchReducer(failed, { type: "escape" }), { type: "move", down: true })).toMatchObject({ open: true, active: 0 });
    expect(searchReducer(picking, { type: "picked" })).toEqual(IDLE);
    expect(searchReducer(searchReducer(shown, { type: "move", down: true }), { type: "escape" })).toMatchObject({ open: false, active: -1 });
  });

  it("lets only the latest search or pick land, and nothing after unmount", () => {
    const latest = latestOnly();
    const pick = latest.next();
    expect(pick()).toBe(true);
    latest.cancel(); // the sheet closed while place-location was still answering
    expect(pick()).toBe(false);
    const search = latest.next(), newer = latest.next();
    expect([search(), newer()]).toEqual([false, true]);
  });
});

// ENG-331 (review): a pick fills the console's point; any hand edit drops it, so a typed point never gets Google's clock.
it("fills the console's point from a pick and drops the pick on a hand edit", () => {
  const place = { id: "place_1", name: "Café", address: "Kassel", latitude: 51.3127, longitude: 9 };
  expect(pickedPoint(place)).toEqual({ place, coordinates: "51.31270, 9.00000" }); // the sheet's one precision, about 1 m
  expect(pickedPoint(null)).toEqual({ place: null, coordinates: "" });
  expect(handTypedPoint("51.31270, 9.00001")).toEqual({ place: null, coordinates: "51.31270, 9.00001" });
});

// Design's ruling for the console: Google's digits are never sent without their place id.
it("sends a pick's point only together with its place id, and „Ändern“ leaves nothing of it", () => {
  const shop = { tenantId: "t1", locationId: "l1" }, place = { id: "place_1", name: "Café", address: "Kassel", latitude: 51.3127, longitude: 9.4797 };
  const picked = pickedPoint(place);
  expect(pointRequest(shop, picked.coordinates, picked.place, false)).toEqual({ tenantId: "t1", locationId: "l1", coordinates: "51.31270, 9.47970", googlePlaceId: "place_1", execute: false });
  const changed = pickedPoint(null);
  expect(pointRequest(shop, changed.coordinates, changed.place, true)).toEqual({ tenantId: "t1", locationId: "l1", coordinates: "", execute: true });
  const typed = handTypedPoint("51.31000, 9.47000");
  expect(pointRequest(shop, typed.coordinates, typed.place, true)).not.toHaveProperty("googlePlaceId");
});
