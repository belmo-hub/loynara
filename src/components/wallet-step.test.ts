import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { iphoneJoin } from "./join-client";
import { afterJoin, tapOffersWalletStep, WalletStep } from "./wallet-step";

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));

describe("join page headline (ENG-130 01/02)", () => {
  it("names the iPhone only on iOS where the location has Apple Wallet", () => {
    expect(iphoneJoin("ios", { appleWallet: true })).toBe(true);
    expect(iphoneJoin("ios", { appleWallet: false })).toBe(false);
    expect(iphoneJoin("ios", {})).toBe(false);
    expect(iphoneJoin("android", { appleWallet: true })).toBe(false);
    expect(iphoneJoin("other", { appleWallet: true })).toBe(false);
    expect(iphoneJoin("ios", { appleWallet: true, locale: "fr" })).toBe(false);
  });
});

describe("after a successful join (ENG-130 03)", () => {
  const base = { tap: false, ios: true, appleWallet: true, mark: null };
  it("shows the Wallet step on an iPhone with Apple Wallet, once per card on this device", () => {
    expect(afterJoin(base)).toEqual({ go: "step" });
    for (const mark of ["pending", "shown", "saved"] as const) expect(afterJoin({ ...base, mark })).toEqual({ go: "card" });
  });
  it("goes straight to the card off iOS or without Apple Wallet for the location", () => {
    expect(afterJoin({ ...base, ios: false })).toEqual({ go: "card" });
    expect(afterJoin({ ...base, appleWallet: false })).toEqual({ go: "card" });
  });
  it("continues a pending tap first and hands the step to the tap page", () => {
    expect(afterJoin({ ...base, tap: true })).toEqual({ go: "tap", mark: "pending" });
    expect(afterJoin({ ...base, tap: true, ios: false })).toEqual({ go: "tap" });
    expect(afterJoin({ ...base, tap: true, mark: "shown" })).toEqual({ go: "tap" });
  });
  it("the tap page offers it only after a booked stamp, for a handed-over card, on iOS", () => {
    expect(tapOffersWalletStep({ done: true, ios: true, mark: "pending" })).toBe(true);
    expect(tapOffersWalletStep({ done: false, ios: true, mark: "pending" })).toBe(false);
    expect(tapOffersWalletStep({ done: true, ios: false, mark: "pending" })).toBe(false);
    for (const mark of [null, "shown", "saved"] as const) expect(tapOffersWalletStep({ done: true, ios: true, mark })).toBe(false);
  });
});

describe("Wallet step screen (ENG-130 03/04)", () => {
  const render = (messages: boolean, programType: "stamp" | "points" = "stamp") => renderToStaticMarkup(h(WalletStep, { token: "card_x", businessName: "Café Lindenblatt", programType, messages }));
  it("shows the example message, its „Beispiel“ tag and the caption only while walletMessages is on", () => {
    const on = render(true);
    expect(on).toContain("Heute bis 17 Uhr: Kuchen zum Kaffee für 2 €.");
    expect(on).toMatch(/Café Lindenblatt<\/strong><em[^>]*>Beispiel<\/em>/);
    expect(on).toContain("Angebote vom Laden nur, wenn du es erlaubst: höchstens 2 pro Woche, jederzeit abschaltbar.");
    const off = render(false);
    for (const text of ["Kuchen zum Kaffee", "Beispiel", "Angebote vom Laden"]) expect(off).not.toContain(text);
    expect(off).toContain("Deine Prämie ist bereit. Du kannst sie an der Kasse einlösen.");
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
