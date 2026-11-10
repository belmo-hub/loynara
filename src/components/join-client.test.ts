import { describe, expect, it } from "vitest";
import type { PublicProgram } from "./client-api";
import { firstTapWait, joinConsent, joinNeedsTick, joinOffersMessages, staleJoin, staleLine } from "./join-client";

describe("a join refused because the shop changed the programme (ENG-100 W58)", () => {
  const shown = { programName: "Alt" } as PublicProgram, fresh = { programName: "Neu" } as PublicProgram;
  it("reloads the rules, clears the consent, marks the rules and says why", () => {
    expect(staleJoin(shown, fresh, "Das Geschäft hat das Programm gerade geändert.")).toEqual({ program: fresh, acceptedTerms: false, stale: true, error: "Das Geschäft hat das Programm gerade geändert." });
  });
  it("keeps the rules shown when the reload fails, and still asks again", () => {
    expect(staleJoin(shown, null, "x")).toMatchObject({ program: shown, acceptedTerms: false, stale: true });
  });
});

describe("the join page applies the whole transition", () => {
  it("sets consent, rules, mark and error from staleJoin on STALE_RULE", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/components/join-client.tsx", "utf8");
    const branch = source.slice(source.indexOf('cause.code === "STALE_RULE"'), source.indexOf('cause.code === "INVALID_REFERRAL"'));
    expect(branch).toContain("staleJoin(");
    for (const set of ["setProgram(next.program)", "setAcceptedTerms(next.acceptedTerms)", "setStale(next.stale)", "setError(next.error)"]) expect(branch).toContain(set);
  });
});

