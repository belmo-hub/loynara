import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { cardGoal } from "./card-face";
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
    expect(out).toContain('<a href="https://g.page/r/Synthetic123/review" target="_blank" rel="noopener noreferrer">Auf Google bewerten</a>');
  });
  it("is absent without a link", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("bewerten");
  });
});

describe("progress (Impeccable K1, K3)", () => {
  const count = (out: string, text: string) => out.split(text).length - 1;
  it("states the progress once, in the card's foot, and names the reward (mix, ENG-255)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 3 }));
    expect(count(out, "reward-remaining")).toBe(1);
    expect(out).toMatch(/<p class="reward-remaining[^"]*">Noch <span[^>]*>2<\/span> Stempel bis zu deiner Prämie: <span[^>]*>Kaffee<\/span><\/p>/);
    expect(out.indexOf("customer-card ")).toBeLessThan(out.indexOf("reward-remaining"));
  });
  it("names the ready reward, and the next goal underneath", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, cardLocator: "K-ABC234", balance: 5, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }, { id: "r2", title: "Kuchen", cost: 9 }] }));
    expect(out).toMatch(/Deine Prämie ist bereit: <span[^>]*>Kaffee<\/span>/);
    expect(out).toContain("Nächstes Ziel: noch 4 Stempel für „Kuchen“.");
    expect(out).toContain("<small>Zum Einlösen an der Kasse zeigen.</small>");
  });
  it("puts no shop rule under the code and no bank word on the balance (K2, Marketing 23 Oct)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, base));
    expect(out).not.toContain("Buchungen müssen an der Kasse bestätigt werden");
    expect(out).not.toContain("Kontostand");
    expect(out).toMatch(/<b data-figure=""><span[^>]*>1<\/span><\/b><span>von 5<\/span>/);
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
    expect(card("de", 1, 1, "stamps")).toMatch(/<b data-figure=""><span[^>]*>1<\/span><\/b><span>von 5<\/span>/);
  });
  it("activity line, for a booking and a redemption, in German and French", () => {
    expect(card("de", 5, 1)).toContain('<b>+1</b> <small>Punkt</small>');
    expect(card("de", 5, 2)).toContain('<b>+2</b> <small>Punkte</small>');
    expect(card("de", 5, -1)).toMatch(/data-sign="minus"><b>-1<\/b> <small>Punkt<\/small>/);
    expect(card("de", 5, -2)).toMatch(/data-sign="minus"><b>-2<\/b> <small>Punkte<\/small>/);
    expect(card("fr", 5, 1)).toContain('<b>+1</b> <small>point</small>');
    expect(card("fr", 5, 2)).toContain('<b>+2</b> <small>points</small>');
    expect(card("fr", 5, -1)).toMatch(/data-sign="minus"><b>-1<\/b> <small>point<\/small>/);
    expect(card("de", 5, 1, "stamps")).toContain('<b>+1</b> <small>Stempel</small>');
  });
});

