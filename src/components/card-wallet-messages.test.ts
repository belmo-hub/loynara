import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityDay, moveTokenFlags, savedLineDue, savedPanelShown, savedViewDue } from "./card-client";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentLabel, consentLines, panelShown, SwitchedOff, SwitchedOn } from "./card-wallet-messages";
import { markJoinAsked, markWalletStep } from "./wallet-step";

describe("consent panel lines (ENG-130, Legal 30 Oct)", () => {
  it("names the expiry notice on points programmes with an expiry rule", () => {
    expect(consentLines(true)).toEqual({
      under: "Deinen neuen Kontostand, „Prämie bereit“ und den Hinweis, bevor Punkte verfallen, siehst du immer, auch ohne Häkchen.",
      off: "Kontostand, „Prämie bereit“ und der Hinweis vor dem Punkteverfall kommen weiter.",
    });
  });
  it("keeps today's lines for stamp cards and points without expiry", () => {
    expect(consentLines(false)).toEqual({
      under: "Deinen neuen Kontostand und „Prämie bereit“ siehst du immer, auch ohne Häkchen.",
      off: "Kontostand und „Prämie bereit“ kommen weiter.",
    });
  });
  it("the card page asks for the expiry variant only on points with an expiry rule in force or pending", () => {
    const source = readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain('const expiry = card.programType === "points" && Boolean(card.pointsExpiry || card.pendingExpiry);');
  });
});

describe("the consent panel after switching off (ENG-162, Design P3)", () => {
  it("keeps its off line when the card no longer offers consent, and is not shown otherwise", () => {
    expect(panelShown(false, true)).toBe(true);
    expect(panelShown(true, false)).toBe(true);
    expect(panelShown(false, false)).toBe(false);
  });
  it("on an unreachable pass says only that messages are off: no off line, no „Einschalten“ (Design round 3)", () => {
    const { off } = consentLines(true);
    const props = { shop: "Café Lindenblatt", off, onSwitchOn: () => {} };
    const gone = renderToStaticMarkup(h(SwitchedOff, { ...props, available: false }));
    expect(panelShown(false, true)).toBe(true);
    expect(gone).toContain("Von Café Lindenblatt · Höchstens 2 pro Woche · aus");
    expect(gone).not.toContain(off);
    expect(gone).not.toContain("Einschalten");
    const offered = renderToStaticMarkup(h(SwitchedOff, { ...props, available: true }));
    expect(offered).toContain(off);
    expect(offered).toContain("Einschalten");
  });
});

describe("the card's flags on this device stay off the private link (F-2)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (seed: Record<string, string> = {}) => {
    const items = new Map(Object.entries(seed));
    vi.stubGlobal("localStorage", {
      get length() { return items.size; }, key: (index: number) => [...items.keys()][index] ?? null,
      getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value), removeItem: (key: string) => void items.delete(key),
    });
    return items;
  };
  const token = "card_SyntheticPrivateLinkToken0123456789ab";
  it("names each flag after the card number", () => {
    const items = storage();
    markWalletStep("K-7QX2MA", "shown");
    markJoinAsked("K-7QX2MA");
    expect(savedLineDue("K-7QX2MA", { appleSaved: true })).toBe(true);
    expect([...items.keys()].sort()).toEqual(["loynara_wallet_join_asked:K-7QX2MA", "loynara_wallet_saved_line:K-7QX2MA", "loynara_wallet_step:K-7QX2MA"]);
  });
  it("moves an older version's entries from the link to the card number, keeping what is already there, and leaves the rest", () => {
    const items = storage({ [`loynara_wallet_step:${token}`]: "saved", [`loynara_wallet_join_asked:${token}`]: "1", [`loynara_wallet_saved_line:${token}`]: "1", "loynara_wallet_step:K-7QX2MA": "shown", "loynara_seen:K-7QX2MA": "2026-11-10T10:00:00.000Z", "loynara_wallet_step:card_other": "shown" });
    moveTokenFlags(token, "K-7QX2MA");
    expect(Object.fromEntries(items)).toEqual({ "loynara_wallet_step:K-7QX2MA": "shown", "loynara_wallet_join_asked:K-7QX2MA": "1", "loynara_wallet_saved_line:K-7QX2MA": "1", "loynara_seen:K-7QX2MA": "2026-11-10T10:00:00.000Z", "loynara_wallet_step:card_other": "shown" });
    // Nobody sees the step or the line again under the new name.
    expect(savedViewDue("K-7QX2MA", { appleSaved: true })).toBe(false);
    expect(savedLineDue("K-7QX2MA", { appleSaved: true })).toBe(false);
  });
  it("does nothing where storage is blocked", () => {
    vi.stubGlobal("localStorage", { get length(): number { throw new Error("blocked"); } });
    expect(() => moveTokenFlags(token, "K-7QX2MA")).not.toThrow();
  });
  it("the pages pass the card number, and the card page moves old entries once it knows it", () => {
    const card = readFileSync("src/components/card-client.tsx", "utf8");
    expect(card).toContain("useEffect(() => { if (cardLocator) moveTokenFlags(token, cardLocator); }, [token, cardLocator]);");
    for (const file of ["card-client", "join-client", "tap-client"]) {
      const source = readFileSync(`src/components/${file}.tsx`, "utf8");
      expect(source).not.toMatch(/(readWalletStep|markWalletStep|markJoinAsked|joinAsked|savedViewDue|savedLineDue|savedPanelShown)\((token|recoveryCard|result\.cardToken)\b/);
    }
  });
});

