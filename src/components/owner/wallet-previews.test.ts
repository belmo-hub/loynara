import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrowserCardPreview } from "./card-preview";
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

  it("shows the logo as the pass does: uncropped, the name only when the pass shows it, a faint logo stays on the pass (founder, 12 Nov)", () => {
    const logoData = "data:image/png;base64,iVBORw0KGgo=";
    expect(pass("apple", { logoData, logoWallet: { showName: false, faint: false, upscaled: false } })).not.toContain("Synthetic Café</strong>");
    expect(pass("apple", { logoData, logoWallet: { showName: true, faint: false, upscaled: false } })).toContain("Synthetic Café</strong>");
    const faint = pass("apple", { logoData, logoWallet: { showName: true, faint: true, upscaled: false } });
    expect(faint).toContain("<img");
    expect(faint).toContain("Synthetic Café</strong>");
  });

  it("Google: a faint logo stays on the pass (founder, 12 Nov)", () => {
    const faint = pass("google", { logoData: "data:image/png;base64,iVBORw0KGgo=", logoWallet: { showName: true, faint: true, upscaled: false } });
    expect(faint).toContain("<img");
    expect(faint).not.toContain("ow-pass-initial");
  });

  it("Google: until the logo's shape is known, the name stays beside it (ENG-153)", () => {
    // Server-side the image has not loaded; the wide split (ratio > 1.25) applies once it has.
    const unknown = pass("google", { logoData: "data:image/png;base64,iVBORw0KGgo=", logoWallet: { showName: false, faint: false, upscaled: false, box: "#ffffff" } });
    expect(unknown).toContain("ow-pass-mark");
    expect(unknown).toContain("background-color:#ffffff");
    expect(unknown).not.toContain("ow-pass-wide");
    expect(unknown).toContain("Synthetic Café</strong>");
  });

  it("Google: the initial is the asset's, from the first drawable letter, in the pass ink on the brand colour (ENG-153)", () => {
    expect(pass("google", { businessName: "„Zur Linde“" })).toContain('<span class="ow-pass-initial" aria-hidden="true">Z</span>');
    expect(pass("google", { businessName: "1. FC Kebab" })).toContain('aria-hidden="true">F</span>');
    expect(pass("google", { businessName: "★" })).not.toContain("ow-pass-initial");
    const css = readFileSync(join(__dirname, "owner.css"), "utf8");
    expect(css).toMatch(/\.ow-pass-initial \{[^}]*background: transparent;[^}]*color: inherit;[^}]*font-weight: 800;/);
  });

  it("no stylesheet rule crops or rounds the Apple logo or the logo tile (ENG-134)", () => {
    const css = readFileSync(join(__dirname, "owner.css"), "utf8");
    const rule = (selector: string) => css.match(new RegExp(`^${selector.replace(/[.]/g, "\\.")} \\{([^}]*)\\}`, "m"))?.[1] ?? "";
    for (const selector of [".ow-pass-logo", ".ow-logo-thumb", ".ow-pass-wide", ".ow-pass-issuer img"]) {
      expect(rule(selector), selector).not.toMatch(/cover|50%/);
    }
    for (const selector of [".ow-pass-logo", ".ow-logo-thumb", ".ow-pass-wide"]) expect(rule(selector), selector).toMatch(/object-fit: contain/);
  });
});

describe("the owner's card preview names its region as the example (Design, #282)", () => {
  it("is „Karte“, not the guest's „Deine Treuekarte“", () => {
    const html = renderToStaticMarkup(h(BrowserCardPreview, { businessName: "Café", locationName: "Mitte", brandColor: "", programType: "points", rewardTitle: "Kaffee", rewardCost: 100, balance: 62 }));
    expect(html).toContain('aria-label="Karte"');
    expect(html).not.toContain("Deine Treuekarte");
  });
});
