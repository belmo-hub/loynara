import { describe, expect, it } from "vitest";
import { counterSignHtml, SIGN_FONT } from "./counter-sign";

const sign = {
  businessName: "Café <img src=x onerror=alert(1)>",
  locationName: "Mitte & Markt",
  joinUrl: "http://localhost:3000/join/synthetic-cafe",
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"></svg>',
  programType: "stamp" as const,
  rewardTitle: "Kaffee <gratis>",
  rewardCost: 8,
};

describe("printable merchant sign", () => {
  it("keeps merchant text escaped while embedding its complete join QR", () => {
    const html = counterSignHtml(sign);
    expect(html).toContain("Café &lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("Mitte &amp; Markt");
    expect(html).toContain("Kaffee &lt;gratis&gt;");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain(sign.qrSvg);
    expect(html).toContain(sign.joinUrl);
  });

  it("names a reward that costs exactly one point in the singular (ENG-108)", () => {
    expect(counterSignHtml({ ...sign, programType: "points", rewardCost: 1 })).toContain('<p class="reward">1 Punkt → Kaffee &lt;gratis&gt;</p>');
    expect(counterSignHtml({ ...sign, programType: "points", rewardCost: 2 })).toContain('<p class="reward">2 Punkte → Kaffee &lt;gratis&gt;</p>');
    expect(counterSignHtml({ ...sign, rewardCost: 1 })).toContain('<p class="reward">1 Stempel → Kaffee &lt;gratis&gt;</p>');
    expect(counterSignHtml(sign)).toContain('<p class="reward">8 Stempel → Kaffee &lt;gratis&gt;</p>');
  });

  it("embeds Manrope only from a woff2 data URL or the app's own file and falls back to Arial (ENG-280, ENG-343)", () => {
    const font = "data:font/woff2;base64,d09GMgABAAA=";
    expect(counterSignHtml({ ...sign, fontSrc: font })).toContain(`@font-face{font-family:Manrope;src:url(${font}) format("woff2");font-weight:200 800;font-display:block}`);
    expect(counterSignHtml({ ...sign, fontSrc: SIGN_FONT })).toContain(`src:url(/fonts/manrope-latin.woff2) format("woff2")`);
    expect(counterSignHtml({ ...sign, fontSrc: "https://fonts.example/manrope.woff2" })).not.toContain("@font-face");
    expect(counterSignHtml({ ...sign, fontSrc: "data:font/woff2;base64,x);}</style><script>" })).not.toContain("@font-face");
    expect(counterSignHtml(sign)).not.toContain("@font-face");
    expect(counterSignHtml(sign)).toContain("font-family:Manrope,Arial,Helvetica,sans-serif");
  });

  it("offers a print button that the printout leaves out (ENG-343)", () => {
    const html = counterSignHtml(sign);
    expect(html).toContain('<p class="tools"><button class="print" type="button" onclick="print()">Drucken</button></p><main class="sheet">');
    expect(html).toMatch(/@media print\{[^}]*\}\.tools\{display:none\}/);
  });

  it("rejects a non-HTTPS external join link", () => {
    expect(() => counterSignHtml({ ...sign, joinUrl: "http://example.test/join/synthetic-cafe" })).toThrow("Anmeldelink ist nicht gültig");
  });
});