describe("counts on the card, French zero and French stamps included (ENG-108)", () => {
  const card = (locale: "de" | "fr", programType: "points" | "stamps", balance: number, extra: Partial<CustomerCardProps> = {}) =>
    renderToStaticMarkup(h(CustomerCard, { ...base, locale, programType, balance, ...extra }));
  it("balance line: French takes the singular for 0 and 1", () => {
    expect(card("fr", "points", 0)).toMatch(/>0<\/span> <em>point<\/em>/);
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
    expect(card("fr", "stamps", 5, activity(1))).toContain('<b>+1</b> <small>tampon</small>');
    expect(card("fr", "stamps", 5, activity(2))).toContain('<b>+2</b> <small>tampons</small>');
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

describe("Gut zu wissen (mock 25, G-13)", () => {
  const all: Partial<CustomerCardProps> = {
    happyHourUntil: "17:00",
    pointsExpiry: { rule: "Punkte verfallen nach 12 Monaten.", batches: ["40 Punkte am 30.11.2026"], notice: "40 Punkte verfallen am 30.11.2026." },
    challenge: { text: "Komm 3-mal vorbei.", conditions: "Bestätigte Besuche an verschiedenen Tagen.", visits: 2, target: 3, done: false },
    level: { name: "Silber", perk: "10 % auf alles", until: "15.01.2027", visits: 4, next: { name: "Gold", visits: 2 } },
  };
  it("lists every extra as a row under one head, nearest deadline first", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", ...all }));
    const notes = out.slice(out.indexOf("customer-notes-title"), out.indexOf("customer-rewards-title"));
    const order = ["Doppelte Punkte bis 17:00", "40 Punkte verfallen am 30.11.2026.", "Monats-Challenge", "2 von 3 Besuchen", "Dein Level: Silber", "Dein Vorteil: 10 % auf alles"];
    expect(order.map(text => notes.indexOf(text))).toEqual(order.map(text => notes.indexOf(text)).sort((a, b) => a - b));
    expect(order.every(text => notes.includes(text))).toBe(true);
  });
  it("keeps the fine print in the programme rules", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, level: all.level, challenge: all.challenge }));
    const rules = out.slice(out.indexOf('id="customer-rules"'));
    expect(rules).toContain("Monats-Challenge: Bestätigte Besuche an verschiedenen Tagen.");
    expect(rules).toContain("Das Level zählt deine Besuche der letzten 90 Tage.");
  });
  it("shows no level row while the card has no level yet, and no head without extras", () => {
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, level: { ...all.level!, name: null } }))).not.toContain("customer-notes-title");
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Gut zu wissen");
  });
});

