import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CardResponse } from "./client-api";
import { currentBalance, playsStampMoment, stampAnnouncement, tapCopy, TapCardFace } from "./tap-client";

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

describe("tap page for a points programme", () => {
  it("waits for the team, then tells the guest the booked points", () => {
    expect(tapCopy("pending_staff", undefined, true)).toEqual({ title: "Warte auf das Team", detail: "Das Team an der Kasse trägt deine Punkte ein und bestätigt sie. Du musst nichts weiter tun." });
    expect(tapCopy("confirmed", undefined, true).title).toBe("Punkte erhalten");
    expect(stampAnnouncement("confirmed", 40, true)).toBe("Punkte erhalten, neuer Stand 40.");
    expect(stampAnnouncement("confirmed", 112, true, 16)).toBe("16 Punkte erhalten, neuer Stand 112.");
    expect(stampAnnouncement("awarded", 97, true, 1)).toBe("1 Punkt erhalten, neuer Stand 97.");
    expect(tapCopy("pending_staff").detail).toContain("Stempel");   // stamp copy unchanged
  });
  it("names a balance of one point in the singular (ENG-104)", () => {
    expect(currentBalance(1, true)).toBe("Aktueller Stand: 1 Punkt");
    expect(currentBalance(2, true)).toBe("Aktueller Stand: 2 Punkte");
    expect(currentBalance(1, false)).toBe("Aktueller Stand: 1 Stempel");
  });
});

describe("several rewards on the tap page (Design, #300)", () => {
  const two = { ...card, rewards: [{ id: "big", title: "Gratiskaffee", cost: 8 }, { id: "small", title: "Kleiner Kaffee", cost: 3 }] };
  const face = (balance: number, moment: boolean, credited?: number) => renderToStaticMarkup(createElement(TapCardFace, { card: two, balance, moment, credited }));
  it("counts to the next reward not reached before the tap, and the ready line names the ready reward", () => {
    expect(face(4, true)).toContain("4 von 8");
    expect(face(4, false)).toContain("Deine Prämie ist bereit: Kleiner Kaffee.");
    expect(face(4, false)).not.toContain("Prämie verfügbar.");
    expect(face(2, false)).toContain("2 von 3");
  });
  it("keeps the card a tap completed for the page's whole life („3 von 3“ after 2 → 3, ruling)", () => {
    expect(face(3, true)).toContain("3 von 3");
    expect(face(3, false)).toContain("3 von 3");
  });
  it("holds by what the tap credited, not one stamp", () => {
    expect(face(5, false, 3)).toContain("5 Stempel"); // 2 → 5 completed the 3-stamp reward
    expect(face(5, false, 1)).toContain("5 von 8"); // 4 → 5 counts to 8
  });
  it("leaves a single reward's ready line as it was", () => {
    expect(renderToStaticMarkup(createElement(TapCardFace, { card, balance: 8, moment: false }))).toContain("Prämie verfügbar.");
  });
});
