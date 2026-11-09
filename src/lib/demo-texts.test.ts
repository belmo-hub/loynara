import { describe, expect, it } from "vitest";
import { DEMO_DATA_NOTE, demoConsentText, demoEnd, demoJoinLine, shopDemo } from "./demo-texts";

const demo = { name: "Salon Aziz", slug: "demo-0b5e7c1a-3d2f-4c8e-9a71-5f6d4e3c2b1a", createdAt: new Date("2026-11-09T14:30:00Z") };

describe("Legal's demo texts (9 Nov)", () => {
  it("names the demo's end, 24 hours on, in the shop's time zone", () => {
    expect(demoEnd(demo.createdAt, "Europe/Berlin")).toEqual({ date: "10.\u00a0November 2026", time: "15:30" });
    expect(shopDemo(demo, "Europe/Berlin", { DEMO_ENVIRONMENT: "true" })?.line).toBe("Demo von Loynara für Salon Aziz. Diese Karte endet am 10.\u00a0November 2026 um 15:30. Stempel und Prämien gelten nicht.");
  });

  it("only in the demo environment and only for a demo shop", () => {
    expect(shopDemo(demo, "Europe/Berlin", {})).toBeUndefined();
    expect(shopDemo(demo, "Europe/Berlin", { DEMO_ENVIRONMENT: "true", PRODUCTION_ENVIRONMENT: "loynara-production" })).toBeUndefined();
    expect(shopDemo({ ...demo, slug: "demo-bar-x7k2p" }, "Europe/Berlin", { DEMO_ENVIRONMENT: "true" })).toBeUndefined();
  });

  it("keeps Legal's wording", () => {
    expect(demoJoinLine("Karte anlegen")).toBe("Mit „Karte anlegen“ legst du eine Demo-Karte an. Mehr in den Datenschutzhinweisen zur Demo.");
    expect(DEMO_DATA_NOTE).toBe("Demo-Daten: erfundene Beispiele, keine Prognose.");
    expect(demoConsentText("Salon Aziz", { date: "10. November 2026", time: "15:30" })).not.toMatch(/Erinnerungen/);
  });
});