describe("the card page's parts (mocks 23–26, ENG-148)", () => {
  it("shows the ready band only while a reward is ready", () => {
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, balance: 5 }))).toContain("<b>Prämie verfügbar.</b><small>Lass sie an der Kasse einlösen.</small>");
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("Prämie verfügbar.");
  });
  it("leads a points card with the balance and names each reward on the ladder", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", balance: 112, rewards: [{ id: "a", title: "Bartöl", cost: 100 }, { id: "b", title: "Haarschnitt", cost: 250 }] }));
    expect(out).toMatch(/customer-balance-line[^"]*"><strong><span[^>]*>112<\/span> <em>Punkte<\/em><\/strong>/);
    expect(out).toMatch(/>100<\/small><small[^>]*>Bartöl<\/small>/);
  });
  it("aligns an early reward's labels to the ladder's start and the last one's to its end (Design FIX 4)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", balance: 0, rewards: [{ id: "a", title: "Ein sehr langer Prämienname", cost: 20 }, { id: "b", title: "Haarschnitt", cost: 250 }] }));
    expect(out).toMatch(/data-start="true"[^>]*><span[^>]*><\/span><small[^>]*>20<\/small><small[^>]*>Ein sehr langer Prämienname/);
    expect(out).toMatch(/data-end="true"[^>]*><span[^>]*><\/span><small[^>]*>250<\/small>/);
  });
  it("makes the export link the „Deine Karte“ row itself, chevron inside, and paints each card's own ground on arrival (Design re-check, 18 Nov)", async () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, exportUrl: "/api/card/x/export" }));
    expect(out).toMatch(/<a class="terms-link [^"]*row[^"]*" href="\/api\/card\/x\/export"[^>]*><span[^>]*><span[^>]*><b>Meine Kartendaten exportieren<\/b><\/span><svg/);
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain("background: var(--card-ground, linear-gradient(160deg, var(--merchant) 0%, var(--merchant-deep) 100%));");
    expect(css).toContain('.mix [role="img"] > span[data-new]');
  });
  it("marks the picked reward by weight and a check, without a ring, in both programmes (Design, 18 Nov)", async () => {
    for (const programType of ["points", "stamps"] as const) {
      const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }, { id: "r2", title: "Kuchen", cost: 9 }] }));
      expect(out.split('aria-pressed="true"').length - 1).toBe(1);
      expect(out).toMatch(/aria-pressed="true"[^>]*>(?:(?!aria-pressed).)*?<svg[^>]*lucide-check[^>]*data-on="true"/);
      // Every row reserves the check's width; only the picked one shows it.
      expect(out.split("lucide-check").length - 1).toBeGreaterThanOrEqual(2);
    }
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).not.toMatch(/aria-pressed="true"\] \{[^}]*box-shadow/);
  });
  it("draws the later activity rows' first hairline on the row's body, not its tile (Design, 18 Nov)", async () => {
    const activity = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: "Gesammelt", date: "Mo", change: 1 }));
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, activity }));
    // A row is the tile first, the body last.
    expect(out).toMatch(/<li class="[^"]*" data-lead="tile"><span class="[^"]*tile[^"]*" aria-hidden="true">.*?<\/span><span class="[^"]*body[^"]*">/);
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain(".activityMore li:first-child > span:last-child { padding-top: 7px; border-top: 1px solid var(--color-line); }");
    expect(css).not.toMatch(/\.activityMore li:first-child > span \{/);
  });
  it("draws the export row's hairline itself and keeps it ink in forced colours (Design, 18 Nov)", async () => {
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain(".export a > span { padding-top: 7px; border-top: 1px solid var(--color-line); }");
    expect(css).toContain("@media (forced-colors: active) { .export a { color: ButtonText; } }");
  });
  it("keeps a points programme on the house card with its ladder, never the mix card (Design, 18 Nov)", () => {
    const points = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", balance: 40, rewards: [{ id: "a", title: "Kaffee", cost: 50 }, { id: "b", title: "Kuchen", cost: 100 }] }));
    expect(points).toContain('class="customer-card ');
    expect(points).toContain("customer-balance-line");
    expect(points).toContain("customer-card-business");
    expect(points).not.toContain("<b>Synthetic Café</b>");
    expect(points).toMatch(/Noch <span[^>]*>10<\/span> Punkte bis zu deiner Prämie: <span class="goal-reward/);
    const stamps = renderToStaticMarkup(h(CustomerCard, base));
    expect(stamps).toContain("<b>Synthetic Café</b>");
    expect(stamps).not.toContain("customer-card-business");
  });
  it("draws the stamps as the mix card: open slots are plain discs, no gift slot (mix ruling 1)", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("data-reward");
  });
  it("lists „Deine Prämien“ only when there is a choice of rewards (ENG-255)", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("customer-rewards-title");
    const two = renderToStaticMarkup(h(CustomerCard, { ...base, rewards: [{ id: "r1", title: "Kaffee", cost: 5 }, { id: "r2", title: "Kuchen", cost: 9 }] }));
    expect(two).toContain("Deine Prämien");
    expect(two).toMatch(/aria-pressed="true"[^>]*>.*?<b>Kaffee<\/b>/);
  });
  it("puts the Wallet button under the ticket, rules and recovery in „Deine Karte“, and the legal links open beside the card", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, cardLocator: "K-ABC234", qrSrc: "/api/qr?value=x", rulesText: "Ein Stempel pro Kaffee.", onAppleWallet: () => {} }));
    const order = ["customer-qr-panel", "wallet-add--apple", "customer-activity-title", "customer-more-title"].map(text => out.indexOf(text));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(order[0]).toBeGreaterThan(-1);
    expect(out).not.toContain("In Wallet speichern");
    const rows = out.slice(out.indexOf("customer-more-title"));
    for (const title of ["Programmregeln", "So findest du deine Karte wieder"]) expect(rows).toContain(`<b>${title}</b>`);
    expect(out).toContain('<a target="_blank" rel="noopener" href="/datenschutz">Datenschutz</a>');
  });
  it("caps the activity at three rows behind „Alle anzeigen“", () => {
    const activity = Array.from({ length: 5 }, (_, i) => ({ id: String(i), label: "Besuch erfasst", date: "Mo", change: 1 }));
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, activity }));
    expect(out.split("Besuch erfasst").length - 1).toBe(3);
    expect(out).toContain("Alle anzeigen");
  });
});

