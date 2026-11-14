import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";
import { actionSections, messageRoom, reopenDay, sendNote } from "./actions-list";

const me = (patch: Partial<MeResponse> = {}) => ({ programType: "stamp", happyHourEnabled: false, ...patch }) as MeResponse;
const titles = (sections: ReturnType<typeof actionSections>) => sections.map(section => [section.title, section.rows.map(row => row.title)]);
const BERLIN = "Europe/Berlin";

describe("Aktionen list (ENG-122d, screen 08)", () => {
  it("lists what a deployment offers, Happy Hour only for points, and always the two reports", () => {
    expect(titles(actionSections({ me: me(), hidden: [], room: null }))).toEqual([
      ["Für deine Stammkunden", ["Nachricht an deine Stammkunden", "Kampagnen", "Automationen"]],
      ["Auswertung", ["Ergebnisse", "Beratung"]],
    ]);
    expect(titles(actionSections({ me: me({ programType: "points" }), hidden: ["campaigns", "automations", "walletMessages"], room: null }))).toEqual([
      ["Für deine Stammkunden", ["Happy Hour"]], ["Auswertung", ["Ergebnisse", "Beratung"]],
    ]);
    // Nothing to send and no Happy Hour: only the reports, no empty head.
    expect(titles(actionSections({ me: me(), hidden: ["campaigns", "automations", "walletMessages"], room: null }))).toEqual([["Auswertung", ["Ergebnisse", "Beratung"]]]);
  });

  it("shows Happy Hour's state as on the Programm list", () => {
    const row = (on: boolean, earningMode: "manual" | "purchase" = "purchase") => actionSections({ me: me({ programType: "points", earningMode, happyHourEnabled: on }), hidden: [], room: null })[0].rows.find(item => item.title === "Happy Hour");
    expect(row(false)).toMatchObject({ value: "Aus", off: true, href: "/merchant/program/happy-hour?von=aktionen" });
    expect(row(true)).toMatchObject({ value: "An", off: false });
    expect(row(true, "manual")).toMatchObject({ value: "Aus", off: true }); // the server applies it to purchase awards only
  });

  it("counts free messages in the rolling 7 days (R9 FINAL)", () => {
    expect(messageRoom({ remaining: 2, nextAllowedAt: null, timezone: BERLIN })).toBe("Noch 2 frei · höchstens 2 in 7 Tagen");
    expect(messageRoom({ remaining: 1, nextAllowedAt: null, timezone: BERLIN })).toBe("Noch 1 frei · höchstens 2 in 7 Tagen");
    vi.useFakeTimers({ now: new Date("2026-10-28T12:00:00Z"), toFake: ["Date"] });
    try { expect(messageRoom({ remaining: 0, nextAllowedAt: "2026-10-30T13:00:00Z", timezone: BERLIN })).toBe("Wieder möglich ab 30.\u00a0Oktober"); } finally { vi.useRealTimers(); }
  });
});

describe("send confirmation (R12 FINAL)", () => {
  it("says what is left after this message", () => {
    expect(sendNote(18, 2, null)).toBe("Die Nachricht geht sofort an 18 Kunden mit Apple Wallet, die Nachrichten erlaubt haben. Danach ist noch 1 Nachricht frei, höchstens 2 in 7 Tagen.");
    expect(sendNote(18, 3, null)).toBe("Die Nachricht geht sofort an 18 Kunden mit Apple Wallet, die Nachrichten erlaubt haben. Danach sind noch 2 Nachrichten frei, höchstens 2 in 7 Tagen.");
    expect(sendNote(18, 1, "30. Oktober")).toBe("Die Nachricht geht sofort an 18 Kunden mit Apple Wallet, die Nachrichten erlaubt haben. Danach ist bis 30. Oktober keine Nachricht mehr frei.");
  });

  it("dates the next free message from the one still counted, after the night pause", () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const sent = (createdAt: string, status = "complete", count = 5) => ({ createdAt, status, sent: count });
    expect(reopenDay([sent("2026-10-23T09:00:00Z"), sent("2026-10-10T09:00:00Z")], BERLIN, now)).toBe("30.\u00a0Oktober");
    // Free again at 21:30 Berlin a week later (the clocks went back in between), inside the night pause: the day after.
    expect(reopenDay([sent("2026-10-23T20:30:00Z")], BERLIN, now)).toBe("31.\u00a0Oktober");
    // A message stopped before any send never counted.
    expect(reopenDay([sent("2026-10-27T09:00:00Z", "stopped", 0)], BERLIN, now)).toBeNull();
  });
});
