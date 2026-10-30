import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { firstSavedView } from "./card-client";
import { consentLines } from "./card-wallet-messages";

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

describe("the return from Apple Wallet (ENG-130 08)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const storage = (seed: Record<string, string> = {}) => {
    const items = new Map(Object.entries(seed));
    vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => void items.set(key, value) });
    return items;
  };
  it("shows once per card on this device, only after a device registered the pass, and leaves the mark", () => {
    for (const mark of [undefined, "shown", "pending"]) {
      const items = storage(mark ? { "loynara_wallet_step:card_a": mark } : {});
      expect(firstSavedView("card_a", { appleSaved: true })).toBe(true);
      expect(items.get("loynara_wallet_step:card_a")).toBe("saved");
      expect(firstSavedView("card_a", { appleSaved: true })).toBe(false);
    }
    // Per card: another card on the same device gets its own first view.
    expect(firstSavedView("card_b", { appleSaved: true })).toBe(true);
  });
  it("a cancelled Apple sheet registers nothing, so nothing shows and no mark is left", () => {
    const items = storage({ "loynara_wallet_step:card_a": "shown" });
    expect(firstSavedView("card_a", { appleSaved: false })).toBe(false);
    expect(firstSavedView("card_a", {})).toBe(false);
    expect(items.get("loynara_wallet_step:card_a")).toBe("shown");
  });
  it("still works where storage is blocked (the view may repeat, nothing breaks)", () => {
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(firstSavedView("card_a", { appleSaved: true })).toBe(true);
  });
  it("moves the panel under the card with its heading, never beside the e-mail offer", () => {
    const source = readFileSync("src/components/card-client.tsx", "utf8");
    expect(source).toContain("{savedView && <CardWalletMessages token={token} expiry={expiry} onShown={setConsentUp} />}");
    expect(source).toContain("{!(savedView && consentUp) && <CardContact");
    expect(source).toContain("{!savedView && <CardWalletMessages token={token} expiry={expiry} />}");
    const panel = readFileSync("src/components/card-wallet-messages.tsx", "utf8");
    // The heading stands on every visit; only the placement under the card is once (Design, 30 Oct).
    expect(panel).toContain("<h2 className={styles.title}>{`Darf dir ${state.shop} Nachrichten auf deine Karte schicken?`}</h2>");
    expect(panel).toContain("<p>Von {state.shop} · Höchstens 2 pro Woche · aus</p>");
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
