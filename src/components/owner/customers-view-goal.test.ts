import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CustomersView } from "./customers-view";

// Several rewards on the owner's side (Design, #300): the grids count to the next reward not reached (cardGoal), the
// Kartenseite's line names a ready reward first.
let address = new URLSearchParams();
let members: unknown[] = [];
const REWARDS = [{ id: "big", title: "Gratiskaffee", cost: 8 }, { id: "small", title: "Kleiner Kaffee", cost: 3 }];
// The card opens in a ViewTransition, which the server render of this React build does not export.
vi.mock("react", async original => ({ ...await original<typeof import("react")>(), ViewTransition: ({ children }: { children: unknown }) => children }));
vi.mock("next/navigation", () => ({ useSearchParams: () => address, useRouter: () => ({ push: () => {}, replace: () => {} }), usePathname: () => "/merchant/customers" }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: { role: "owner", programType: "stamp", programSlug: "cafe", locationId: "loc-1", locationName: "Laden", publicBaseUrl: "https://example.test" }, locations: [] }), useDirtyGuard: () => {} }));
vi.mock("./use-load", () => ({ useLoad: (url: string | null) => [
  !url ? { state: "idle" } : url.startsWith("/api/merchant/retention") ? { state: "loading" }
    : url.startsWith("/api/merchant/customers/") ? { state: "ok", data: { member: members[0], eligibleRewards: [], timeline: [], nextCursor: null }, at: 0 }
    : url.startsWith("/api/merchant/customers") ? { state: "ok", data: { members, nextCursor: null }, at: 0 }
    : { state: "ok", data: { businessName: "Café", locationName: "Mitte", rewards: REWARDS }, at: 0 },
  () => {}] }));

const member = (balance: number) => ({ id: "m1", pseudonym: "", cardLocator: "K-ABCDEF", programName: "Karte", programType: "stamp", locationId: "loc-1", locationName: "Laden", balance,
  createdAt: "2026-11-01T10:00:00Z", closedAt: null, qualifyingCheckouts: 1, firstQualifyingAt: null, lastQualifyingAt: null, activityCount: 1, redemptionCount: 0, purchaseCount: null,
  referralStatus: "none", qualifiedReferrals: 0, emailMarketingEligible: false, eligibility: "not_checked" });
const page = (balance: number, query: string) => { members = [member(balance)]; address = new URLSearchParams(query); return renderToStaticMarkup(createElement(CustomersView)); };

describe("several rewards on the owner's side (Design, #300)", () => {
  it("the Kunden thumbnail counts to the next reward not reached, and shows the true count over every goal", () => {
    expect(page(2, "activity=all&status=active")).toContain('aria-label="2 von 3 Stempeln"');
    expect(page(4, "activity=all&status=active")).toContain('aria-label="4 von 8 Stempeln"');
    expect(page(9, "activity=all&status=active")).toContain('aria-label="9 Stempel"');
  });
  it("the Kartenseite card draws the same goal and its line names the ready reward first", () => {
    const card = page(4, "activity=all&card=m1");
    const screen = card.slice(0, card.indexOf("ow-under"));
    expect(screen).toContain('aria-label="4 von 8 Stempeln"');
    expect(screen).toContain("Stand reicht für „Kleiner Kaffee“.");
    expect(page(2, "activity=all&card=m1")).toContain("Noch 1 Stempel bis „Kleiner Kaffee“.");
  });
});
