import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SurfacePreview, type PreviewData } from "./wallet-previews";

const data: PreviewData = { businessName: "Synthetic Café", locationName: "Kassel", brandColor: "#1F4A3A", programType: "points", rewardTitle: "Kaffee", rewardCost: 10, balance: 9, programName: "Treuekarte", logoData: null };
const pass = (surface: "apple" | "google", change: Partial<PreviewData> = {}) => renderToStaticMarkup(h(SurfacePreview, { surface, data: { ...data, ...change } }));

describe("Wallet previews in the card studio say what the pass says (ENG-108)", () => {
  it("one point missing in the singular, two in the plural", () => {
    expect(pass("apple")).toContain("<b>Noch 1 Punkt</b>");
    expect(pass("apple", { balance: 8 })).toContain("<b>Noch 2 Punkte</b>");
    expect(pass("google")).toContain("Kaffee · Noch 1 Punkt</span>");
    expect(pass("google", { balance: 8 })).toContain("Kaffee · Noch 2 Punkte</span>");
    expect(pass("apple", { programType: "stamp" })).toContain("<b>Noch 1 Stempel</b>");
  });
});
