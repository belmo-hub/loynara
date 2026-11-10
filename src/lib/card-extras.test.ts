import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { cardNewsProblem, challengeSentence, EXCLUDED_GOODS, HEAD_START_COPY, HEAD_START_DRAFT, headStartFloor, reviewUrlValid, signUpRules } from "./card-extras";

describe("sign-up rules (join page and the back of the Apple pass)", () => {
  it("lists the rules, the points expiry, then the exclusions once on German pages", () => {
    const expiry = "Punkte verfallen 24 Monate nach dem Sammeln, die ältesten zuerst.";
    expect(signUpRules({ rulesText: "Ein Stempel pro Besuch.", pointsExpiryRule: expiry, locale: "de" })).toEqual(["Ein Stempel pro Besuch.", expiry, EXCLUDED_GOODS]);
    expect(signUpRules({ rulesText: "Ein Stempel pro Besuch." })).toEqual(["Ein Stempel pro Besuch.", EXCLUDED_GOODS]);
    expect(signUpRules({ rulesText: "Un tampon par visite.", locale: "fr" })).toEqual(["Un tampon par visite."]);
  });
});

describe("review link", () => {
  it("accepts https links on the three Google review hosts", () => {
    for (const url of ["https://g.page/r/CdEf123/review", "https://www.google.com/maps/place/Synthetic+Caf%C3%A9", "https://google.com/maps?cid=123", "https://search.google.com/local/writereview?placeid=ChIJ123"]) expect(reviewUrlValid(url), url).toBe(true);
  });
  it("refuses everything else", () => {
    for (const url of ["http://g.page/r/x/review", "https://g.page.example.test/r/x", "https://evil.test/?u=https://g.page", "https://www.google.com/search?q=x", "https://www.google.com/mapsx", "https://search.google.com/local/reviews", "https://user:pw@g.page/r/x", "https://g.page:8443/r/x", "javascript:alert(1)", "g.page/r/x", "", `https://g.page/${"a".repeat(500)}`]) expect(reviewUrlValid(url), url).toBe(false);
  });
});

describe("card news", () => {
  it("accepts empty and short plain text up to 140 characters", () => {
    expect(cardNewsProblem("")).toBeNull();
    expect(cardNewsProblem("Ab Montag neue Öffnungszeiten: 8 bis 18 Uhr. <3 & Danke!")).toBeNull();
    expect(cardNewsProblem("ü".repeat(140))).toBeNull();
  });
  it("refuses more than 140 characters", () => {
    expect(cardNewsProblem("a".repeat(141))).toBe("TOO_LONG");
  });
  it("refuses links and web addresses", () => {
    for (const text of ["Mehr auf https://example.test", "www.beispiel", "Besuch beispiel.de", "javascript://x", "Shop: laden.com/angebot"]) expect(cardNewsProblem(text), text).toBe("LINK");
  });
  it("refuses line breaks and control characters", () => {
    expect(cardNewsProblem("Zeile\nzwei")).toBe("CONTROL");
  });
});

describe("challengeSentence in the card's language", () => {
  it("keeps the German sentence and writes French on a French card", () => {
    expect(challengeSentence(3, 50, "points", "Oktober", "31.10.2026").text).toBe("Komm 3-mal im Oktober, dann gibt's 50 Punkte extra.");
    const fr = challengeSentence(3, 20, "points", "octobre", "31/10/2026", "fr");
    expect(fr.text).toBe("Venez 3 fois en octobre et recevez 20 points supplémentaires.");
    expect(fr.conditions).toBe("Seules les visites confirmées en caisse comptent, une par jour au maximum. Valable jusqu’au 31/10/2026. Hors tabac, presse, livres, loterie et recharges téléphoniques.");
    expect(challengeSentence(3, 1, "stamp", "octobre", "31/10/2026", "fr").text).toBe("Venez 3 fois en octobre et recevez 1 tampon supplémentaire.");
  });
  it("says a one-point bonus in the singular, in German and French (ENG-104)", () => {
    expect(challengeSentence(3, 1, "points", "Oktober", "31.10.2026").text).toBe("Komm 3-mal im Oktober, dann gibt's 1 Punkt extra.");
    expect(challengeSentence(3, 2, "points", "Oktober", "31.10.2026").text).toBe("Komm 3-mal im Oktober, dann gibt's 2 Punkte extra.");
    expect(challengeSentence(3, 1, "points", "octobre", "31/10/2026", "fr").text).toBe("Venez 3 fois en octobre et recevez 1 point supplémentaire.");
    expect(challengeSentence(3, 2, "points", "octobre", "31/10/2026", "fr").text).toBe("Venez 3 fois en octobre et recevez 2 points supplémentaires.");
    expect(challengeSentence(3, 1, "stamp", "Oktober", "31.10.2026").text).toBe("Komm 3-mal im Oktober, dann gibt's 1 Stempel extra.");
    expect(challengeSentence(3, 2, "stamp", "octobre", "31/10/2026", "fr").text).toBe("Venez 3 fois en octobre et recevez 2 tampons supplémentaires.");
  });
});

