import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerCard, type CustomerCardProps } from "./customer-card";

const base: CustomerCardProps = { businessName: "Synthetic Café", locationName: "Kassel", programType: "stamps", balance: 1, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }] };

describe("card news", () => {
  it("renders the owner's text as plain, escaped text", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, news: `<img src=x onerror="alert(1)"> & <b>neu</b>` }));
    expect(out).toContain("Neuigkeiten");
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &lt;b&gt;neu&lt;/b&gt;");
    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<b>neu");
  });
  it("shows no news panel when there is none", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("customer-news-title");
  });
});

describe("review link", () => {
  it("is a plain link with the agreed text, opened without a referrer", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, reviewUrl: "https://g.page/r/Synthetic123/review" }));
    expect(out).toContain('<a href="https://g.page/r/Synthetic123/review" target="_blank" rel="noopener noreferrer">Hat es dir gefallen? Hinterlass uns eine Bewertung.</a>');
  });
  it("is absent without a link", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Bewertung");
  });
});

describe("progress (Impeccable K1, K3)", () => {
  const count = (out: string, text: string) => out.split(text).length - 1;
  it("states the progress once, above the card, and names the reward", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 3 }));
    expect(count(out, "reward-remaining")).toBe(1);
    expect(out).toMatch(/class="reward-remaining[^"]*">Noch <span[^>]*>2<\/span> Stempel bis zu deiner Prämie: <span[^>]*>Kaffee<\/span><\/p>/);
    expect(out.indexOf("reward-remaining")).toBeLessThan(out.indexOf("customer-card "));
  });
  it("names the ready reward, and the next goal underneath", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 5, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }, { id: "r2", title: "Kuchen", cost: 9 }] }));
    expect(out).toMatch(/Deine Prämie ist bereit: <span[^>]*>Kaffee<\/span>/);
    expect(out).toContain("Nächstes Ziel: noch 4 Stempel für „Kuchen“.");
    expect(out).toContain("Zum Einlösen an der Kasse zeigen.");
  });
  it("puts no shop rule under the code and no bank word on the balance (K2, Marketing 23 Oct)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, base));
    expect(out).not.toContain("Buchungen müssen an der Kasse bestätigt werden");
    expect(out).not.toContain("Kontostand");
    expect(out).toContain("<span>Gesammelt</span>");
  });
});

describe("ending programme (ENG-075, card half)", () => {
  it("opens the card with the end date and what still works until then", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, endsOn: "30. November 2026" }));
    expect(out).toContain("Diese Karte endet am 30. November 2026.");
    expect(out).toContain("Bis dahin kannst du weiter Stempel sammeln und Prämien einlösen.");
    expect(out.indexOf("Diese Karte endet")).toBeLessThan(out.indexOf("reward-remaining"));
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", endsOn: "30.11.2026" }))).toContain("weiter Punkte sammeln");
  });
  it("is absent while the programme runs", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("customer-ending-title");
  });
});

describe("extras: one in full, the rest folded (Impeccable L6)", () => {
  const all: Partial<CustomerCardProps> = {
    happyHourUntil: "17:00",
    pointsExpiry: { rule: "Punkte verfallen nach 12 Monaten.", batches: ["40 Punkte am 30.11.2026"], notice: "40 Punkte verfallen am 30.11.2026." },
    challenge: { text: "Komm 3-mal vorbei.", conditions: "Bestätigte Besuche an verschiedenen Tagen.", visits: 2, target: 3, done: false },
    level: { name: "Silber", perk: "10 % auf alles", until: "15.01.2027", visits: 4, next: { name: "Gold", visits: 2 } },
  };
  it("shows the extra with the nearest deadline in full and lists the others in one quiet line each, in a fixed order", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", ...all }));
    expect(out).toContain(">Doppelte Punkte bis 17:00</p>");
    expect(out).not.toContain("customer-level-title");
    expect(out).not.toContain("customer-challenge-title");
    const list = out.slice(out.indexOf('aria-label="Außerdem"'));
    expect(list.indexOf("40 Punkte verfallen am 30.11.2026.")).toBeLessThan(list.indexOf("Monats-Challenge: 2 von 3 Besuchen"));
    expect(list.indexOf("Monats-Challenge: 2 von 3 Besuchen")).toBeLessThan(list.indexOf("Dein Level: Silber · 10 % auf alles"));
  });
  it("shows the level in full when it is the only extra, and keeps the fine print in the rules at full size", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, level: all.level, challenge: all.challenge }));
    expect(out).toContain("customer-challenge-title");
    expect(out).toContain("Dein Level: Silber · 10 % auf alles");
    expect(out).not.toContain("<small>");
    const rules = out.slice(out.indexOf("customer-rules-title"));
    expect(rules).toContain("Monats-Challenge: Bestätigte Besuche an verschiedenen Tagen.");
    expect(rules).toContain("Das Level zählt deine Besuche der letzten 90 Tage.");
  });
  it("renders no extras block without extras", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Außerdem");
  });
});

describe("round 2 (Impeccable batch 2, PR I)", () => {
  it("names the shop once: in the header; the card shows the location only when it differs", () => {
    const out = renderToStaticMarkup(h(CustomerCard, base));
    expect(out.split(">Synthetic Café<").length - 1).toBe(1);
    expect(out).toMatch(/customer-card-business[^"]*"><span>Kassel<\/span><\/p>/);
    const same = renderToStaticMarkup(h(CustomerCard, { ...base, locationName: "Synthetic Café" }));
    expect(same).toMatch(/customer-card-business[^"]*"><\/p>/);
  });
  it("puts the reward's name on its own line under the headline", () => {
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, balance: 3 }))).toMatch(/bis zu deiner Prämie: <span class="goal-reward [^"]*">Kaffee<\/span>/);
  });
  it("speaks French for the level, the challenge and the rules on a French card", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, locale: "fr", level: { name: "Silber", perk: "10 %", until: "15.01.2027", visits: 4, next: { name: "Gold", visits: 2 } },
      challenge: { text: "x", conditions: "y", visits: 2, target: 3, done: false } }));
    expect(out).toContain("Défi du mois");
    expect(out).toContain("2 visites sur 3");
    expect(out).toContain("Votre niveau : Silber · 10 %");
    expect(out).toContain('aria-label="Également"');
    expect(out).toContain("Le niveau compte vos visites des 90 derniers jours.");
    expect(out).not.toMatch(/Monats-Challenge|Dein Level|Das Level zählt|von 3 Besuchen|Außerdem/);
  });
});
