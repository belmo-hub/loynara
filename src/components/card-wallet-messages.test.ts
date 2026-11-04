import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { activityDay, savedLineDue, savedPanelShown, savedViewDue } from "./card-client";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { consentLines, panelShown, SwitchedOff } from "./card-wallet-messages";

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
    expect(readFileSync("src/components/card-client.tsx", "utf8")).toContain("useEffect(() => { savedPanelShown(token, savedView, consentUp); }, [token, savedView, consentUp]);");
  });
  it("moves the panel under the card with its heading, never beside the e-mail offer", () => {
    const source = readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain("{savedView && <CardWalletMessages token={token} expiry={expiry} onShown={setConsentUp} />}");
    expect(source).toContain("{french && !(savedView && consentUp) && <CardContact");
    // ENG-165: one offer under the card at a time; on the saved view the Wallet panel has the slot.
    expect(source).toContain("{!french && offerShown && !savedView && <EmailOffer");
    expect(source).toContain("{!savedView && <CardWalletMessages token={token} expiry={expiry} />}");
    const panel = readFileSync("src/components/card-wallet-messages.tsx", "utf8");
    // The heading stands on every visit; only the placement under the card is once (Design, 30 Oct).
    expect(panel).toContain("<h2 className={styles.title}>{`Darf dir ${state.shop} Nachrichten auf deine Karte schicken?`}</h2>");
    expect(panel).toContain("<p>Von {shop} · Höchstens 2 pro Woche · aus</p>");
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
    expect(activityDay("2026-10-31T07:00:00Z", "fr-FR", now)).toBe(new Date("2026-10-31T07:00:00Z").toLocaleDateString("fr-FR", { day: "2-digit", month: "short", year: "numeric" }));
  });
});