describe("round 2 (Impeccable batch 2, PR I)", () => {
  it("heads the page „Deine Treuekarte“ and names the shop once, on the card (mix, ENG-255)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, base));
    expect(out).toMatch(/<h1 class="customer-header [^"]*">Deine Treuekarte<\/h1>/);
    expect(out).toContain("<b>Synthetic Café</b><span>Kassel</span>");
    expect(out.split("Synthetic Café").length - 1).toBe(1);
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
    expect(out).toContain("Le niveau compte vos visites des 90 derniers jours.");
    expect(out).not.toMatch(/Monats-Challenge|Dein Level|Das Level zählt|von 3 Besuchen/);
  });
});

describe("win-back window on the card (ENG-089)", () => {
  it("names the bonus and the window's last day, right after a running happy hour", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, winback: { bonus: 1, until: "2026-11-05" } }));
    // Legal (24 Oct): the rules stay one tap away; „Bedingungen“ opens them.
    expect(out).toMatch(/>Willkommen zurück! Bis zum 5. November gibt&#x27;s bei deinem nächsten Besuch 1 Stempel extra\. <button type="button" aria-haspopup="dialog"[^>]*>Bedingungen<\/button><\/span>/);
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, rulesText: "Ein Stempel pro Kaffee.", winback: { bonus: 1, until: "2026-11-05" } }))).toContain('id="customer-rules"');
    const both = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", happyHourUntil: "17:00", winback: { bonus: 20, until: "2026-11-05" } }));
    expect(both.indexOf("Doppelte Punkte bis 17:00")).toBeLessThan(both.indexOf("Willkommen zurück! Bis zum 5. November gibt&#x27;s bei deinem nächsten Besuch 20 Punkte extra."));
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

describe("changes waiting for their date (ENG-100 U3)", () => {
  it("lists each line under the card, and a long new rule opens from its line", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, changes: { lines: ["Ab 24.11. gibt es Kaffee für 6 Stempel. Bis dahin reichen 5.", { text: "Ab 24.11. gilt eine neue Regel. Bis dahin bleibt es bei der bisherigen.", link: true }], newRule: { on: "24.11.", text: "Nur abends." } } }));
    expect(out).toContain("Ab 24.11. gibt es Kaffee für 6 Stempel. Bis dahin reichen 5.");
    expect(out).toContain("Neue Regel lesen");
  });

  it("is wired from the card read on the card page", async () => {
    // The card page passes the server's waiting changes through cardChanges (src/lib/change-lines.ts, tested there).
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/components/card-client.tsx", "utf8")).toMatch(/changes=\{cardChanges\(\{[^}]*rewards: card\.rewards, pending: card\.pending, pendingExpiry: card\.pendingExpiry \}\)\}/);
  });
});

