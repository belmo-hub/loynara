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
    expect(out).toMatch(/class="reward-remaining[^"]*">Noch <span[^>]*>2<\/span> Stempel bis zu deiner Prämie: <span[^>]*>Kaffee<\/span><\/h1>/);
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

describe("one point in the singular on the card (ENG-104)", () => {
  const card = (locale: "de" | "fr", balance: number, change: number, programType: "points" | "stamps" = "points") =>
    renderToStaticMarkup(h(CustomerCard, { ...base, programType, locale, balance, activity: [{ id: "a", label: "x", date: "d", change }] }));
  it("balance line, in German and French", () => {
    expect(card("de", 1, 1)).toMatch(/>1<\/span> <em>Punkt<\/em>/);
    expect(card("de", 2, 1)).toMatch(/>2<\/span> <em>Punkte<\/em>/);
    expect(card("fr", 1, 1)).toMatch(/>1<\/span> <em>point<\/em>/);
    expect(card("fr", 2, 1)).toMatch(/>2<\/span> <em>points<\/em>/);
    expect(card("de", 1, 1, "stamps")).toMatch(/>1<\/span> <em>Stempel<\/em>/);
  });
  it("activity line, for a booking and a redemption, in German and French", () => {
    expect(card("de", 5, 1)).toContain('<b data-sign="plus">+1 Punkt</b>');
    expect(card("de", 5, 2)).toContain('<b data-sign="plus">+2 Punkte</b>');
    expect(card("de", 5, -1)).toContain('<b data-sign="minus">-1 Punkt</b>');
    expect(card("de", 5, -2)).toContain('<b data-sign="minus">-2 Punkte</b>');
    expect(card("fr", 5, 1)).toContain('<b data-sign="plus">+1 point</b>');
    expect(card("fr", 5, 2)).toContain('<b data-sign="plus">+2 points</b>');
    expect(card("fr", 5, -1)).toContain('<b data-sign="minus">-1 point</b>');
    expect(card("de", 5, 1, "stamps")).toContain('<b data-sign="plus">+1 Stempel</b>');
  });
});

describe("counts on the card, French zero and French stamps included (ENG-108)", () => {
  const card = (locale: "de" | "fr", programType: "points" | "stamps", balance: number, extra: Partial<CustomerCardProps> = {}) =>
    renderToStaticMarkup(h(CustomerCard, { ...base, locale, programType, balance, ...extra }));
  it("balance line: French takes the singular for 0 and 1", () => {
    expect(card("fr", "points", 0)).toMatch(/>0<\/span> <em>point<\/em>/);
    expect(card("fr", "stamps", 0)).toMatch(/>0<\/span> <em>tampon<\/em>/);
    expect(card("fr", "stamps", 1)).toMatch(/>1<\/span> <em>tampon<\/em>/);
    expect(card("fr", "stamps", 2)).toMatch(/>2<\/span> <em>tampons<\/em>/);
    expect(card("de", "points", 0)).toMatch(/>0<\/span> <em>Punkte<\/em>/);
  });
  it("progress line with one stamp missing, in French", () => {
    expect(card("fr", "stamps", 4)).toMatch(/Encore <span[^>]*>1<\/span> tampon avant votre récompense :/);
    expect(card("fr", "stamps", 3)).toMatch(/Encore <span[^>]*>2<\/span> tampons avant votre récompense :/);
  });
  it("rewards list, with a reward that costs exactly 1", () => {
    const rewards = [{ id: "r1", title: "Kaffee", cost: 1 }, { id: "r2", title: "Kuchen", cost: 2 }];
    expect(card("de", "points", 0, { rewards })).toContain("<small>1 Punkt</small>");
    expect(card("de", "points", 0, { rewards })).toContain("<small>2 Punkte</small>");
    expect(card("fr", "points", 0, { rewards })).toContain("<small>1 point</small>");
    expect(card("fr", "points", 0, { rewards })).toContain("<small>2 points</small>");
    expect(card("fr", "stamps", 0, { rewards })).toContain("<small>1 tampon</small>");
    expect(card("fr", "stamps", 0, { rewards })).toContain("<small>2 tampons</small>");
  });
  it("activity line for French stamps", () => {
    const activity = (change: number) => ({ activity: [{ id: "a", label: "x", date: "d", change }] });
    expect(card("fr", "stamps", 5, activity(1))).toContain('<b data-sign="plus">+1 tampon</b>');
    expect(card("fr", "stamps", 5, activity(2))).toContain('<b data-sign="plus">+2 tampons</b>');
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
  it("lists every extra as a row under „Gut zu wissen“, nearest deadline first (ENG-122e)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", ...all }));
    const notes = out.slice(out.indexOf(">Gut zu wissen</h2>"));
    const order = ["Doppelte Punkte bis 17:00", "40 Punkte verfallen am 30.11.2026.", "Monats-Challenge", "2 von 3 Besuchen", "Dein Level: Silber", "Dein Vorteil: 10 % auf alles", "Noch 2 Besuche in 90 Tagen bis Gold."];
    order.forEach((text, index) => { if (index) expect(notes.indexOf(order[index - 1])).toBeLessThan(notes.indexOf(text)); });
  });
  it("keeps the fine print in the rules at full size", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, level: all.level, challenge: all.challenge }));
    const rules = out.slice(out.indexOf("customer-rules-title"));
    expect(rules).toContain("Monats-Challenge: Bestätigte Besuche an verschiedenen Tagen.");
    expect(rules).toContain("Das Level zählt deine Besuche der letzten 90 Tage.");
  });
  it("renders no „Gut zu wissen“ without extras", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Gut zu wissen");
  });
});

