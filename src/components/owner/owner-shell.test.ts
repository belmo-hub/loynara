import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hidden: [] as string[], role: "owner" as "owner" | "manager" }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ status: "loading", me: null, locations: [], hiddenSurfaces: state.hidden, role: state.role, guard: (run: () => void) => run(), resetAfterSignOut: () => {} }) }));
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

  it("uses the role the server read, so a manager never sees the owner-only areas flash up (ENG-184)", () => {
    state.role = "manager";
    expect(html()).not.toContain("Aktionen");
    expect(html()).not.toContain("/merchant/actions");
    // Einstellungen (Konto) is in the sidebar for managers (CTO, 23 Nov), never as a second phone tab beside „Mehr“.
    expect(html()).toContain(">Einstellungen</a></nav>");
    expect((html().match(/class="ow-tab"[^>]*href="\/merchant\/more"/g) ?? []).length).toBe(1);
    state.role = "owner";
    expect(html()).toContain("Aktionen");
    expect(html()).toContain("Einstellungen");
  });
});
