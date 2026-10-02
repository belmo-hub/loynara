import { describe, expect, it } from "vitest";
import { tapModesFor } from "./tap-modes";

const all = [{ id: "disabled" as const }, { id: "staff_confirmed" as const }, { id: "automatic_fixed" as const }];
const ids = (list: Array<{ id: string }>) => list.map(item => item.id);

describe("pilot NFC options", () => {
  it("offers only off and staff confirmation when automatic is not allowed", () => {
    expect(ids(tapModesFor(all, "disabled", false))).toEqual(["disabled", "staff_confirmed"]);
    expect(ids(tapModesFor(all, "staff_confirmed", false))).toEqual(["disabled", "staff_confirmed"]);
  });
  it("offers automatic only where the server allows it (development, device tests)", () => {
    expect(ids(tapModesFor(all, "disabled", true))).toEqual(["disabled", "staff_confirmed", "automatic_fixed"]);
  });
  it("keeps an already-saved automatic setting visible so it can be changed away from", () => {
    expect(ids(tapModesFor(all, "automatic_fixed", false))).toContain("automatic_fixed");
  });
});
