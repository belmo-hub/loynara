import { describe, expect, it } from "vitest";
import type { PublicProgram } from "./client-api";
import { FIRST_TAP_STEP_MS, firstCardHeight, firstPage, firstTapHold, joinConsent, joinNeedsTick, joinOffersMessages, staleJoin, staleLine } from "./join-client";

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
    expect(page).toContain("if (program && joinOffersMessages(onIphone, program)) markJoinAsked(result.cardLocator);");
  });
  it("puts the required confirm tick before the optional box, and ties the button to the notice", async () => {
    const page = await source();
    expect(page.indexOf('<Checkbox id="join-confirm"')).toBeLessThan(page.indexOf("{messagesBox}", page.indexOf("  return <CustomerShell brandColor={program.brandColor} locale={locale}")));
    expect(page).toContain('aria-describedby={notice ? "join-notice" : undefined}');
    expect(page).toContain('<p id="join-notice" className={styles.notice}>');
  });
  it("keeps a German stale line with the rules: under them, outside the block, both scrolled into view", async () => {
    const page = await source();
    expect(page).toContain('if (locale !== "fr") { setErrorSpot("rules"); document.getElementById("join-rules")?.scrollIntoView({ block: "start" }); }');
    expect(page).toContain('{rulesBlock}\n      {errorLine("rules")}');
    expect((await import("node:fs")).readFileSync("src/components/customer/join.module.css", "utf8")).toMatch(/\.rules \{[^}]*scroll-margin-top/);
  });
  it("puts the additional-card error under its tick, focuses that tick and ties them together", async () => {
    const page = await source();
    expect(page).toContain('setError(t.anotherConfirmError); setErrorSpot("confirm"); document.getElementById("join-confirm")?.focus(); return;');
    expect(page).toContain('aria-invalid={errorSpot === "confirm" && error ? true : undefined} aria-describedby={errorSpot === "confirm" && error ? "join-error" : undefined}');
    expect(page.indexOf('{errorLine("confirm")}')).toBeLessThan(page.indexOf("{messagesBox}", page.indexOf("  return <CustomerShell brandColor={program.brandColor} locale={locale}")));
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
    // Today's page is the last return; its pieces are named above it so the new first page (ENG-205) shows the same words.
    const today = page.indexOf("  return <CustomerShell brandColor={program.brandColor} locale={locale}");
    const order = ["{rulesBlock}", "{messagesBox}", "{noticeLine}", '<Button type="submit"'].map(mark => page.indexOf(mark, today));
    expect(page).toContain("<h3>{t.rules}</h3>");
    expect(page).toContain("const messagesBox = joinOffersMessages(onIphone, program) && <div className={styles.messages}>");
    expect(page).toContain('{notice && !program.demo && <p id="join-notice" className={styles.notice}>');
    expect(order.every(at => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).toContain('Mit „{existing ? t.anotherSubmit : t.submit}“ akzeptierst du die Programmregeln oben und die <Link href="/teilnahmebedingungen" target="_blank">Teilnahmebedingungen</Link>. Mehr in den <Link href="/datenschutz" target="_blank">Datenschutzhinweisen</Link>.');
    expect(page).toContain("`Darf dir ${program.businessName} Nachrichten auf deine Karte schicken?`");
  });
});

