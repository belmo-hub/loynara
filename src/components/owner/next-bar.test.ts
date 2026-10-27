import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NextBar } from "./overview-board";
import { isNextHidden, nextHintKey } from "./overview";

const DAY = 86_400_000;

describe("„Als Nächstes“ can be closed", () => {
  it("offers a labelled close button only when it can be closed", () => {
    const closable = renderToStaticMarkup(createElement(NextBar, { title: "Seit 13 Tagen keine Buchung.", onClose: () => {} }));
    expect(closable).toContain('aria-label="Hinweis schließen"');
    expect(renderToStaticMarkup(createElement(NextBar, { title: "Seit 13 Tagen keine Buchung." }))).not.toContain("Hinweis schließen");
  });

  it("keeps one quiet gap's hint closed while the day count grows, and a booking starts a new gap", () => {
    const gap = nextHintKey({ locationId: "loc", quiet: 13, lastBookingOn: "2026-10-14", title: "Seit 13 Tagen keine Buchung." });
    expect(nextHintKey({ locationId: "loc", quiet: 14, lastBookingOn: "2026-10-14", title: "Seit 14 Tagen keine Buchung." })).toBe(gap);
    expect(nextHintKey({ locationId: "loc", quiet: 8, lastBookingOn: "2026-10-19", title: "Seit 8 Tagen keine Buchung." })).not.toBe(gap);
    expect(nextHintKey({ locationId: "other", quiet: 13, lastBookingOn: "2026-10-14", title: "x" })).not.toBe(gap);
    expect(nextHintKey({ locationId: "loc", quiet: null, lastBookingOn: "2026-10-26", title: "3 Karten können jetzt eine Prämie einlösen." })).toBe("loc:3 Karten können jetzt eine Prämie einlösen.");
  });

  it("stays closed for 7 days for the same hint only", () => {
    const now = Date.UTC(2026, 9, 27);
    const stored = `${now + 7 * DAY}|loc:quiet:2026-10-14`;
    expect(isNextHidden(stored, "loc:quiet:2026-10-14", now)).toBe(true);
    expect(isNextHidden(stored, "loc:quiet:2026-10-14", now + 7 * DAY)).toBe(false);
    expect(isNextHidden(stored, "loc:quiet:2026-10-19", now)).toBe(false);
    expect(isNextHidden(null, "loc:quiet:2026-10-14", now)).toBe(false);
    expect(isNextHidden("not a stored hint", "loc:quiet:2026-10-14", now)).toBe(false);
  });
});