describe("the Startbonus on the owner's pages (ENG-207, Design's review of 10 Nov)", () => {
  const read = (path: string) => readFileSync(path, "utf8");
  it("offers no reward cost under four times the Startbonus at sign-up, and says why", () => {
    expect(headStartFloor({ programType: "stamp" })).toEqual({ least: 1, reason: "" });
    expect(headStartFloor({ programType: "stamp", headStart: 0 })).toEqual({ least: 1, reason: "" });
    expect(headStartFloor({ programType: "stamp", headStart: 2 })).toEqual({ least: 8, reason: HEAD_START_DRAFT.rewardTooSmall("2 Stempel", "8 Stempel") });
    expect(headStartFloor({ programType: "points", headStart: 25 }).least).toBe(100);
    expect(headStartFloor({ programType: "points", headStart: 25 }).reason).toContain("mindestens 100 Punkte");
    // Both reward pages use it: the choices below the floor are disabled, the stepper stops at it, a typed number below names it.
    const edit = read("src/components/owner/program-reward.tsx"), create = read("src/components/owner/program-new-reward.tsx");
    expect(edit).toContain("disabled: n < floor.least })),");
    expect(edit).toContain("{options.some(n => n < floor.least) && <p className=\"ow-hint\">{floor.reason}</p>}");
    expect(edit).toContain("const costProblem = !(cost >= 1 && cost <= COST_MAX) ? WHOLE_NUMBER : cost < floor.least ? floor.reason : \"\";");
    expect(edit).toContain("min={floor.least} max={COST_MAX}");
    expect(create).toContain("min={floor.least} max={COST_MAX}");
    expect(create).toContain("step === 2 && amount !== null && amount < floor.least ? floor.reason : \"\";");
  });
  it("names the quarter only when the quarter is what binds, and puts Marketing's line under the save button", () => {
    const page = read("src/components/owner/program-extras.tsx");
    expect(page).toContain("(signUpMax === quarter ? HEAD_START_COPY.overCap : HEAD_START_DRAFT.overMost)(withUnit(signUpMax, kind))");
    expect(HEAD_START_DRAFT.overMost("2 Stempel")).toBe("Bei der Anmeldung sind höchstens 2 Stempel möglich.");
    expect(HEAD_START_COPY.fromNow).toBe("Änderungen gelten ab jetzt. Gebuchte Startboni bleiben.");
    expect(page).toContain('<QuestionForm title="Startbonus"');
    expect(page).toContain("note={HEAD_START_COPY.fromNow}");
    expect(read("src/components/owner/question-form.tsx")).toContain('{note && <p className="ow-hint ow-qsave-note">{note}</p>}</div>}');
    // The points' question is visible, no icon repeats on the amount rows, and a changed cost sentence is a new line that fades in.
    expect(page).toContain('<label htmlFor="welcome-bonus">{HEAD_START_DRAFT.howMuch}</label>');
    expect(page).toContain("options={[1, 2, 3].map(n => ({ value: String(n), label: `+${n} Stempel`, disabled: n > max }))} />");
    expect(page).toContain('<p key={amount} className="ow-qcost">');
    const css = read("src/components/owner/owner.css");
    expect(css).toMatch(/\.ow-qcost \{[^}]*animation: ow-fade var\(--dur-ui\) var\(--ease-out\); \}\n@media \(prefers-reduced-motion: reduce\) \{ \.ow-qcost \{ animation: none; \} \}/);
  });
});
