import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerCardView } from "./loyalty-ui";

const noop = () => {};
const render = (wallet: Partial<ComponentProps<typeof CustomerCardView>> = {}) => renderToStaticMarkup(createElement(CustomerCardView, {
  businessName: "Example shop", locationName: "Counter", programType: "stamps", balance: 1,
  cardLocator: "K-EXAMPLE", ...wallet,
}));
const buttons = (html: string) => html.match(/<button[^>]*class="wallet-add [\s\S]*?<\/button>/g) ?? [];

describe("customer Wallet badges", () => {
  it.each([
    ["Apple only", { onAppleWallet: noop }, ["apple-de.svg"]],
    ["Google only", { onGoogleWallet: noop }, ["google-de.svg"]],
    ["both", { onAppleWallet: noop, onGoogleWallet: noop }, ["apple-de.svg", "google-de.svg"]],
    ["neither / disabled capabilities", {}, []],
  ] as const)("shows official artwork only for available capabilities: %s", (_name, props, expected) => {
    const shown = buttons(render(props));
    expect(shown).toHaveLength(expected.length);
    expected.forEach((asset, i) => expect(shown[i]).toContain(`/wallet/${asset}`));
  });

  it("keeps provider actions hidden when the authoritative callbacks are absent", () => {
    const html = render({ googleTestOnly: true, walletPlatform: "ios" });
    expect(html).not.toContain("customer-wallet-add");
    expect(html).not.toContain("/wallet/");
  });

  it.each([
    ["ios", "apple-de.svg"], ["android", "google-de.svg"],
  ] as const)("preserves platform narrowing on %s", (walletPlatform, asset) => {
    const shown = buttons(render({ onAppleWallet: noop, onGoogleWallet: noop, walletPlatform }));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toContain(asset);
  });

  it.each([
    ["de", "Zu Apple Wallet hinzufügen", "Zu Google Wallet hinzufügen"],
    ["fr", "Ajouter à Apple Wallet", "Ajouter à Google Wallet"],
  ] as const)("provides localized artwork and accessible action names in %s", (locale, appleLabel, googleLabel) => {
    const shown = buttons(render({ locale, onAppleWallet: noop, onGoogleWallet: noop }));
    expect(shown[0]).toContain(`aria-label="${appleLabel}"`);
    expect(shown[1]).toContain(`aria-label="${googleLabel}"`);
    expect(shown[0]).toContain(`/wallet/apple-${locale}.svg`);
    expect(shown[1]).toContain(`/wallet/google-${locale}.svg`);
    shown.forEach(button => expect(button).toContain('alt=""'));
  });

  it("disables both actions during issuance while preserving artwork and announcing progress", () => {
    const html = render({ onAppleWallet: noop, onGoogleWallet: noop, walletBusy: "apple" });
    const shown = buttons(html);
    shown.forEach(button => expect(button).toContain('disabled=""'));
    expect(shown[0]).toContain('aria-busy="true"');
    expect(shown[1]).toContain('aria-busy="false"');
    expect(shown[0]).toContain("/wallet/apple-de.svg");
    expect(html).toContain('role="status"');
    expect(html).toContain("Wird vorbereitet");
  });
});
