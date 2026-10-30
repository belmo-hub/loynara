import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { afterJoin, iphoneJoin, tapAsksForWalletStep, tapWalletStep, WalletStep } from "./wallet-step";

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
    expect(tapAsksForWalletStep({ done: true, ios: true, mark: "pending" })).toBe(true);
    expect(tapAsksForWalletStep({ done: false, ios: true, mark: "pending" })).toBe(false);
    expect(tapAsksForWalletStep({ done: true, ios: false, mark: "pending" })).toBe(false);
    for (const mark of [null, "shown", "saved"] as const) expect(tapAsksForWalletStep({ done: true, ios: true, mark })).toBe(false);
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
    expect(html).toContain("Zu Apple Wallet hinzufügen");
    expect(html).toContain('href="/card/card_x"');
    expect(html).toContain("Später, zuerst meine Karte ansehen");
    expect(html).toContain("Stempel sammelst du auch ohne Wallet. Speichern kannst du die Karte später unter „In Wallet speichern“.");
    expect(render(false, "points")).toContain("Punkte sammelst du auch ohne Wallet.");
  });
});
