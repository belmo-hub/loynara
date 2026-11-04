import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: { role: "owner", businessName: "Café", locationName: "Kassel Mitte" }, locations: [], hiddenSurfaces: [] }) }));
vi.mock("@/components/owner/use-load", () => ({ useLoad: () => [{ state: "loading" }, () => {}] }));
vi.mock("@/components/owner/owner-shell", () => ({ GuardedLink: ({ children }: { children: unknown }) => children }));

import MerchantSettingsPage from "./page";

const storage = new Map<string, string>();
vi.stubGlobal("sessionStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
afterEach(() => storage.clear());

describe("Geschäft", () => {
  it("O7: shows the withdrawal's one-shot message as a status where the withdrawal returns (Design blocking 2)", () => {
    storage.set("owner-flash", "Kündigung zurückgenommen");
    expect(renderToStaticMarkup(createElement(MerchantSettingsPage))).toMatch(/<div role="status">.*Kündigung zurückgenommen/);
  });

  it("shows nothing without a message", () => {
    expect(renderToStaticMarkup(createElement(MerchantSettingsPage))).not.toContain("Kündigung zurückgenommen");
  });
});
