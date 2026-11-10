import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ClientApiError } from "./client-api";
import { afterJoin, iphoneJoin, tapAsksForWalletStep, tapWalletStep, WalletStep, walletStepError } from "./wallet-step";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

const TAP = "/tap/abcdefghijklmnopqrstuvwx?e=0123456789abcdef0123456789abcdef&c=0123456789abcdef";

describe("join page headline and Wallet offer (ENG-130 01/02)", () => {
  it("holds only on iOS where the location has Apple Wallet, and never for a French shop", () => {
    expect(iphoneJoin("ios", { appleWallet: true })).toBe(true);
    expect(iphoneJoin("ios", { appleWallet: true, locale: "de" })).toBe(true);
    expect(iphoneJoin("ios", { appleWallet: false })).toBe(false);
    expect(iphoneJoin("ios", {})).toBe(false);
    expect(iphoneJoin("android", { appleWallet: true })).toBe(false);
    expect(iphoneJoin("other", { appleWallet: true })).toBe(false);
    expect(iphoneJoin("ios", { appleWallet: true, locale: "fr" })).toBe(false);
  });
});

describe("after a successful join (ENG-130 03)", () => {
  const base = { continuation: null, offer: true, mark: null };
  it("shows the Wallet step where it is offered and marks it shown, once per card on this device", () => {
    expect(afterJoin(base)).toEqual({ go: "step", mark: "shown" });
    for (const mark of ["pending", "shown", "saved"] as const) expect(afterJoin({ ...base, mark })).toEqual({ go: "card" });
  });
  it("goes straight to the card where it is not offered (off iOS, no Apple Wallet, a French shop)", () => {
    expect(afterJoin({ ...base, offer: iphoneJoin("ios", { appleWallet: true, locale: "fr" }) })).toEqual({ go: "card" });
    expect(afterJoin({ ...base, offer: iphoneJoin("ios", { appleWallet: false, locale: "de" }) })).toEqual({ go: "card" });
    expect(afterJoin({ ...base, offer: iphoneJoin("android", { appleWallet: true }) })).toEqual({ go: "card" });
  });
  it("continues a valid stored tap first and hands the step to the tap page", () => {
    expect(afterJoin({ ...base, continuation: TAP })).toEqual({ go: "tap", mark: "pending" });
    expect(afterJoin({ ...base, continuation: TAP, mark: "shown" })).toEqual({ go: "tap" });
    // A French shop on iOS with Wallet: the tap continues, nothing is handed over.
    expect(afterJoin({ ...base, continuation: TAP, offer: iphoneJoin("ios", { appleWallet: true, locale: "fr" }) })).toEqual({ go: "tap" });
  });
  it("ignores a missing or malformed continuation", () => {
    for (const continuation of [null, "", "/tap/short?e=1&c=2", `${TAP}&x=1`, `https://evil.example${TAP}`, "/card/card_x"]) {
      expect(afterJoin({ ...base, continuation })).toEqual({ go: "step", mark: "shown" });
    }
  });
});

describe("the Wallet band on the tap page (ENG-130 03)", () => {
  it("asks the location only after a booked stamp, for a handed-over card, on iOS", () => {
    expect(tapAsksForWalletStep({ done: true, waiting: false, ios: true, mark: "pending" })).toBe(true);
    // ENG-160: already while the customer waits for the team.
    expect(tapAsksForWalletStep({ done: false, waiting: true, ios: true, mark: "pending" })).toBe(true);
    expect(tapAsksForWalletStep({ done: false, waiting: false, ios: true, mark: "pending" })).toBe(false);
    expect(tapAsksForWalletStep({ done: false, waiting: true, ios: false, mark: "pending" })).toBe(false);
    for (const mark of [null, "shown", "saved"] as const) {
      expect(tapAsksForWalletStep({ done: true, waiting: false, ios: true, mark })).toBe(false);
      expect(tapAsksForWalletStep({ done: false, waiting: true, ios: true, mark })).toBe(false);
    }
  });
  it("ends the hand-over with „shown“ either way, and shows only for a German shop with Apple Wallet", () => {
    expect(tapWalletStep({ appleWallet: true, locale: "de" })).toEqual({ show: true, mark: "shown" });
    expect(tapWalletStep({ appleWallet: false, locale: "de" })).toEqual({ show: false, mark: "shown" });
    expect(tapWalletStep({ appleWallet: true, locale: "fr" })).toEqual({ show: false, mark: "shown" });
  });
});

