import { describe, expect, it } from "vitest";
import { setupLocation, setupReviewValidation } from "./program-setup-validation";
const valid = { programName: "Treuekarte", date: "2026-10-10" };
describe("merchant setup review fields", () => {
  it("accepts valid fields", () => {
    expect(setupReviewValidation(valid)).toEqual({ problems: { programName: "", date: "" } });
  });
  it.each(["", "  ", "x", "x".repeat(181)])("rejects unusable programme name %s", programName => {
    expect(setupReviewValidation({ ...valid, programName }).problems.programName).not.toBe("");
  });
  it.each(["", "2026-02-29", "2026-13-01"])("rejects invalid date %s", date => {
    expect(setupReviewValidation({ ...valid, date }).problems.date).not.toBe("");
  });
  it("keeps valid leap dates and trims names", () => {
    expect(setupReviewValidation({ ...valid, programName: "  Treuekarte  ", date: "2028-02-29" }).problems).toEqual({ programName: "", date: "" });
  });
  // ENG-323, Google's terms P-4 (review R25): a pick sends its id and point; the location's name stays the owner's own.
  it("sends a shop-search pick as id and point only, never Google's name or address", () => {
    const place = { id: "place_1", name: "Café Google-Name", address: "Königsplatz 1, Kassel", latitude: 51.3127, longitude: 9.4797 };
    const sent = setupLocation({ city: " Kassel ", locationName: "", place }, null, true);
    expect(sent).toEqual({ locationName: "Kassel", latitude: 51.3127, longitude: 9.4797, googlePlaceId: "place_1" });
    expect(setupLocation({ city: "Kassel", locationName: "Mitte", place }, { city: "Kassel" }, true).locationName).toBe("Mitte");
    expect(setupLocation({ city: "Kassel", locationName: "", place }, null, false)).toEqual({ locationName: "Kassel" });
  });
});
