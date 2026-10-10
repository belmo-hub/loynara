import { describe, expect, it } from "vitest";
import { setupReviewValidation } from "./program-setup-validation";
const valid = { programName: "Treuekarte", date: "2026-10-10", latitude: "", longitude: "" };
describe("merchant setup review fields", () => {
  it("does not invent optional coordinates", () => {
    expect(setupReviewValidation(valid)).toEqual({ problems: { programName: "", date: "", latitude: "", longitude: "" }, coordinates: {} });
  });
  it.each(["", "  ", "x", "x".repeat(181)])("rejects unusable programme name %s", programName => {
    expect(setupReviewValidation({ ...valid, programName }).problems.programName).not.toBe("");
  });
  it.each(["", "2026-02-29", "2026-13-01"])("rejects invalid date %s", date => {
    expect(setupReviewValidation({ ...valid, date }).problems.date).not.toBe("");
  });
  it("keeps valid leap dates and trims names", () => {
    expect(setupReviewValidation({ ...valid, programName: "  Treuekarte  ", date: "2028-02-29" }).problems).toEqual({ programName: "", date: "", latitude: "", longitude: "" });
  });
  it.each([["52,5", "13.4", 52.5, 13.4], ["0", "0", 0, 0], ["-90", "180", -90, 180]])("preserves valid paired coordinates %s/%s", (latitude, longitude, lat, lon) => {
    expect(setupReviewValidation({ ...valid, latitude: String(latitude), longitude: String(longitude) }).coordinates).toEqual({ latitude: lat, longitude: lon });
  });
  it.each([["91", "13"], ["52", "-181"], ["NaN", "13"], ["Infinity", "13"], ["52", ""], ["", "13"], ["0x10", "13"]])("rejects incomplete or invalid coordinates %s/%s", (latitude, longitude) => {
    const result = setupReviewValidation({ ...valid, latitude, longitude });
    expect(Boolean(result.problems.latitude || result.problems.longitude)).toBe(true);
    expect(result.coordinates).toEqual({});
  });
});