describe("the return from Apple Wallet (ENG-130 08)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (seed: Record<string, string> = {}) => {
    const items = new Map(Object.entries(seed));
    vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) });
    return items;
  };
  it("moves the panel up while a device holds the pass, and marks „saved“ only once the moved-up panel has shown", () => {
    for (const mark of [undefined, "shown", "pending"]) {
      const items = storage(mark ? { "loynara_wallet_step:card_a": mark } : {});
      expect(savedViewDue("card_a", { appleSaved: true })).toBe(true);
      // walletMessages off: the panel renders nothing, so no mark and the next visit moves it up again.
      expect(savedPanelShown("card_a", true, false)).toBe(false);
      expect(items.get("loynara_wallet_step:card_a")).toBe(mark);
      expect(savedViewDue("card_a", { appleSaved: true })).toBe(true);
      // The panel showed under the card: marked once, later visits keep it in its usual place.
      expect(savedPanelShown("card_a", true, true)).toBe(true);
      expect(items.get("loynara_wallet_step:card_a")).toBe("saved");
      expect(savedViewDue("card_a", { appleSaved: true })).toBe(false);
    }
    // Per card, and only for the moved-up panel: the usual panel on a later visit leaves nothing.
    const items = storage();
    expect(savedPanelShown("card_b", false, true)).toBe(false);
    expect(items.size).toBe(0);
    expect(savedViewDue("card_b", { appleSaved: true })).toBe(true);
  });
  it("says „In Apple Wallet gespeichert“ on the first view after the pass registers only, with its own flag", () => {
    const items = storage({ "loynara_wallet_step:card_a": "shown" });
    expect(savedLineDue("card_a", { appleSaved: false })).toBe(false);
    expect(savedLineDue("card_a", { appleSaved: true })).toBe(true);
    expect(savedLineDue("card_a", { appleSaved: true })).toBe(false);
    // walletMessages off: the panel's flag stays open for after the switch, the line is done.
    expect(items.get("loynara_wallet_step:card_a")).toBe("shown");
    expect(savedViewDue("card_a", { appleSaved: true })).toBe(true);
    expect(savedLineDue("card_b", { appleSaved: true })).toBe(true);
    expect(readFileSync("src/components/card-client.tsx", "utf8")).toContain("walletSaved={savedLine && !french}");
  });
  it("doesn't ask again under the card when the join showed the box; the saved line stays", () => {
    const items = storage({ "loynara_wallet_step:card_a": "shown", "loynara_wallet_join_asked:card_a": "1" });
    expect(savedViewDue("card_a", { appleSaved: true })).toBe(false);
    expect(savedLineDue("card_a", { appleSaved: true })).toBe(true);
    expect(items.get("loynara_wallet_step:card_a")).toBe("shown");
    expect(savedViewDue("card_b", { appleSaved: true })).toBe(true);
    markJoinAsked("card_b");
    expect(savedViewDue("card_b", { appleSaved: true })).toBe(false);
  });
  it("a guest who ticked at the join sees „an“ with the off switch in the card's usual place (Legal)", () => {
    const html = renderToStaticMarkup(h(SwitchedOn, { shop: "Tick Café", givenAt: "2026-11-06T10:00:00.000Z", busy: false, onSwitchOff: () => {} }));
    expect(html).toContain("Von Tick Café · Höchstens 2 pro Woche · an");
    expect(html).toContain("Erlaubt am");
    expect(html).toContain("Abschalten");
    const panel = readFileSync("src/components/card-wallet-messages.tsx", "utf8");
    expect(panel).toContain("{state.granted ? <SwitchedOn ");
    expect(readFileSync("src/components/card-client.tsx", "utf8")).toContain("{!savedView && <CardWalletMessages token={token} expiry={expiry} timeZone={shop.timeZone} />}");
  });
  it("names the panel when the box is gone: on and switched off, while the question keeps its own heading", () => {
    const panel = readFileSync("src/components/card-wallet-messages.tsx", "utf8");
    expect(panel).toContain('{(state.granted || switchedOff) && <h2 className={styles.title}>Nachrichten auf deiner Wallet-Karte</h2>}');
  });
  it("a cancelled Apple sheet registers nothing, so the panel does not move up", () => {
    storage({ "loynara_wallet_step:card_a": "shown" });
    expect(savedViewDue("card_a", { appleSaved: false })).toBe(false);
    expect(savedViewDue("card_a", {})).toBe(false);
  });
  it("still works where storage is blocked (the view may repeat, nothing breaks)", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(savedViewDue("card_a", { appleSaved: true })).toBe(true);
    expect(savedPanelShown("card_a", true, true)).toBe(true);
  });
  it("the card page leaves the mark from the panel's own render signal", () => {
    expect(readFileSync("src/components/card-client.tsx", "utf8")).toContain("useEffect(() => { if (cardLocator) savedPanelShown(cardLocator, savedView, consentUp); }, [cardLocator, savedView, consentUp]);");
  });
  it("moves the panel under the card with its heading, never beside the e-mail offer", () => {
    const source = readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain("{savedView && <CardWalletMessages token={token} expiry={expiry} timeZone={shop.timeZone} onShown={setConsentUp} />}");
    expect(source).toContain("{french && !(savedView && consentUp) && <CardContact");
    // ENG-165: one offer under the card at a time; on the saved view the Wallet panel has the slot.
    expect(source).toContain("<Reveal open={!french && offerShown && !savedView} gap=\"var(--space-4)\"><EmailOffer");
    expect(source).toContain("{!savedView && <CardWalletMessages token={token} expiry={expiry} timeZone={shop.timeZone} />}");
    const panel = readFileSync("src/components/card-wallet-messages.tsx", "utf8");
    // The heading stands on every visit; only the placement under the card is once (Design, 30 Oct).
    expect(panel).toContain("<h2 className={styles.title}>{`Darf dir ${state.shop} Nachrichten auf deine Karte schicken?`}</h2>");
    expect(panel).toContain("`Von ${shop} · Höchstens 2 pro Woche · aus`");
  });
  it("offers no Apple add button once a device holds the pass, and keeps the re-add notice", () => {
    const card = readFileSync("src/components/customer/customer-card.tsx", "utf8");
    expect(card).toContain('const apple = onAppleWallet && walletPlatform !== "android" && !appleSaved ? [');
    const source = readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain("appleSaved={wallet?.appleSaved === true}");
    expect(source).toContain('{wallet?.apple === "available" && wallet.appleReAdd');
  });
  it("re-reads consent only while the panel is not shown, so the tick keeps its rate-limit room", () => {
    expect(readFileSync("src/components/card-wallet-messages.tsx", "utf8")).toContain('if (document.visibilityState === "visible" && !shownRef.current) read();');
  });
  it("re-reads consent and wallet status when the page becomes visible again", () => {
    for (const file of ["src/components/card-client.tsx", "src/components/card-wallet-messages.tsx"]) expect(readFileSync(file, "utf8")).toMatch(/addEventListener\("visibilitychange", visible\)/);
  });
});

