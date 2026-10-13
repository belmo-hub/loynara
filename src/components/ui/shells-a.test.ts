import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AuthShell } from "./auth-shell";
import { CashierShell } from "./cashier-shell";
import { CustomerShell } from "./customer-shell";

const html = renderToStaticMarkup;

describe("CustomerShell", () => {
  const out = html(h(CustomerShell, { brandColor: "#2F6B58", locale: "fr" }, h("p", null, "Carte")));
  it("follows the system theme and speaks the card's language", () => {
    expect(out).toMatch(/class="ly-theme-auto[^"]*"/);
    expect(out).toContain('lang="fr"');
  });
  it("passes the merchant palette as CSS variables, with a text colour per theme", () => {
    expect(out).toContain("--merchant:#2F6B58");
    expect(out).toMatch(/--merchant-text-light:#[0-9A-F]{6}/);
    expect(out).toMatch(/--merchant-text-dark:#[0-9A-F]{6}/);
  });
  it("has one main landmark and a live region inside the themed area", () => {
    expect(out.match(/<main/g)).toHaveLength(1);
    expect(out.indexOf('aria-live="polite"')).toBeGreaterThan(out.indexOf("ly-theme-auto"));
  });
});

describe("CashierShell", () => {
  const out = html(h(CashierShell, { location: "Kassel Mitte", state: "open", stateLabel: "Karte offen", stateDetail: "K-H3G3E2", dock: h("button", null, "1 Stempel vergeben") }, h("p", null, "x")));
  it("is always dark", () => {
    expect(out).toMatch(/class="ly-theme-dark[^"]*"/);
  });
  it("announces the counter state", () => {
    expect(out).toMatch(/data-state="open"[^>]*role="status"|role="status"[^>]*data-state="open"/);
    expect(out).toContain("Karte offen");
  });
  it("keeps the primary action in the bottom dock", () => {
    expect(out).toMatch(/data-dock="true"[\s\S]*1 Stempel vergeben/);
  });
});

describe("AuthShell", () => {
  it("frames the page with the brand, a main region and the legal links", () => {
    const out = html(h(AuthShell, null, h("h1", null, "Anmelden")));
    expect(out).toMatch(/class="ly-theme-auto[^"]*"/);
    expect(out).toContain('href="/datenschutz"');
    expect(out).toContain('href="/teilnahmebedingungen"');
    expect(out.match(/<main/g)).toHaveLength(1);
  });
});
