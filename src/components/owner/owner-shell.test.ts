import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hidden: [] as string[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ status: "loading", me: null, locations: [], hiddenSurfaces: state.hidden, guard: (run: () => void) => run(), resetAfterSignOut: () => {} }) }));
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), usePathname: () => "/merchant/customers", useRouter: () => ({ push: () => {} }) }));

import { OwnerShell } from "./owner-shell";

const html = () => renderToStaticMarkup(createElement(OwnerShell, null, "content"));

describe("the owner shell before /api/me has answered", () => {
  it("leaves a withheld surface out of the server HTML, so no tab shows and then vanishes", () => {
    state.hidden = ["audiences"];
    expect(html()).not.toContain("Zielgruppen");
    expect(html()).not.toContain("ow-subnav");
    state.hidden = [];
    expect(html()).toContain("Zielgruppen");
    expect(html()).toContain("ow-subnav");
  });
});
