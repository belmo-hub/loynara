import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const path = vi.hoisted(() => ({ current: "/datenschutz" }));
vi.mock("next/navigation", () => ({ usePathname: () => path.current }));
const { LegalLinks } = await import("./legal-links");

describe("one set of legal links (G-22, G-M6)", () => {
  it("shows the page the reader is on as plain text with aria-current, the other as a link", () => {
    const out = renderToStaticMarkup(h(LegalLinks));
    expect(out).toContain('<span aria-current="page">Datenschutz</span>');
    expect(out).toContain('<a href="/teilnahmebedingungen">Teilnahmebedingungen</a>');
  });
  it("opens both beside the card when asked", () => {
    path.current = "/card/x";
    expect(renderToStaticMarkup(h(LegalLinks, { newTab: true }))).toContain('<a target="_blank" rel="noopener" href="/datenschutz">Datenschutz</a>');
  });
});
