import { describe, expect, it } from "vitest";
import { setupReviewValidation } from "./program-setup-validation";
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
});