describe("ladder names by need, the goal first (Design rounds 2 and 3)", () => {
  const marks = (...at: number[]) => at.map((x) => ({ at: x, hideLabel: false }));
  // Measured widths of the names in Manrope 14/650 (rounded): Bartöl, Haarschnitt gratis, Espresso zum Mitnehmen, Rasur.
  const W = { bartol: 44, goal: 122, espresso: 160, rasur: 40 };
  const sets = { drei: { at: [0.32, 0.64, 1], needs: [W.bartol, W.rasur, W.goal] }, frueh: { at: [0.08, 0.4, 1], needs: [W.espresso, W.bartol, W.goal] } };

  it("keeps the goal whole beside a short neighbour on a 228 px track (100 Bartöl / 250 Haarschnitt gratis)", async () => {
    const { titleLayout } = await import("@/components/ui/points-ladder");
    const { titles: [bartol, goal] } = titleLayout(marks(0.4, 1), 228, [W.bartol, W.goal]);
    expect(goal?.width).toBe(W.goal);
    expect(bartol?.width).toBe(W.bartol);
  });

  it("never lets a shown name span another marker whose price is shown (Design round 3)", async () => {
    const { titleLayout } = await import("@/components/ui/points-ladder");
    for (const [name, set] of Object.entries(sets)) for (const track of [228, 283, 364]) {
      const { titles, covered } = titleLayout(marks(...set.at), track, set.needs);
      expect(titles[2]?.width, `${name} ${track}: goal whole`).toBe(W.goal);
      titles.forEach((title, i) => {
        if (!title) return;
        const at = set.at[i] * track, from = set.at[i] === 1 ? at + 14 - title.width : set.at[i] < 0.25 ? at - 14 : at - title.width / 2 + title.shift;
        set.at.forEach((other, j) => {
          if (j === i || covered[j]) return;
          const x = other * track;
          expect(from < x + 12 && from + title.width > x - 12, `${name} ${track}: name ${i} over price ${j}`).toBe(false);
        });
      });
    }
  });

  it("hides a name that would fall under the 72 px floor, and keeps the goal at its full width", async () => {
    const { titleLayout, TITLE_FLOOR } = await import("@/components/ui/points-ladder");
    const { titles } = titleLayout(marks(0.55, 1), 200, [150, W.goal]);
    expect(titles[1]?.width).toBe(W.goal);
    expect(titles[0]).toBeNull();
    expect(titleLayout(marks(0.55, 1), 400, [150, W.goal]).titles[0]?.width).toBeGreaterThanOrEqual(TITLE_FLOOR);
  });

  it("always shows the goal's price and name when the top prices sit close (50 / 220 / 240 / 250, Design round 4)", async () => {
    const { ladderMarks, titleLayout } = await import("@/components/ui/points-ladder");
    const marks = ladderMarks([50, 220, 240, 250].map((cost) => ({ title: String(cost), cost })), 250, 0);
    expect(marks.map((m) => m.hideLabel)).toEqual([false, true, true, false]);
    for (const track of [228, 283, 364]) {
      const { titles, covered } = titleLayout(marks, track, [48, 110, 120, W.goal]);
      expect(titles[3]?.width, `${track}`).toBe(W.goal);
      expect(covered[3]).toBe(false);
    }
  });

  it("does not slide a middle name off its marker to make room", async () => {
    const { titleLayout } = await import("@/components/ui/points-ladder");
    const { titles } = titleLayout(marks(0.5, 1), 228, [100, W.goal]);
    for (const title of titles) if (title) expect(Math.abs(title.shift)).toBeLessThanOrEqual(title.width / 2 - 8);
  });
});

describe("ENG-130 placement kept by the rebuild (Reviewer N-2)", () => {
  it("puts the saved line above the card and the notices (the moved-up consent panel) right under it", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, walletSaved: true, notices: h("section", { id: "consent-panel" }) }));
    const saved = out.indexOf("In Apple Wallet gespeichert"), cardAt = out.indexOf('class="customer-card '), panel = out.indexOf('id="consent-panel"');
    expect(saved).toBeGreaterThan(-1);
    expect(saved).toBeLessThan(cardAt);
    expect(cardAt).toBeLessThan(panel);
    // Nothing but the card's own band and refresh row sits between the card and the panel.
    expect(out.slice(cardAt, panel)).not.toMatch(/customer-(notes|rewards|activity|more)-title/);
  });
});

