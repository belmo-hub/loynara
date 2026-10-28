import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Load = { state: "ok"; data: unknown; at: number } | { state: "loading" };
const state = vi.hoisted(() => ({ role: "owner", hidden: [] as string[], loads: {} as Record<string, Load>, urls: [] as string[] }));
vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: { role: state.role }, locations: [{ id: "a" }, { id: "b" }], hiddenSurfaces: state.hidden, guard: (run: () => void) => run(), resetAfterSignOut: () => {} }) }));
vi.mock("@/components/owner/use-load", () => ({ useLoad: (url: string | null) => { if (url) state.urls.push(url); return [url === null ? { state: "idle" } : state.loads[url] ?? { state: "loading" }, () => {}]; } }));
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({ push: () => {} }) }));

import MorePage from "./page";

const ok = (data: unknown): Load => ({ state: "ok", data, at: 0 });
const html = () => renderToStaticMarkup(createElement(MorePage));

describe("„Mehr“ (ENG-122c)", () => {
  beforeEach(() => {
    Object.assign(state, { role: "owner", hidden: [], urls: [] });
    state.loads = { "/api/staff": ok({ staff: [{ active: true }, { active: true }, { active: false }] }), "/api/merchant/billing": ok({ liveBilling: true, status: "manual_pending" }) };
  });

  it("owner: one row per page with the counts from the existing reads, the two exports, and sign-out", () => {
    const page = html();
    for (const href of ["/merchant/settings", "/merchant/locations", "/merchant/staff", "/merchant/billing"]) expect(page).toContain(`href="${href}"`);
    expect(page).toContain("Standorte, Wochenbericht, Programmende");
    expect(page).toMatch(/Standorte<\/strong><\/span><span class="ow-prog-value" data-big="true">2</);
    expect(page).toMatch(/Team<\/strong><\/span><span class="ow-prog-value" data-big="true">2</); // active people only
    expect(page).toContain("Noch kein Abo");
    expect(page).toContain('href="/api/merchant/export?format=karten" download=""');
    expect(page).toContain('href="/api/merchant/export?format=buchungen" download=""');
    expect(page).toContain("Abmelden");
  });

  it("names and reads no Abrechnung where billing is withheld, and no Programmende where cancelling is", () => {
    state.hidden = ["billing", "cancellation"];
    const page = html();
    expect(page).not.toContain("/merchant/billing");
    expect(state.urls).not.toContain("/api/merchant/billing");
    expect(page).toContain("Standorte, Wochenbericht<");
  });

  it("a row whose read is still loading or failed shows no number rather than a wrong one", () => {
    state.loads = {};
    const page = html();
    expect(page).toMatch(/Team<\/strong><\/span><\/span>/);
    expect(page).not.toContain("Noch kein Abo");
  });

  it("manager: only sign-out, and nothing is read", () => {
    state.role = "manager";
    const page = html();
    expect(page).not.toContain("/merchant/settings");
    expect(page).not.toContain("/api/merchant/export");
    expect(page).toContain("Abmelden");
    expect(state.urls).toEqual([]);
  });
});