describe("activity dates on the card (G-M3)", () => {
  const now = new Date("2026-10-31T12:00:00Z");
  it("says Heute and Gestern, then the weekday within the week, then the date, with the year only when it is not this one", () => {
    expect(activityDay("2026-10-31T07:00:00Z", "de-DE", now)).toBe("Heute");
    expect(activityDay("2026-10-30T09:00:00Z", "de-DE", now)).toBe("Gestern");
    expect(activityDay("2026-10-28T09:00:00Z", "de-DE", now)).toBe("Mi");
    expect(activityDay("2026-10-20T09:00:00Z", "de-DE", now)).toBe("20. Okt.");
    expect(activityDay("2025-12-24T09:00:00Z", "de-DE", now)).toBe("24. Dez. 2025");
  });
  it("gives French cards the plain date, with no new French words", () => {
    expect(activityDay("2026-10-31T07:00:00Z", "fr-FR", now)).toBe(new Date("2026-10-31T07:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Berlin" }));
  });
});

describe("demo environment (Legal follow-up, 9 Nov)", () => {
  const props = { shop: "Salon Aziz", givenAt: null, busy: false, onSwitchOff: () => {}, available: true, off: "", onSwitchOn: () => {} };
  it("the status lines name Loynara as sender, for the shop, and the demo's cap", () => {
    expect(renderToStaticMarkup(h(SwitchedOn, { ...props, demo: true }))).toContain("<p>Von Loynara für Salon Aziz · Höchstens 2 in der Demo · an</p>");
    expect(renderToStaticMarkup(h(SwitchedOff, { ...props, demo: true }))).toContain("<p>Von Loynara für Salon Aziz · Höchstens 2 in der Demo · aus</p>");
    expect(renderToStaticMarkup(h(SwitchedOn, props))).toContain("<p>Von Salon Aziz · Höchstens 2 pro Woche · an</p>");
    expect(renderToStaticMarkup(h(SwitchedOff, props))).toContain("<p>Von Salon Aziz · Höchstens 2 pro Woche · aus</p>");
  });
  it("the consent box keeps its privacy link: to the demo notice in the demo, unchanged elsewhere", () => {
    expect(renderToStaticMarkup(h(ConsentLabel, { lead: "Ja, Loynara darf …", demo: true }))).toBe('Ja, Loynara darf … <a href="/datenschutz">Datenschutzhinweise zur Demo</a>');
    expect(renderToStaticMarkup(h(ConsentLabel, { lead: "Ja, Café … ab. " }))).toBe('Ja, Café … ab. <a href="/datenschutz">Mehr in den Datenschutzhinweisen.</a>');
  });
});
