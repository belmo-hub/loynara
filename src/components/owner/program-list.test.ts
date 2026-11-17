import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { isQuestion } from "./program-helpers";
import { ProgramExample, programSections, quoteStart, rewardChip, type ListData } from "./program-list";
import { ruleChips } from "./program-rule-changes";

const me = { role: "owner", programSlug: "cafe", programType: "stamp", welcomeBonus: 0, cardNews: "", reviewUrl: null, challengeVisits: null, levelsEnabled: false, averageVisitSpendMinor: null } as unknown as MeResponse;
const program = {
  programType: "stamp", earningMode: "manual", currency: "EUR", rulesText: "Ein Stempel pro Heißgetränk. Zehn Stempel ergeben einen Gratiskaffee.",
  rewards: [{ id: "v1", rewardId: "r1", title: "Gratiskaffee", cost: 10, sortOrder: 0 }, { id: "v2", rewardId: "r2", title: "Keks", cost: 1, sortOrder: 1 }],
  referral: { enabled: false, referrerBonus: 0, referredBonus: 0 },
} as unknown as PublicProgram;
const base: ListData = { me, program, winback: null, referrals: [], nfc: false, logo: true };
const rows = (data: Partial<ListData>) => Object.fromEntries(programSections({ ...base, ...data }).flatMap(section => section.rows).map(row => [row.title, row]));

