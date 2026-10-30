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

  it("shows the logo as the pass does: uncropped, the name only when the pass shows it, the name alone for a faint logo (ENG-134)", () => {
    const logoData = "data:image/png;base64,iVBORw0KGgo=";
    expect(pass("apple", { logoData, logoWallet: { showName: false, faint: false, upscaled: false } })).not.toContain("Synthetic Café</strong>");
    expect(pass("apple", { logoData, logoWallet: { showName: true, faint: false, upscaled: false } })).toContain("Synthetic Café</strong>");
    const faint = pass("apple", { logoData, logoWallet: { showName: true, faint: true, upscaled: false } });
    expect(faint).not.toContain("<img");
    expect(faint).toContain("Synthetic Café</strong>");
  });

  it("Google: a faint logo gives way to the initial and the name (ENG-134)", () => {
    const faint = pass("google", { logoData: "data:image/png;base64,iVBORw0KGgo=", logoWallet: { showName: true, faint: true, upscaled: false } });
    expect(faint).not.toContain("<img");
    expect(faint).toContain("ow-pass-initial");
    expect(faint).toContain("Synthetic Café</strong>");
  });
});
