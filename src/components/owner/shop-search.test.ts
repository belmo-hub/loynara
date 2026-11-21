import { describe, expect, it } from "vitest";
import { handTypedPoint, pickedPoint, placeCoordinates } from "./shop-search";

describe("shop search client parsing", () => {
  it("keeps a valid point exactly as the onboarding payload takes it", () => {
    expect(placeCoordinates({ latitude: 51.3127, longitude: 9.4797 })).toEqual({ latitude: 51.3127, longitude: 9.4797 });
    expect(placeCoordinates({ latitude: -90, longitude: 180, name: "ignored" })).toEqual({ latitude: -90, longitude: 180 });
  });
  it.each([null, undefined, {}, { latitude: "51.3", longitude: 9.4 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }])("refuses %o", body => {
    expect(placeCoordinates(body)).toBeNull();
  });
  // ENG-331 (review): a pick fills the console's point; any hand edit drops it, so a typed point never gets Google's clock.
  it("fills the point from a pick and drops the pick on a hand edit", () => {
    const place = { id: "place_1", name: "Café", address: "Kassel", latitude: 51.3127, longitude: 9 };
    expect(pickedPoint(place)).toEqual({ place, coordinates: "51.3127000, 9.0000000" });
    expect(pickedPoint(null)).toEqual({ place: null, coordinates: "" });
    expect(handTypedPoint("51.3127000, 9.0000001")).toEqual({ place: null, coordinates: "51.3127000, 9.0000001" });
  });
});