describe("Wegweiser card (ENG-122e)", () => {
  const two = [{ id: "r1", title: "Kaffee", cost: 5 }, { id: "r2", title: "Kuchen", cost: 9 }];
  it("shows the green band only while a reward is ready, and its chip on the reward", () => {
    const ready = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 5, rewards: two }));
    expect(ready).toContain("<b>Prämie verfügbar.</b><small>Lass sie an der Kasse einlösen.</small>");
    expect(ready.split("Einlösbar").length - 1).toBe(1);
    expect(ready).toContain("noch 4");
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, balance: 4, rewards: two }))).not.toContain("Prämie verfügbar.");
  });
  it("puts „Gut zu wissen“ above the rewards and the rules after the activity, inline", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, rulesText: "Ein Stempel pro Kaffee.", rewards: two, winback: { bonus: 1, until: "2026-11-05" }, onCloseCard: () => {} }));
    const at = (text: string) => out.indexOf(text);
    expect(at("Gut zu wissen")).toBeLessThan(at("Deine Prämien"));
    expect(at("Deine Prämien")).toBeLessThan(at("Letzte Aktivität"));
    expect(at("Letzte Aktivität")).toBeLessThan(at("Deine Karte<"));
    expect(at("Deine Karte<")).toBeLessThan(at("customer-rules-title"));
    expect(out).toContain("Ein Stempel pro Kaffee.");
    expect(at("customer-rules-title")).toBeLessThan(at("Karte schließen"));
  });
  it("opens recovery and Wallet from rows, and offers the Wallet row only with a button behind it", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, onAppleWallet: () => {} }));
    expect(out).toMatch(/aria-haspopup="dialog"[^>]*>.*<strong>In Wallet speichern<\/strong><small>Stand aktualisiert sich automatisch<\/small>/);
    expect(out).toMatch(/aria-haspopup="dialog"[^>]*>.*<strong>So findest du deine Karte wieder<\/strong>/);
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("In Wallet speichern");
  });
  it("makes the goal the page's heading, and the shop's name when there is no reward", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).toMatch(/<h1 class="reward-remaining/);
    const none = renderToStaticMarkup(h(CustomerCard, { ...base, rewards: [] }));
    expect(none).toMatch(/<h1 class="customer-header-merchant[^"]*">Synthetic Café<\/h1>/);
  });
  it("says the ready band's two lines as the live sentence, in German and French", async () => {
    const { copyFor } = await import("./customer-card-copy");
    for (const locale of ["de", "fr"] as const) { const t = copyFor(locale); expect(`${t.readyTitle} ${t.readyText}`).toBe(t.rewardReady); }
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
    expect(out).toContain("Votre niveau : Silber");
    expect(out).toContain("Votre avantage : 10 %");
    expect(out).toContain("Le niveau compte vos visites des 90 derniers jours.");
    expect(out).not.toMatch(/Monats-Challenge|Dein Level|Das Level zählt|von 3 Besuchen|Außerdem/);
  });
});

describe("win-back window on the card (ENG-089)", () => {
  it("names the bonus and the window's last day, right after a running happy hour", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, winback: { bonus: 1, until: "2026-11-05" } }));
    expect(out).toMatch(/>Willkommen zurück! Bis zum 5. November gibt&#x27;s bei deinem nächsten Besuch 1 Stempel extra\. <a href="#customer-rules"[^>]*>Bedingungen<\/a><\/span>/);
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, rulesText: "Ein Stempel pro Kaffee.", winback: { bonus: 1, until: "2026-11-05" } }))).toContain('<section id="customer-rules"');
    const both = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", happyHourUntil: "17:00", winback: { bonus: 20, until: "2026-11-05" } }));
    expect(both).toContain("<span>Doppelte Punkte bis 17:00</span>");
    expect(both.indexOf("Doppelte Punkte")).toBeLessThan(both.indexOf("Willkommen zurück"));
    expect(both).toMatch(/<span>Willkommen zurück! Bis zum 5. November gibt&#x27;s bei deinem nächsten Besuch 20 Punkte extra\. <a [^>]*>Bedingungen<\/a><\/span>/);
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, locale: "fr", winback: { bonus: 1, until: "2026-11-05" } }))).toContain("Bon retour ! Jusqu’au 5 novembre, votre prochaine visite vous rapporte 1 tampon supplémentaire.");
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Willkommen zurück");
  });
  it("says a one-point bonus in the singular, in German and French (ENG-103)", () => {
    const card = (locale: "de" | "fr", bonus: number) => renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", locale, winback: { bonus, until: "2026-11-05" } }));
    expect(card("de", 1)).toContain("bei deinem nächsten Besuch 1 Punkt extra.");
    expect(card("de", 2)).toContain("bei deinem nächsten Besuch 2 Punkte extra.");
    expect(card("fr", 1)).toContain("votre prochaine visite vous rapporte 1 point supplémentaire.");
    expect(card("fr", 2)).toContain("votre prochaine visite vous rapporte 2 points supplémentaires.");
  });
});
