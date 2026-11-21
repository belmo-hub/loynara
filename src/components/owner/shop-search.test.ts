import { describe, expect, it } from "vitest";
import { placeCoordinates } from "./shop-search";

describe("shop search client parsing", () => {
  it("keeps a valid point exactly as the onboarding payload takes it", () => {
    expect(placeCoordinates({ latitude: 51.3127, longitude: 9.4797 })).toEqual({ latitude: 51.3127, longitude: 9.4797 });
    expect(placeCoordinates({ latitude: -90, longitude: 180, name: "ignored" })).toEqual({ latitude: -90, longitude: 180 });
  });
  it.each([null, undefined, {}, { latitude: "51.3", longitude: 9.4 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }, { latitude: NaN, longitude: 0 }])("refuses %o", body => {
    expect(placeCoordinates(body)).toBeNull();
  });
});