describe("Wallet step screen (ENG-130 03/04)", () => {
  const render = (walletMessages: boolean | undefined, programType: "stamp" | "points" = "stamp", band = false) =>
    renderToStaticMarkup(h(WalletStep, { token: "card_x", program: { businessName: "Café Lindenblatt", programType, walletMessages }, band }));
  it("shows the example message, its „Beispiel“ tag and the caption only while the programme says walletMessages is on", () => {
    for (const band of [false, true]) {
      const on = render(true, "stamp", band);
      // A no-break space keeps „2 €“ together at every width (Design).
      expect(on).toContain("Heute bis 17 Uhr: Kuchen zum Kaffee für 2\u00a0€.");
      expect(on).toMatch(/Café Lindenblatt<\/strong><em[^>]*>Beispiel<\/em>/);
      expect(on).toContain("Angebote vom Laden nur, wenn du es erlaubst: höchstens 2 pro Woche, jederzeit abschaltbar.");
      for (const off of [render(false, "stamp", band), render(undefined, "stamp", band)]) {
        for (const text of ["Kuchen zum Kaffee", "Beispiel", "Angebote vom Laden"]) expect(off).not.toContain(text);
        expect(off).toContain("Deine Prämie ist bereit. Du kannst sie an der Kasse einlösen.");
      }
    }
  });
  it("keeps the Apple button, the skip link to the card and the programme's note", () => {
    const html = render(false);
    expect(html).toContain("Deine Karte ist fertig. Leg sie in Apple Wallet.");
    expect(html).toContain('alt="Hinzufügen zu Apple Wallet"');
    expect(html).toContain('src="/wallet/apple-add-de.svg"');
    expect(html).toContain('href="/card/card_x"');
    expect(html).toContain("Später, zuerst meine Karte ansehen");
    expect(html).toContain("Stempel sammelst du auch ohne Wallet. Speichern kannst du die Karte später unter „In Wallet speichern“.");
    expect(render(false, "points")).toContain("Punkte sammelst du auch ohne Wallet.");
  });
  it("names the button as Apple's badge reads, keeps the status line mounted and never dims the badge (ENG-132)", async () => {
    for (const band of [false, true]) {
      const html = render(false, "stamp", band);
      expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*alt="Hinzufügen zu Apple Wallet"/);
      expect(html).not.toMatch(/<button[^>]*aria-label/);
      expect(html).toMatch(/<p class="[^"]*" role="status"><\/p>/);
    }
    const css = (await import("node:fs")).readFileSync("src/components/customer/wallet-step.module.css", "utf8");
    expect(css).toContain(".apple:disabled { cursor: progress; }");
    expect(css).not.toMatch(/\.apple[^{]*\{[^}]*opacity/);
  });
});

describe("the pages wire the decisions (ENG-130 review N-3)", () => {
  it("the join passes the raw continuation and offers the step only where iphoneJoin holds", async () => {
    const source = (await import("node:fs")).readFileSync("src/components/join-client.tsx", "utf8");
    expect(source).toContain("afterJoin({ continuation, offer: program !== null && iphoneJoin(platform, program), mark: readWalletStep(result.cardToken) })");
    expect(source).toContain("if (next.mark) markWalletStep(result.cardToken, next.mark);");
  });
  it("the tap page writes the decision's mark and shows the band only when the decision says so", async () => {
    const source = (await import("node:fs")).readFileSync("src/components/tap-client.tsx", "utf8");
    expect(source).toContain("const step = tapWalletStep(value);\n      markWalletStep(recoveryCard, step.mark);\n      if (step.show) setWalletProgram(value);");
  });
});

describe("Apple's sheet straight after the join (ENG-172)", () => {
  const read = async (file: string) => (await import("node:fs")).readFileSync(file, "utf8");
  it("the join's step and the tap band open by themselves, on an iPhone only", async () => {
    expect(await read("src/components/join-client.tsx")).toContain("<WalletStep token={walletStep} program={program} auto={iphoneDevice()} />");
    const bands = (await read("src/components/tap-client.tsx")).split("\n").filter(line => line.includes("<WalletStep"));
    expect(bands).toHaveLength(1);
    expect(bands[0]).toContain("<WalletStep band auto={iphoneDevice()} stay={!done}");
  });
  it("brings the auto step's heading to the top and focuses it before starting", async () => {
    const step = await read("src/components/wallet-step.tsx");
    expect(step).toContain('if (!band) {\n      heading.current?.scrollIntoView({ block: "start" });\n      heading.current?.focus({ preventScroll: true });\n    }\n    void addRef.current(true);');
    expect(step).toContain("tabIndex={auto && !band ? -1 : undefined}");
    expect(step).not.toContain("scrollTo(");
  });
  it("the unprompted run ends busy at the hand-over and only watches; a press takes over, and a pressed run never reads the status", async () => {
    const step = await read("src/components/wallet-step.tsx");
    expect(step).toContain("async function add(unprompted = false) {");
    expect(step).toContain("onClick={() => void add()}");
    expect(step).toContain("if (unprompted) {\n        operation.current = null; watching.current = controller; setBusy(false);\n        if (!await waitForSheet(token, controller.signal)) return;\n        onAdd?.();\n        // As after a press: the waiting tap page stays until the stamp lands.\n        if (stayRef.current) setBack(true); else router.replace(cardHref);\n        return;\n      }");
    expect(step).toContain("watching.current?.abort();\n    const controller = new AbortController(); operation.current = controller;");
    expect(step.match(/waitForSheet\(/g)).toHaveLength(1);
    expect(step).not.toContain("sheetOpened");
  });
  it("leaves „Zu viele Versuche“ for a real press; other errors show on the unprompted run too", () => {
    const limited = new ClientApiError(429, "x", "RATE_LIMIT");
    expect(walletStepError(limited, true)).toBe("");
    expect(walletStepError(limited, false)).toBe("Zu viele Versuche. Bitte warte kurz und versuche es dann erneut.");
    expect(walletStepError(new ClientApiError(503, "x", "WALLET_UNAVAILABLE"), true)).toBe("Wallet ist gerade nicht verfügbar. Deine Karte funktioniert weiterhin hier im Browser.");
  });
  it("the auto step renders the same fallback screen, and the join's mark stops a second offer", () => {
    const html = renderToStaticMarkup(h(WalletStep, { token: "card_x", program: { businessName: "Café Lindenblatt", programType: "stamp" }, auto: true }));
    expect(html).toContain("Hinzufügen zu Apple Wallet");
    expect(html).toContain("Später, zuerst meine Karte ansehen");
    expect(html).toContain('tabindex="-1"');
    expect(afterJoin({ continuation: null, offer: true, mark: null })).toEqual({ go: "step", mark: "shown" });
    expect(afterJoin({ continuation: null, offer: true, mark: "shown" })).toEqual({ go: "card" });
  });
});
