import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const TOKEN = "card__secretsecretsecretsecretsecretsecret12";
const SCAN = "sc_2bMOTKkcba_GPu-PjqNd59FqALfoDoQI";
const lookup = vi.hoisted(() => ({ qr: null as string | null }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/programme-end", () => ({ endedCardShop: async () => null }));
vi.mock("@/lib/card-first-paint", () => ({ firstPaintQr: async () => lookup.qr }));
vi.mock("@/components/card-client", () => ({ CardClient: () => createElement("main", null, "card") }));
const { cardQrSrc } = await import("@/lib/card-qr");
const { default: CardPage } = await import("./page");

const render = async () => renderToStaticMarkup(await CardPage({ params: Promise.resolve({ token: TOKEN }) }) as ReactElement);

// Review of #353 (K9): the first HTML names the QR image by its scan code, never the card link, the guest's credential.
describe("the card page's first HTML", () => {
  it("preloads the QR at high priority and never names the card link", async () => {
    lookup.qr = cardQrSrc(SCAN);
    const html = await render();
    expect(html).toContain(`<link rel="preload" as="image" href="/api/qr?value=${SCAN}" fetchPriority="high"/>`);
    expect(html).not.toContain(TOKEN);
    expect(html).not.toContain("card__");
  });
  it("has no preload when the lookup gives nothing (unknown, closed, reissued or limited)", async () => {
    lookup.qr = null;
    const html = await render();
    expect(html).not.toContain("preload");
    expect(html).toBe("<main>card</main>");
  });
});
