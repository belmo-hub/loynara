import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardResponse } from "./client-api";
import { playsStampMoment, stampAnnouncement, TapCardFace } from "./tap-client";

const card: CardResponse = {
  scanCode: "scan", cardLocator: "LY-0001", balance: 2, merchantName: "Barbier Nord", locationName: "Kassel", programName: "Stempelkarte",
  programType: "stamp", rewards: [{ id: "r1", title: "Haarschnitt gratis", cost: 8 }], activity: [],
};
const render = (balance: number, moment: boolean) => renderToStaticMarkup(createElement(TapCardFace, { card, balance, moment }));

describe("stamp moment after a tap", () => {
  it("plays only for a stamp booked while the page watched", () => {
    expect(playsStampMoment("confirmed", true)).toBe(true); // the team confirmed while the guest waited
    expect(playsStampMoment("awarded", false)).toBe(true); // automatic mode books on the tap itself
    expect(playsStampMoment("confirmed", false)).toBe(false); // reloading a confirmed tap: same result, no second "+1"
    expect(playsStampMoment("already_processed", true)).toBe(false);
    expect(playsStampMoment("pending_staff", true)).toBe(false);
    expect(playsStampMoment("cancelled", true)).toBe(false);
  });

  it("announces the new balance once the stamp is booked", () => {
    expect(stampAnnouncement("confirmed", 3)).toBe("Stempel erhalten, neuer Stand 3.");
    expect(stampAnnouncement("awarded", 1)).toBe("Stempel erhalten, neuer Stand 1.");
    expect(stampAnnouncement("pending_staff", 2)).toBeNull();
    expect(stampAnnouncement("already_processed", 3)).toBeNull();
    expect(stampAnnouncement("confirmed", undefined)).toBeNull();
  });

  it("shows the card with the booked balance and lands only the new stamp", () => {
    const fresh = render(3, true);
    expect(fresh).toContain("Barbier Nord");
    expect(fresh).toContain("3 von 8 Stempeln");
    expect(fresh.match(/data-earned="true"/g)).toHaveLength(3);
    expect(fresh.match(/data-new="true"/g)).toHaveLength(1);
    const reloaded = render(3, false);
    expect(reloaded).toContain("3 von 8 Stempeln");
    expect(reloaded).not.toContain('data-new="true"');
  });
});
