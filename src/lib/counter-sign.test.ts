import { describe, expect, it } from "vitest";
import { counterSignHtml } from "./counter-sign";

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

  it("rejects a non-HTTPS external join link", () => {
    expect(() => counterSignHtml({ ...sign, joinUrl: "http://example.test/join/synthetic-cafe" })).toThrow("Anmeldelink ist nicht gültig");
  });
});