describe("the first page behind FIRST_TAP_HOOK_ENABLED (ENG-205, Design's spec of 10 Nov)", () => {
  const read = async (path: string) => (await import("node:fs")).readFileSync(path, "utf8");
  it("is chosen by the server's flag, for German programmes only; without it every case renders today's page", async () => {
    expect(firstPage(false, "de")).toBe(false);
    expect(firstPage(true, "fr")).toBe(false);
    expect(firstPage(true, "de")).toBe(true);
    expect(await read("src/app/join/[slug]/page.tsx")).toContain('<JoinClient slug={slug} firstTap={experienceFlag("FIRST_TAP_HOOK_ENABLED")} />');
    const source = await read("src/components/join-client.tsx");
    expect(source).toContain("export function JoinClient({ slug, firstTap = false }");
    expect(source).toContain("const newPage = firstPage(firstTap, locale);");
    // Every new branch hangs on newPage (or plain, which needs it), or on the flag itself while loading.
    expect(source).toContain('const plain = newPage && !existing && returning.state !== "stale" && program?.active !== false && !program?.demo;');
    expect(source).toContain("const top = newPage && <div");
    expect(source).toContain("if (loading && firstTap) return");
    expect(source).toContain("if (walletStep && newPage) return");
    expect(source).toContain("if (plain) return <CustomerShell");
    expect(source).toContain("{top || preview}");
  });
  it("draws nothing before the server has created the card, then holds 220 ms for the Wallet step or 400 ms for the card page, and not at all under reduced motion", async () => {
    // Reduced motion keeps the hold before the card page (without fades), so the status line is heard before the page changes.
    expect([firstTapHold(true, false), firstTapHold(false, false), firstTapHold(true, true), firstTapHold(false, true)]).toEqual([220, 400, 0, 400]);
    expect([firstTapHold(true, false, true), firstTapHold(false, false, true), firstTapHold(true, true, true), firstTapHold(false, true, true)]).toEqual([820, 820, 0, 400]);
    const source = await read("src/components/join-client.tsx"), created = source.indexOf("setCreated(true)");
    expect(source.match(/setCreated\(/g)).toHaveLength(1);
    expect(created).toBeGreaterThan(source.indexOf('postJson<{ cardToken: string }>("/api/enroll"'));
    expect(created).toBeGreaterThan(source.indexOf("if (!result) return;"));
    expect(source.slice(source.lastIndexOf('if (plain && next.go !== "tap") {', created), created)).not.toContain("\n      }");
    // The preview holds no stamp: nothing lands that the server has not booked.
    expect(source).toContain('<StampGrid earned={filled} landed={filled > 0 ? filled : undefined}');
  });
  it("keeps the rules above the terms sentence and the button, and puts the optional tick below the button, locked once sent (Legal, 10 Nov)", async () => {
    const source = await read("src/components/join-client.tsx"), page = source.indexOf("if (plain) return <CustomerShell"), end = source.indexOf("  return <CustomerShell brandColor={program.brandColor} locale={locale}");
    const order = ["{rulesBlock}", '{errorLine("rules")}', "{noticeLine}", '{errorLine("form")}', '<Button type="submit"', "{messagesBox}"].map(mark => source.indexOf(mark, page));
    expect(order.every(at => at > page && at < end)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(source.match(/disabled=\{plain && busy\}/g)).toHaveLength(2);
    // The returning check's line sits below the button, so its going moves nothing under the thumb.
    expect(source.indexOf('<Reveal open={returning.state === "checking"}', page)).toBeGreaterThan(order[4]);
  });
  it("sizes the placeholder's card like the card it stands for, and speaks once when the card exists", async () => {
    expect([firstCardHeight(), firstCardHeight({ programType: "stamp", rewardCost: 8 }), firstCardHeight({ programType: "stamp", rewardCost: 12 }), firstCardHeight({ programType: "points", rewardCost: 80 }), firstCardHeight({ programType: "stamp", rewardCost: 40 })]).toEqual([140, 140, 184, 120, 120]);
    const source = await read("src/components/join-client.tsx");
    expect(source).toContain("const cover = newPage && covered ? { main: placeholder } : undefined;");
    expect(source.match(/role="status">\{created \? /g)).toHaveLength(1);
    expect(source).toContain('<WalletStep token={walletStep} program={program} heading="h2" />');
  });
  it("fades the card and the footer out in the last 160 ms before the card page, and never before the Wallet step", async () => {
    const source = await read("src/components/join-client.tsx");
    expect(source).toContain('if (next.go !== "step") { router.prefetch(cardHref); if (!still) setTimeout(() => setLeavingPage(true), hold - FIRST_TAP_FADE_MS); }');
    expect(source).toContain("<div className={first.top} data-leaving={leavingPage || undefined}>");
    const css = await read("src/components/customer/first-page.module.css");
    expect(css).toContain(".top[data-leaving], .foot2[data-leaving] { opacity: 0; }");
  });
  it("gives every motion of the page a reduced-motion rule, within the house durations", async () => {
    const css = await read("src/components/customer/first-page.module.css");
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{\s*\.step, \.card\[data-created\]::before \{ animation: none; \}\s*\.blocks, \.top, \.foot2 \{ transition: none; \}/);
    // Skeleton to content: the loaded row and card do not rise; the placeholder fades over them (the shell's cover).
    expect(css).not.toMatch(/\.top \{[^}]*animation/);
    expect(css.match(/animation: [a-z]+ ([^;]+);/g)!.every(rule => /var\(--dur-(press|ui|reward)\)/.test(rule))).toBe(true);
    expect(css).not.toContain("infinite");
  });
});

describe("the Startbonus on the first page (ENG-207)", () => {
  const read = async (path: string) => (await import("node:fs")).readFileSync(path, "utf8");
  it("promises only what the server said this button gives, on the plain join, after the returning check", async () => {
    const source = await read("src/components/join-client.tsx");
    expect(source).toContain('const offer = plain ? program.headStart ?? 0 : 0, offerShown = offer > 0 && returning.state !== "checking";');
    expect(source).toContain('Zum Start bekommst du {withUnit(offer, program.programType, "de")} geschenkt.');
    // The join sends the promised amount, so a changed setting is refused as stale instead of breaking the promise.
    expect(source).toContain("...(plain && program?.headStart ? { headStart: program.headStart } : {}),");
  });
  it("fills a place only with what the server booked: rings before, the credited amount after", async () => {
    const source = await read("src/components/join-client.tsx");
    expect(source.match(/setCredited\(/g)).toHaveLength(1);
    expect(source).toContain("const bonus = result.headStart ?? 0, still = matchMedia(\"(prefers-reduced-motion: reduce)\").matches;\n        setCredited(bonus);");
    expect(source).toContain("data-promised={(!landedBonus && offerShown && Math.min(offer, 2)) || undefined}");
    // The rings stay through the card's press; the booked places take their place at the step and land with no delay.
    expect(source).toContain("const filled = landedBonus ? credited : 0;");
    expect(source).toContain("if (bonus > 0) { if (still) setLandedBonus(true); else setTimeout(() => setLandedBonus(true), FIRST_TAP_STEP_MS); }");
    expect(FIRST_TAP_STEP_MS).toBe(300);
    const css = await read("src/components/customer/first-page.module.css");
    expect(css).toContain('.card[data-promised="1"] .stamps li:nth-child(-n + 1), .card[data-promised="2"] .stamps li:nth-child(-n + 2) { border-color: var(--merchant-ink); }');
    expect(css).not.toMatch(/data-promised[^{]*\{[^}]*(--color-stamp|background)/);
  });
});
