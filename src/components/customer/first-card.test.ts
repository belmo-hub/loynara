import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FirstCard } from "./first-card";

const stamps = { programType: "stamp" as const, rewardTitle: "Gratiskaffee", rewardCost: 8, rewards: [] };
const points = { programType: "points" as const, rewardTitle: "Pizza", rewardCost: 100, rewards: [] };
const earned = (out: string) => out.split("data-earned").length - 1;

describe("the first page's card, also the owner's „So sieht es der Gast“ preview (ENG-207)", () => {
  it("is the plain card without a Startbonus at sign-up: no ring marked, no label, no filled place", () => {
    const out = renderToStaticMarkup(h(FirstCard, { program: stamps }));
    expect(out).not.toContain("data-promised");
    expect(out).not.toContain("Startbonus");
    expect(earned(out)).toBe(0);
    expect(out).toContain("<strong>Gratiskaffee</strong> für 8 Stempel");
  });
  it("shows the promised places as rings and the label, never a fill", () => {
    const out = renderToStaticMarkup(h(FirstCard, { program: stamps, promised: 2, bonus: true }));
    expect(out).toContain('data-promised="2"');
    expect(out).toContain(" · Startbonus");
    expect(earned(out)).toBe(0);
    expect(renderToStaticMarkup(h(FirstCard, { program: stamps, promised: 1, bonus: true }))).toContain('data-promised="1"');
    // The promise is spoken too, only while it shows.
    expect(out).toContain('aria-label="0 von 8 Stempeln, 2 davon als Startbonus"');
    expect(renderToStaticMarkup(h(FirstCard, { program: stamps }))).toContain('aria-label="0 von 8 Stempeln"');
    expect(renderToStaticMarkup(h(FirstCard, { program: stamps, filled: 2, bonus: true }))).toContain('aria-label="2 von 8 Stempeln"');
  });
  it("fills only what the server booked, and those places land once", () => {
    const out = renderToStaticMarkup(h(FirstCard, { program: stamps, filled: 2, created: true, bonus: true }));
    expect(earned(out)).toBe(2);
    expect(out.split("data-new").length - 1).toBe(2);
    expect(out).not.toContain("data-promised");
  });
  it("promises on a points card in the footer alone: the track stays at 0", () => {
    const out = renderToStaticMarkup(h(FirstCard, { program: points, promised: 25, bonus: true }));
    expect(out).not.toContain("data-promised");
    expect(out).toContain(" · Startbonus");
    expect(out).toContain('aria-label="0 von 100 Punkten, 25 davon als Startbonus"');
  });
  it("is the card the join page renders, and the owner's preview follows the picks", () => {
    const join = readFileSync("src/components/join-client.tsx", "utf8"), owner = readFileSync("src/components/owner/program-extras.tsx", "utf8");
    expect(join).toContain("<FirstCard program={program} label={t.cardPreview}");
    // Only a valid amount at sign-up is promised; „Mit der ersten Buchung“ and „Aus“ show the plain card.
    expect(owner).toContain("const promised = signUp && wholeIn(value, 1, max) ? amount : 0;");
    expect(owner).toContain("aside={<GuestCard program={program} promised={promised} />}");
    expect(owner).toContain("<FirstCard program={program} promised={promised} bonus={promised > 0} />");
  });
});