describe("Programm list", () => {
  it("has the sections in Design's order, a row per reward with its threshold, and „Prämie hinzufügen“ last", () => {
    const sections = programSections(base);
    expect(sections.map(section => section.title)).toEqual(["Prämien", "So sammeln Kunden", "Extras", "Infos auf der Karte", "Für die Ergebnisse"]); // „Aussehen“ is the card example (mix A)
    expect(sections[0].rows.map(row => [row.title, row.sub ?? "", row.href])).toEqual([
      ["Gratiskaffee", "Einlösbar ab 10 Stempeln", "/merchant/program/rewards/r1"], ["Keks", "Einlösbar ab 1 Stempel", "/merchant/program/rewards/r2"], ["Reihenfolge ändern", "", "/merchant/program/rewards/order"], ["Prämie hinzufügen", "", "/merchant/program/rewards/new"],
    ]);
    expect(sections[0].rows.every(row => !row.value)).toBe(true); // the sub-line already says the number
    expect(sections[2].note).toBe("Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.");
  });

  it("shows text values muted while a setting is off or empty, and never a value it could not read", () => {
    const all = rows({});
    for (const [title, value] of [["Startbonus", "Aus"], ["Monats-Challenge", "Aus"], ["Kundenlevel", "Aus"], ["Empfehlungen", "Aus"], ["Neuigkeit", "Keine"], ["Google-Bewertung", "Kein Link"], ["Durchschnittsbon", "Kein Betrag"]]) {
      expect([all[title].value, all[title].off], title).toEqual([value, true]);
    }
    expect(all["Regel auf der Karte"].sub).toBe("„Ein Stempel pro Heißgetränk. Zehn Stempel ergeben einen Gratiskaffee.“"); // whole, the row clamps it
    expect([all["Willkommen zurück"].sub, all["Willkommen zurück"].value]).toEqual([undefined, undefined]); // win-back read failed or pending
    expect(Object.keys(all)).not.toContain("Punkte verfallen");
    expect(Object.keys(all)).not.toContain("Happy Hour"); // points shops only
    expect(Object.keys(all)).not.toContain("NFC-Tap");
  });

  it("leads „Infos auf der Karte“ with the card page's row (mix A)", () => {
    expect(programSections(base).find(section => section.title === "Infos auf der Karte")!.rows.map(row => row.title)).toEqual(["Kundenkarte", "Neuigkeit", "Google-Bewertung"]);
  });

  it("names the card page's names and promises the logo only where the logo upload is offered (W38)", () => {
    expect([rows({}).Kundenkarte.sub, rows({ logo: false }).Kundenkarte.sub]).toEqual(["Namen, Logo und Farbe", "Namen und Farbe"]);
  });

  it("shows numbers big and set texts as sub-lines", () => {
    const all = rows({
      me: { ...me, welcomeBonus: 2, challengeVisits: 4, challengeBonus: 1, levelsEnabled: true, cardNews: "Ab Montag  neue Öffnungszeiten.", reviewUrl: "https://g.page/r/abc/review", averageVisitSpendMinor: 1250 },
      program: { ...program, referral: { enabled: true, referrerBonus: 2, referredBonus: 1 } },
      winback: { enabled: true, days: 30, bonus: 1, bonusMax: 1, type: "stamp", almost: false },
    });
    expect([all.Startbonus.value, all.Startbonus.big]).toEqual(["+2", true]);
    expect([all["Willkommen zurück"].sub, all["Willkommen zurück"].value]).toEqual(["Nach 30 Tagen ohne Buchung", "+1"]);
    expect([all["Monats-Challenge"].value, all.Kundenlevel.value, all.Kundenlevel.off]).toEqual(["+1", "An", undefined]);
    expect([all.Empfehlungen.value, all.Empfehlungen.pair]).toEqual(["+2 · +1", true]); // two bonuses a step smaller
    expect([all.Neuigkeit.sub, all.Neuigkeit.value]).toEqual(["„Ab Montag neue Öffnungszeiten.“", undefined]);
    expect(all["Google-Bewertung"].sub).toBe("g.page");
    expect(all.Durchschnittsbon.value).toMatch(/^12,50\s€$/);
    expect(rows({ program: { ...program, referral: { enabled: true, referrerBonus: 2, referredBonus: 2 } } }).Empfehlungen.value).toBe("+2");
  });

  it("puts the count of referrals waiting for review in place of the bonus", () => {
    const referrals = [{ status: "review" }, { status: "qualified" }, { status: "review" }, { status: "pending" }, { status: "review" }, { status: "rejected" }];
    const row = rows({ referrals, program: { ...program, referral: { enabled: true, referrerBonus: 2, referredBonus: 1 } } }).Empfehlungen;
    expect([row.sub, row.value, row.big]).toEqual(["Braucht deine Prüfung", "3", true]);
    expect(rows({ referrals: [{ status: "qualified" }] }).Empfehlungen.sub).toBe("Bonus für die empfehlende und neue Karte");
  });

  it("gives points shops their units, the expiry and Happy Hour rows, and no average once the till has amounts", () => {
    const points = { ...program, programType: "points", earningMode: "purchase", rewards: [{ ...program.rewards[0], cost: 1000 }] } as PublicProgram;
    const sections = programSections({ ...base, nfc: true, program: points, me: { ...me, programType: "points", tapMode: "staff_confirmed", happyHourEnabled: true } });
    const all = Object.fromEntries(sections.flatMap(section => section.rows).map(row => [row.title, row]));
    expect(all.Gratiskaffee.sub).toBe("Einlösbar ab 1.000 Punkten");
    expect([all["Punkte verfallen"].value, all["NFC-Tap"].sub, all["Happy Hour"].value]).toEqual(["Nie", "Mit Bestätigung", "An"]);
    expect(sections[1].rows.map(row => row.title)).toEqual(["So entstehen Punkte", "Weitere Regeln", "Punkte verfallen", "NFC-Tap"]); // the earning, then what adds to it
    expect(programSections({ ...base, program: { ...points, earningMode: "manual" } })[1].rows.map(row => row.title)).toEqual(["Regel auf der Karte", "So entstehen Punkte", "Punkte verfallen"]);
    expect(Object.fromEntries(programSections({ ...base, program: { ...points, earningMode: "manual" }, me: { ...me, programType: "points", happyHourEnabled: true } }).flatMap(section => section.rows).map(row => [row.title, row]))["Happy Hour"]).toMatchObject({ value: "Aus", sub: "Nur bei Punkten nach Einkaufswert" });
    expect(rows({ program: { ...points, pointsPerCurrencyUnit: 1 } })["So entstehen Punkte"].sub).toBe("Nach Einkaufswert: 1 Punkt pro €"); // W36
    expect(rows({ program: { ...points, pointsPerCurrencyUnit: 2, currency: "MAD" } })["So entstehen Punkte"].sub).toBe("Nach Einkaufswert: 2 Punkte pro MAD");
    expect(rows({ program: { ...points, earningMode: "manual" } })["So entstehen Punkte"].sub).toBe("Manuell");
    expect(Object.keys(rows({}))).not.toContain("So entstehen Punkte"); // stamps: the type is set in setup only
    expect(sections.map(section => section.title)).not.toContain("Für die Ergebnisse");
    expect(rows({ program: points, me: { ...me, pointsExpiryMonths: 24 } })["Punkte verfallen"].sub).toBe("Nach 24 Monaten");
  });

  it("names the rule row „Weitere Regeln“ where the card states the earning by purchase amount (W51)", () => {
    const points = { ...program, programType: "points", earningMode: "purchase", rulesText: "1 Punkt pro 1 € Einkaufswert, abgerundet auf ganze Punkte." } as PublicProgram;
    const extras = (ownerRulesText: string) => rows({ program: { ...points, ownerRulesText } })["Weitere Regeln"];
    expect([extras("").value, extras("").off, extras("").sub, extras("").href]).toEqual(["Keine", true, undefined, "/merchant/program/rule"]);
    expect([extras("Karte vor dem Bezahlen zeigen.").sub, extras("Karte vor dem Bezahlen zeigen.").value]).toEqual(["„Karte vor dem Bezahlen zeigen.“", undefined]);
    expect(rows({ program: { ...points, earningMode: "manual", ownerRulesText: "10 Punkte pro Pizza." } })["Regel auf der Karte"].sub).toBe("„10 Punkte pro Pizza.“");
  });

  it("links every row to its own page", () => {
    const hrefs = programSections({ ...base, nfc: true, program: { ...program, programType: "points" } as PublicProgram }).flatMap(section => section.rows.map(row => row.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(isQuestion(href.slice("/merchant/program/".length)) || /^\/merchant\/(program\/(card|rewards\/\w+)|referrals)$/.test(href), href).toBe(true);
  });

  it("quotes the start of a text in whole words", () => {
    expect(quoteStart("Kurz.")).toBe("„Kurz.“");
    expect(quoteStart("Einwortohneleerzeichendasvielzulangistfürdiezeileundmehr", 10)).toBe("„Einwortohn …“");
  });
});

describe("a reward row's chip while a change waits (ENG-100, W29, W59)", () => {
  const coffee = { id: "v1", rewardId: "r1", title: "Gratiskaffee", cost: 10, sortOrder: 0 };
  it.each([
    [{}, undefined],
    [{ endsOn: "2026-11-24" }, "Ab 24.11. archiviert"],
    [{ pending: { effectiveOn: "2026-11-24", title: "Gratiskaffee", cost: 12 } }, "Ab 24.11.: 12 Stempel"],
    [{ pending: { effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 10 } }, "Ab 24.11.: neuer Name"],
    [{ pending: { effectiveOn: "2026-11-24", title: "Gratiskaffee 0,2 l", cost: 12 } }, "Ab 24.11.: 12 Stempel"],
  ])("%o → %s", (change, chip) => expect(rewardChip("stamp", { ...coffee, ...change })).toBe(chip));

  it("puts the chip on the reward's row", () => {
    const pending = { ...program, rewards: [{ ...program.rewards[0], pending: { effectiveOn: "2026-11-24", title: "Gratiskaffee", cost: 12 } }] } as PublicProgram;
    expect(rows({ program: pending }).Gratiskaffee).toMatchObject({ sub: "Einlösbar ab 10 Stempeln", pending: "Ab 24.11.: 12 Stempel" });
  });
});

describe("rule, earning and expiry chips while a change waits (ENG-100, W45, W59)", () => {
  const points = { ...program, programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2, ownerRulesText: "" } as PublicProgram;
  const old: { earningMode: "manual" | "purchase"; pointsPerCurrencyUnit: number; rulesText: string } = { earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" };
  const waiting = (change: Partial<typeof old>) => ({ ...points, pending: { effectiveOn: "2026-11-24", ...old, ...change, old } }) as PublicProgram;
  it.each([
    [{ pointsPerCurrencyUnit: 1 }, { earning: "Ab 24.11.: 1 Punkt pro €" }],
    [{ earningMode: "manual" as const, rulesText: "10 Punkte pro Pizza." }, { earning: "Ab 24.11.: Manuell" }],
    [{ rulesText: "Nicht auf Getränke." }, { rule: "Ab 24.11.: neue Regel" }],
  ])("%o", (change, chips) => expect(ruleChips(waiting(change))).toEqual({ earning: undefined, rule: undefined, expiry: undefined, ...chips }));

  it("keeps the expiry in force on its row and shows the waiting one as a chip", () => {
    const data = { me: { ...me, programType: "points", pointsExpiryMonths: 24 } as MeResponse, program: { ...points, pendingExpiry: { effectiveOn: "2026-11-24", months: 24, before: 36 } } as PublicProgram };
    expect(rows(data)["Punkte verfallen"]).toMatchObject({ sub: "Nach 36 Monaten", pending: "Ab 24.11.: nach 24 Monaten" });
    expect(rows({ ...data, program: { ...points, pendingExpiry: { effectiveOn: "2026-11-24", months: 24, before: null } } as PublicProgram })["Punkte verfallen"]).toMatchObject({ value: "Nie", pending: "Ab 24.11.: nach 24 Monaten" });
  });
});

describe("archived rewards (Design, ENG-100 U1)", () => {
  it("adds a quiet row with the count at the end of Prämien, only once a reward is archived", () => {
    expect(programSections(base)[0].rows.map(row => row.title)).not.toContain("Archivierte Prämien");
    const rows = programSections({ ...base, archived: 2 })[0].rows;
    expect(rows.at(-1)).toMatchObject({ title: "Archivierte Prämien", value: "2", off: true, href: "/merchant/program/rewards/archived" });
  });
});

describe("Wallet-message settings on Programm (ENG-180)", () => {
  it("lists Geburtstags-Bonus and Erinnerung vor der Prämie after Willkommen zurück, only where messages are offered", () => {
    expect(Object.keys(rows({}))).not.toContain("Geburtstags-Bonus");
    const winback = { enabled: false, days: 30, bonus: 1, bonusMax: 1, type: "stamp", almost: true } as const;
    const extras = programSections({ ...base, messages: true, winback, me: { ...me, birthdayEnabled: false } }).find(section => section.title === "Extras")!.rows;
    expect(extras.slice(1, 4).map(row => [row.title, row.sub, row.value, row.href])).toEqual([
      ["Willkommen zurück", "Nach 30 Tagen ohne Buchung", "Aus", "/merchant/program/winback"],
      ["Geburtstags-Bonus", "In der Geburtstagswoche", "Aus", "/merchant/program/birthday"],
      ["Erinnerung vor der Prämie", "Wenn nur noch wenig fehlt", "An", "/merchant/program/almost"],
    ]);
    expect(isQuestion("birthday") && isQuestion("almost")).toBe(true);
  });
});

describe("the example card under „Aussehen“ (mix A)", () => {
  const shop = { businessName: "Demo Kaffeebar Kassel", locationName: "Kassel Mitte", brandColor: "#1F3A5F" };
  const render = (type: "stamp" | "points", cost: number) => renderToStaticMarkup(createElement(ProgramExample, { me: shop, type, reward: { id: "r1", title: "Gratiskaffee", cost } }));
  it("draws the mix card with its two fields for stamps", () => {
    const html = render("stamp", 8);
    expect(html).toContain("Einlösbar ab");
    expect(html).not.toContain("ow-cardprev");
  });
  it("keeps points on the house example until a points mix card is drawn (Design, 18 Nov)", () => {
    const html = render("points", 250);
    expect(html).toContain("ow-cardprev");
    expect(html).not.toContain("Einlösbar ab");
  });
});
