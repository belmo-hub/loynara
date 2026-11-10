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
    expect(out).toContain('<a href="https://g.page/r/Synthetic123/review" target="_blank" rel="noopener noreferrer">Auf Google bewerten</a>');
  });
  it("is absent without a link", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("bewerten");
  });
});

describe("progress (Impeccable K1, K3)", () => {
  const count = (out: string, text: string) => out.split(text).length - 1;
  it("states the progress once, above the card, and names the reward", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, balance: 3 }));
    expect(count(out, "reward-remaining")).toBe(1);
    expect(out).toMatch(/<h1 class="reward-remaining[^"]*">Noch <span[^>]*>2<\/span> Stempel bis zu deiner Prämie: <span[^>]*>Kaffee<\/span><\/h1>/);
    expect(out.indexOf("reward-remaining")).toBeLessThan(out.indexOf("customer-card "));
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
    expect(out).toMatch(/customer-balance-line[^"]*"><span><svg[^]*?<\/svg>Kaffee<\/span><strong>1 von 5<\/strong>/);
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
    expect(card("de", 1, 1, "stamps")).toContain("<strong>1 von 5</strong>");
  });
  it("activity line, for a booking and a redemption, in German and French", () => {
    expect(card("de", 5, 1)).toContain('<b>+1 Punkt</b>');
    expect(card("de", 5, 2)).toContain('<b>+2 Punkte</b>');
    expect(card("de", 5, -1)).toContain('<b data-sign="minus">-1 Punkt</b>');
    expect(card("de", 5, -2)).toContain('<b data-sign="minus">-2 Punkte</b>');
    expect(card("fr", 5, 1)).toContain('<b>+1 point</b>');
    expect(card("fr", 5, 2)).toContain('<b>+2 points</b>');
    expect(card("fr", 5, -1)).toContain('<b data-sign="minus">-1 point</b>');
    expect(card("de", 5, 1, "stamps")).toContain('<b>+1 Stempel</b>');
  });
});

describe("counts on the card, French zero and French stamps included (ENG-108)", () => {
  const card = (locale: "de" | "fr", programType: "points" | "stamps", balance: number, extra: Partial<CustomerCardProps> = {}) =>
    renderToStaticMarkup(h(CustomerCard, { ...base, locale, programType, balance, ...extra }));
  it("balance line: French takes the singular for 0 and 1", () => {
    expect(card("fr", "points", 0)).toMatch(/>0<\/span> <em>point<\/em>/);
    expect(card("fr", "stamps", 2)).toContain("<strong>2 sur 5</strong>");
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
    expect(card("fr", "stamps", 5, activity(1))).toContain('<b>+1 tampon</b>');
    expect(card("fr", "stamps", 5, activity(2))).toContain('<b>+2 tampons</b>');
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
  it("puts the goal slot with the gift on the stamp grid", () => {
    expect(renderToStaticMarkup(h(CustomerCard, base))).toContain("data-reward=\"true\"");
  });
  it("offers Wallet, rules and recovery as „Deine Karte“ rows, and the legal links open beside the card", () => {
    const out = renderToStaticMarkup(h(CustomerCard, { ...base, rulesText: "Ein Stempel pro Kaffee.", onAppleWallet: () => {} }));
    const rows = out.slice(out.indexOf("customer-more-title"));
    for (const title of ["In Wallet speichern", "Programmregeln", "So findest du deine Karte wieder"]) expect(rows).toContain(`<strong>${title}</strong>`);
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
  it("names the shop in the header, as a paragraph under the goal heading, and on the card like a pass (mock 23)", () => {
    const out = renderToStaticMarkup(h(CustomerCard, base));
    expect(out).toMatch(/<p class="customer-header-merchant[^"]*">Synthetic Café<\/p>/);
    expect(out).toMatch(/customer-card-business[^"]*"><strong>Synthetic Café<\/strong><span>Kassel<\/span><\/p>/);
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
    expect(css).toContain(".lead[data-return] .object::before { animation: none; }");
    expect(css.indexOf(".lead[data-return] .object::before")).toBeGreaterThan(css.indexOf(".lead[data-arriving] .object::before"));
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
    expect(await read("src/components/customer/customer-card.tsx")).toContain("cover={arriving && !quiet ? cardSkeleton : undefined}");
    // Read hydration-safely: the server never knows about a return and renders the placeholder.
    expect(await read("src/components/card-client.tsx")).toContain("const pendingReturn = useSyncExternalStore(never, () => peekJoined(), () => false);");
    expect(await read("src/components/customer/customer-card.module.css")).toContain(".lead[data-return], .lead[data-return] ~ * { animation: return-in var(--dur-ui) var(--ease-out) backwards; }");
  });
});