describe("the Wallet sheet's badges (ENG-132)", () => {
  const sheet = (extra: Partial<CustomerCardProps> = {}) => renderToStaticMarkup(h(CustomerCard, { ...base, onAppleWallet: () => {}, onGoogleWallet: () => {}, ...extra }));
  const button = (html: string, id: string) => html.match(new RegExp(`<button[^>]*wallet-add--${id}[^>]*>.*?</button>`))?.[0] ?? "";
  it("names each badge button as its artwork reads, also while busy, and keeps the status line mounted", () => {
    for (const walletBusy of [null, "apple"] as const) {
      const html = sheet({ walletBusy });
      for (const [id, name] of [["apple", "Hinzufügen zu Apple Wallet"], ["google", "Hinzufügen zu Google Wallet"]]) {
        expect(button(html, id)).not.toContain("aria-label");
        expect(button(html, id)).toContain(`alt="${name}"`);
      }
      expect(html).toMatch(new RegExp(`<p class="wallet-busy[^"]*" role="status">${walletBusy ? "Wird vorbereitet …" : ""}</p>`));
    }
  });
  it("gives a French card the house button with its wording (no French Apple artwork yet)", () => {
    const apple = button(sheet({ locale: "fr" }), "apple");
    expect(apple).not.toContain("<img");
    expect(apple).toContain("Ajouter à Apple Wallet");
  });
  it("never dims a badge while the buttons are disabled", async () => {
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain(".walletButton[data-badge]:disabled { opacity: 1; }");
  });
  it("shows the official badge on its own, not inside a black bar (Design, 18 Nov)", async () => {
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain(".walletButton[data-badge] { justify-self: center; width: fit-content; min-height: 0; padding: 0; border-radius: var(--radius-sm); background: transparent; }");
    expect(css).toContain(".walletButton img { display: block; height: 48px; width: auto; }");
  });
});

describe("the reward moment (ENG-206)", () => {
  const ready = { ...base, balance: 5, moment: { credited: 1, balance: 5 } };
  it("names the reward on its own line from the first frame, and presses the card only once the last stamp has landed", () => {
    // Marketing (10 Nov): the live phrase, then the owner's title alone on its own line, nothing added.
    const headline = /Deine Prämie ist bereit: <span class="goal-reward[^"]*">Kaffee<\/span><\/p>/;
    const waiting = renderToStaticMarkup(h(CustomerCard, { ...ready, balance: 4 }));
    expect(waiting).toMatch(headline);
    expect(waiting).not.toContain("data-card-press");
    const out = renderToStaticMarkup(h(CustomerCard, { ...ready, landed: 5, landedCount: 1 }));
    expect(out).toMatch(headline);
    expect(out).toContain('data-card-press="true"');
    expect(out).toMatch(/data-arrive="true"[^>]*>.*Prämie verfügbar/);
  });
  it("names the reward the goal line named when one booking makes two rewards ready", () => {
    const rewards = [{ id: "r2", title: "Kuchen", cost: 100 }, { id: "r1", title: "Kaffee", cost: 50 }];
    const goal = (out: string) => out.match(/<span class="goal-reward[^>]*>([^<]*)</)?.[1];
    expect(goal(renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", rewards, balance: 40 })))).toBe("Kaffee");
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, programType: "points", rewards, balance: 110, landed: 110, landedCount: 70, moment: { credited: 70, balance: 110 } }));
    expect(out).toContain('data-card-press="true"');
    expect(goal(out)).toBe("Kaffee");
  });
  it("is not played by a booking that reaches no reward, nor again for a reward that was ready before", () => {
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, balance: 3, landed: 3, moment: { credited: 1, balance: 3 } }))).not.toContain("data-card-press");
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, balance: 6, landed: 6, moment: { credited: 1, balance: 6 } }))).not.toContain("data-card-press");
  });
  it("keeps the reward's title on its own line in the card's foot, ready or not", async () => {
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toMatch(/\n\.rewardName \{ display: block;/);
  });
  it("without a moment (STAMP_ANIMATION_ENABLED off) the card shows its state: no pill, no landing, no sequence", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 5 }));
    expect(out).not.toContain("Stempel erhalten");
    expect(out).not.toContain("data-card-press");
    expect(out).not.toContain("data-arrive=");
    expect(out).not.toContain("data-alone");
    expect(out).toContain("Prämie verfügbar");
  });
});

