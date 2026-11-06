import { describe, expect, it } from "vitest";
import type { PublicProgram } from "./client-api";
import { joinConsent, joinNeedsTick, joinOffersMessages, staleJoin } from "./join-client";

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
  it("offers the message box only on an iPhone with Apple Wallet, for a German shop, while the surface is on", () => {
    const on = { appleWallet: true, walletMessages: true };
    expect(joinOffersMessages("ios", on)).toBe(true);
    expect(joinOffersMessages("ios", { ...on, walletMessages: false })).toBe(false);
    expect(joinOffersMessages("ios", { ...on, appleWallet: false })).toBe(false);
    expect(joinOffersMessages("ios", { ...on, locale: "fr" })).toBe(false);
    expect(joinOffersMessages("android", on)).toBe(false);
    expect(joinOffersMessages("other", on)).toBe(false);
  });
  it("sends the version only for a shown, ticked box, and the box starts unticked", async () => {
    expect(joinConsent(true, true)).toEqual({ walletConsentVersion: "wallet-consent-join-2026-11-06-v1" });
    expect(joinConsent(true, false)).toEqual({});
    expect(joinConsent(false, true)).toEqual({});
    const page = await source();
    expect(page).toContain("const [messagesTicked, setMessagesTicked] = useState(false);");
    expect(page).toContain("...joinConsent(program !== null && joinOffersMessages(platform, program), messagesTicked)");
  });
  it("says in its own words why a tick was refused, and keeps the page", async () => {
    const page = await source();
    expect(page).toContain('cause.code === "CONSENT_TEXT_CHANGED") {\n        setError(CONSENT_CHANGED);');
    expect(page).toContain("Der Text zum Häkchen hat sich geändert. Bitte lade die Seite neu, lies ihn und setze das Häkchen noch einmal.");
  });
  it("puts rules, message box, notice and button in that order, with Legal's notice", async () => {
    const page = await source();
    const order = ["<h3>{t.rules}</h3>", "<div className={styles.messages}>", "<p className={styles.notice}>", '<Button type="submit"'].map(mark => page.indexOf(mark));
    expect(order.every(at => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(page).toContain('Mit „{existing ? t.anotherSubmit : t.submit}“ akzeptierst du die Programmregeln oben und die <Link href="/teilnahmebedingungen" target="_blank">Teilnahmebedingungen</Link>. Mehr in den <Link href="/datenschutz" target="_blank">Datenschutzhinweisen</Link>.');
    expect(page).toContain("`Darf dir ${program.businessName} Nachrichten auf deine Karte schicken?`");
  });
});