describe("the join page's ticks (ENG-173, Legal 6 Nov)", () => {
  const source = async () => (await import("node:fs")).readFileSync("src/components/join-client.tsx", "utf8");
  it("German pages join without a tick; French pages keep today's checkbox", async () => {
    expect(joinNeedsTick("de", false)).toBe(false);
    expect(joinNeedsTick("fr", false)).toBe(true);
    expect(joinNeedsTick("fr", true)).toBe(false);
    expect(await source()).toContain('{locale === "fr" && <Checkbox id="join-consent"');
  });
  it("offers the message box only on an iPhone with Apple Wallet, for a German shop, while the surface is on and the programme open", () => {
    const on = { appleWallet: true, walletMessages: true };
    expect(joinOffersMessages(true, on)).toBe(true);
    expect(joinOffersMessages(true, { ...on, active: true })).toBe(true);
    expect(joinOffersMessages(true, { ...on, walletMessages: false })).toBe(false);
    expect(joinOffersMessages(true, { ...on, appleWallet: false })).toBe(false);
    expect(joinOffersMessages(true, { ...on, locale: "fr" })).toBe(false);
    expect(joinOffersMessages(true, { ...on, active: false })).toBe(false);
    expect(joinOffersMessages(false, on)).toBe(false);
  });
  it("uses the iPhone check, not the platform that counts touch iPads as iOS, and marks the card as asked", async () => {
    const page = await source();
    expect(page).toContain("const onIphone = useSyncExternalStore(noSubscription, iphoneDevice, serverIphone);");
    expect(page.match(/joinOffersMessages\(onIphone, program\)/g)).toHaveLength(3);
    expect(page).toContain("if (program && joinOffersMessages(onIphone, program)) markJoinAsked(result.cardToken);");
  });
  it("puts the required confirm tick before the optional box, and ties the button to the notice", async () => {
    const page = await source();
    expect(page.indexOf('<Checkbox id="join-confirm"')).toBeLessThan(page.indexOf("<div className={styles.messages}>"));
    expect(page).toContain('aria-describedby={notice ? "join-notice" : undefined}');
    expect(page).toContain('<p id="join-notice" className={styles.notice}>');
  });
  it("keeps a German stale line with the rules: under them, outside the block, both scrolled into view", async () => {
    const page = await source();
    expect(page).toContain('if (locale !== "fr") { setErrorSpot("rules"); document.getElementById("join-rules")?.scrollIntoView({ block: "start" }); }');
    expect(page).toContain('})()}</div>\n      {errorLine("rules")}');
    expect((await import("node:fs")).readFileSync("src/components/customer/join.module.css", "utf8")).toMatch(/\.rules \{[^}]*scroll-margin-top/);
  });
  it("puts the additional-card error under its tick, focuses that tick and ties them together", async () => {
    const page = await source();
    expect(page).toContain('setError(t.anotherConfirmError); setErrorSpot("confirm"); document.getElementById("join-confirm")?.focus(); return;');
    expect(page).toContain('aria-invalid={errorSpot === "confirm" && error ? true : undefined} aria-describedby={errorSpot === "confirm" && error ? "join-error" : undefined}');
    expect(page.indexOf('{errorLine("confirm")}')).toBeLessThan(page.indexOf("<div className={styles.messages}>"));
    expect(page.indexOf("{t.anotherConfirm}</Checkbox>")).toBeLessThan(page.indexOf('{errorLine("confirm")}'));
  });
  it("hides the notice on a closed programme, where nothing can be accepted, and every new tap starts in the form", async () => {
    const page = await source();
    expect(page).toContain('const notice = locale !== "fr" && program.active !== false;');
    expect(page).toContain('{notice && !program.demo && <p id="join-notice"');
    // Demo environment (Legal, 9 Nov): the same place, the demo line instead of the terms acceptance.
    expect(page).toContain('{notice && program.demo && <p id="join-notice"');
    expect(page).toContain('aria-describedby={notice ? "join-notice" : undefined}');
    expect(page).toContain('setError(""); setErrorSpot("form");');
  });
  it("sends the version only for a shown, ticked box, and the box starts unticked", async () => {
    expect(joinConsent(true, true)).toEqual({ walletConsentVersion: "wallet-consent-join-2026-11-06-v1" });
    expect(joinConsent(true, false)).toEqual({});
    expect(joinConsent(false, true)).toEqual({});
    const page = await source();
    expect(page).toContain("const [messagesTicked, setMessagesTicked] = useState(false);");
    expect(page).toContain("...joinConsent(program !== null && joinOffersMessages(onIphone, program), messagesTicked, program?.demo?.consentVersion)");
  });
  it("names the button after a stale join on German pages; French pages keep their line", async () => {
    expect(staleLine("de", "Meine Karte erstellen")).toBe("Das Geschäft hat das Programm gerade geändert. Bitte lies die Regeln oben noch einmal. Mit „Meine Karte erstellen“ akzeptierst du sie. Deine Karte ist noch nicht erstellt.");
    expect(staleLine("de", "Weitere Karte erstellen")).toContain("Mit „Weitere Karte erstellen“ akzeptierst du sie.");
    expect(staleLine("fr", "Créer ma carte")).toBe("Le commerce vient de modifier le programme. Veuillez relire les règles ci-dessus et les accepter. Votre carte n’a pas encore été créée.");
    expect(await source()).toContain("staleLine(locale, existing ? t.anotherSubmit : t.submit)");
  });
  it("says in its own words why a tick was refused, and keeps the page", async () => {
    const page = await source();
    expect(page).toContain('cause.code === "CONSENT_TEXT_CHANGED") {\n        setError(CONSENT_CHANGED);');
    expect(page).toContain("Der Text zum Häkchen hat sich geändert. Bitte lade die Seite neu und lies ihn. Das Häkchen ist freiwillig; deine Karte bekommst du auch ohne.");
  });
  it("puts rules, message box, notice and button in that order, with Legal's notice", async () => {
    const page = await source();
    const order = ["<h3>{t.rules}</h3>", "<div className={styles.messages}>", '{notice && !program.demo && <p id="join-notice" className={styles.notice}>', '<Button type="submit"'].map(mark => page.indexOf(mark));
    expect(order.every(at => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).toContain('Mit „{existing ? t.anotherSubmit : t.submit}“ akzeptierst du die Programmregeln oben und die <Link href="/teilnahmebedingungen" target="_blank">Teilnahmebedingungen</Link>. Mehr in den <Link href="/datenschutz" target="_blank">Datenschutzhinweisen</Link>.');
    expect(page).toContain("`Darf dir ${program.businessName} Nachrichten auf deine Karte schicken?`");
  });
});

describe("the first page behind FIRST_TAP_HOOK_ENABLED (ENG-205)", () => {
  const read = async (path: string) => (await import("node:fs")).readFileSync(path, "utf8");
  it("lets the created card settle for --dur-reward, and not at all under reduced motion", async () => {
    expect(firstTapWait(true)).toBe(0);
    expect((await read("src/styles/tokens.css")).match(/--dur-reward: (\d+)ms/)?.[1]).toBe(String(firstTapWait(false)));
    expect(await read("src/components/customer/join.module.css")).toMatch(/prefers-reduced-motion: reduce\) \{ [^}]*\.hero\[data-built\][^}]*animation: none/);
  });
  it("draws the build only after the server has created the card, and only with the flag's field", async () => {
    const source = await read("src/components/join-client.tsx");
    const built = source.indexOf("setBuilt(true)");
    expect(built).toBeGreaterThan(source.indexOf('postJson<{ cardToken: string }>("/api/enroll"'));
    expect(built).toBeGreaterThan(source.indexOf("if (!result) return;"));
    expect(source.slice(source.lastIndexOf("if (program?.firstTap) {"), built)).not.toContain("\n      }");
    expect(source.match(/setBuilt\(/g)).toHaveLength(1);
  });
  it("keeps Legal's order of 6 Nov with the field too: only the shop's mark and the build are new", async () => {
    const source = await read("src/components/join-client.tsx");
    expect(source).toContain("{program.firstTap ? <div className={styles.brand}>");
    expect(source.match(/program\??\.firstTap/g)).toHaveLength(2);
  });
});