describe("the card after the join page (ENG-205)", () => {
  const card = { businessName: "Café", locationName: "Kassel", programType: "stamps" as const, balance: 0, rewards: [{ id: "a", title: "Kaffee", cost: 8 }] };
  it("opens as a return only when told: marked on the card group, and its ground does not arrive again", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CustomerCard } = await import("./customer-card");
    expect(renderToStaticMarkup(createElement(CustomerCard, card))).not.toContain("data-return");
    expect(renderToStaticMarkup(createElement(CustomerCard, { ...card, quiet: true }))).toContain('data-return="true"');
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css).toContain(".lead[data-return] .object > section::before { animation: none; }");
    expect(css.indexOf(".lead[data-return] .object > section::before")).toBeGreaterThan(css.indexOf(".lead[data-arriving] .object > section::before"));
  });
  it("has no placeholder on a return: the bare ground with its heading while the read is pending, then the content fades in once", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CustomerCardLoading, CustomerCardReturning } = await import("./customer-card");
    const bare = renderToStaticMarkup(createElement(CustomerCardReturning, { label: "Deine Karte wird geladen." }));
    expect(bare).toMatch(/<h1 class="[^"]*srOnly[^"]*" aria-busy="true">Deine Karte wird geladen\.<\/h1>/);
    expect(bare).not.toMatch(/skeleton/i);
    expect(renderToStaticMarkup(createElement(CustomerCardLoading, { label: "Deine Karte wird geladen." }))).toMatch(/skeleton/i);
    const read = (path: string) => import("node:fs").then(fs => fs.readFileSync(path, "utf8"));
    expect(await read("src/components/customer/customer-card.tsx")).toContain("cover={arriving && (!quiet || props.waited) ? cardSkeleton : undefined} className={quiet && !props.waited ? `${styles.page} ${styles.returning}` : styles.page}");
    // Read hydration-safely: the server never knows about a return and renders the placeholder.
    expect(await read("src/components/card-client.tsx")).toContain("const pendingReturn = useSyncExternalStore(never, () => peekJoined(), () => false);");
    // The fade is on the shell's own boxes (.lead is display: contents on a phone and paints nothing itself).
    const css = await read("src/components/customer/customer-card.module.css");
    expect(css).toContain(".returning > :is(header, main, footer) { animation: return-in var(--dur-ui) var(--ease-out) backwards; }");
    expect(css).not.toMatch(/\.lead\[data-return\][^{]*\{ animation: return-in/);
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.returning > :is\(header, main, footer\), \.late > footer \{ animation: none; \} \}/);
  });
  it("on a return whose read is slow the placeholder comes in after 300 ms and the content takes its place under it", async () => {
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { createElement } = await import("react");
    const { CustomerCard, CustomerCardLoading } = await import("./customer-card");
    const { RETURN_WAIT_MS } = await import("../card-client");
    expect(RETURN_WAIT_MS).toBe(300);
    const source = (await import("node:fs")).readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain("useEffect(() => { if (!(pendingReturn && loading)) return; const timer = setTimeout(() => setWaited(true), RETURN_WAIT_MS); return () => clearTimeout(timer); }, [pendingReturn, loading]);");
    expect(source).toContain('pendingReturn && !waited ? <CustomerCardReturning label="Deine Karte wird geladen." /> : <CustomerCardLoading label="Deine Karte wird geladen." late={pendingReturn} />');
    // The late placeholder is marked (its footer fades in; header and main fade by the loading rules they have); an ordinary load's is not.
    expect(renderToStaticMarkup(createElement(CustomerCardLoading, { label: "x", late: true }))).toMatch(/class="[^"]*late[^"]*"/);
    expect(renderToStaticMarkup(createElement(CustomerCardLoading, { label: "x" }))).not.toMatch(/class="[^"]*late[^"]*"/);
    // After a wait the content comes under the placeholder's cover (Skeleton to content), with no fade of its own; the card still does not arrive.
    const waited = renderToStaticMarkup(createElement(CustomerCard, { ...card, quiet: true, waited: true }));
    const direct = renderToStaticMarkup(createElement(CustomerCard, { ...card, quiet: true }));
    expect(waited).not.toMatch(/class="[^"]*returning[^"]*"/);
    expect(direct).toMatch(/class="[^"]*returning[^"]*"/);
    expect(waited).toContain('data-return="true"');
    expect(waited.length).toBeGreaterThan(direct.length); // the cover's placeholder is in the markup
  });
});

describe("closing the card", () => {
  // At 320 px the confirmation grew past the column: a start-aligned grid item sizes to its content.
  it("lets the confirmation take the column's width; the toggle is a panel one row high (mix, ENG-255)", async () => {
    const css = (await import("node:fs")).readFileSync("src/components/customer/customer-card.module.css", "utf8");
    expect(css.match(/\.close\s*{([^}]*)}/)?.[1]).toMatch(/justify-items:\s*stretch/);
    expect(css.match(/\.closeToggle\s*{([^}]*)}/)?.[1]).toMatch(/min-height:\s*var\(--mix-row\)/);
    // The long confirm label must not set the panel's width: the track may shrink and the button wraps (block).
    expect(css.match(/\.closeConfirm\s*{([^}]*)}/)?.[1]).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  });
});

describe("the balance on the guest's card never clamps (ENG-273, Design 18 Nov)", () => {
  const html = (balance: number) => renderToStaticMarkup(h(CustomerCard, { ...base, balance, rewards: [{ id: "r1", title: "Kaffee", cost: 8 }] }));
  // The mix card's count block: <b><span>N</span></b><span>von G | Stempel</span> (the figure rolls in its own span).
  const line = (balance: number) => { const m = html(balance).match(/class="_n_[^"]*"><b data-figure=""><span[^>]*>(\d+)<\/span><\/b><span>(.*?)<\/span>/); return m && `${m[1]} ${m[2]}`; };
  it("reads „N von G“ up to the goal and the true count with its unit above it", () => {
    expect(line(5)).toBe("5 von 8");
    expect(line(8)).toBe("8 von 8");
    expect(line(9)).toBe("9 Stempel");
  });
  it("earns every stamp above the goal and tells a screen reader the same number", () => {
    expect((html(9).match(/data-on="true"/g) ?? []).length).toBe(8);
    expect(html(9)).toContain('aria-label="9 Stempel"');
    expect(html(9)).not.toContain("von 8 Stempeln");
    expect(html(5)).toContain('aria-label="5 von 8 Stempeln"');
  });
});

describe("several rewards: the card draws the next one not reached (Design, #285 ruling b, ENG-270)", () => {
  const rewards = [{ id: "big", title: "Gratiskaffee", cost: 8 }, { id: "small", title: "Kleiner Kaffee", cost: 3 }];
  it("is the cheapest reward not reached yet, or the largest once all are reached", () => {
    expect(cardGoal(rewards, 2)?.id).toBe("small");
    expect(cardGoal(rewards, 3)?.id).toBe("big");
    expect(cardGoal(rewards, 4)?.id).toBe("big");
    expect(cardGoal(rewards, 9)?.id).toBe("big");
    expect(cardGoal([], 4)).toBeUndefined();
  });
  it("draws 8 slots at 4 with the ready 3-stamp reward still named first, and the true count over every goal", () => {
    const at = (balance: number) => renderToStaticMarkup(h(CustomerCard, { ...base, balance, rewards }));
    expect(at(4)).toContain('aria-label="4 von 8 Stempeln"');
    expect(at(4)).toContain("Kleiner Kaffee"); // the goal line says the ready reward
    expect(at(2)).toContain('aria-label="2 von 3 Stempeln"');
    expect(at(9)).toContain('aria-label="9 Stempel"');
  });
});
