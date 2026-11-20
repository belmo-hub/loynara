import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MerchantMember } from "@/lib/merchant-members";
import { CardScreen } from "./card-screen";

let card: { balance: number; type: MerchantMember["programType"]; rewards: Array<{ title: string; cost: number }>; closed?: boolean };
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push: () => {}, replace: () => {} }) }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ me: { role: "owner", programType: card.type, programSlug: "pizza", locationId: "loc-1", locationName: "Laden" }, locations: [] }) }));
vi.mock("./use-load", () => ({ useLoad: (url: string) => [url.startsWith("/api/program/")
  ? { state: "ok", at: 0, data: { businessName: "Pizzeria Nord", locationName: "Kassel", programType: card.type, brandColor: "#1f5b45",
    rewards: card.rewards.map((reward, i) => ({ id: `r${i}`, rewardId: `r${i}`, sortOrder: i, ...reward })) } }
  : { state: "ok", at: 0, data: { eligibleRewards: [], timeline: [], nextCursor: null, member: { id: "m", pseudonym: "p", cardLocator: "K-1234", programName: "Karte", programType: card.type,
    locationId: "loc-1", locationName: "Laden", balance: card.balance, createdAt: "2026-11-01T10:00:00Z", closedAt: card.closed ? "2026-11-02T10:00:00Z" : null,
    qualifyingCheckouts: 3, firstQualifyingAt: null, lastQualifyingAt: null, activityCount: 3, redemptionCount: 0, purchaseCount: null,
    referralStatus: "none", qualifiedReferrals: 0, emailMarketingEligible: false, eligibility: "not_yet" } } }, () => {}] }));

const page = (next: typeof card) => { card = next; return renderToStaticMarkup(createElement(CardScreen, { id: "m", back: { href: "/merchant/customers", label: "Kunden" }, onMember: () => {} })); };
const three = [{ title: "Erste Prämie", cost: 60 }, { title: "Pizza", cost: 150 }, { title: "Menü", cost: 300 }];

describe("Kartenseite: the points programme on the mix card (ENG-292 part 2a, spec §3)", () => {
  it.each([[0, "Noch 60 Punkte bis „Erste Prämie“."], [21, "Noch 39 Punkte bis „Erste Prämie“."], [60, "Stand reicht für „Erste Prämie“."],
    [186, "Stand reicht für „Erste Prämie“."], [420, "Stand reicht für „Erste Prämie“."]])("at %i points draws the mix card with the ladder and the owner line", (balance, line) => {
    const html = page({ balance, type: "points", rewards: three });
    expect(html).toContain('aria-label="Karte"');
    expect(html).toContain("Punkte</span>");
    expect(html).toContain(line);
    for (const reward of three) expect(html).toContain(reward.title);
    expect(html).not.toContain("ow-stand");
  });
  it("draws a single reward on the mix card too", () => {
    const html = page({ balance: 21, type: "points", rewards: [{ title: "Pizza", cost: 60 }] });
    expect(html).toContain("Noch 39 Punkte bis „Pizza“.");
    expect(html).not.toContain("ow-stand");
  });
  it("keeps the house block for a points card without a target", () => {
    expect(page({ balance: 21, type: "points", rewards: [] })).toContain("ow-stand");
    expect(page({ balance: 21, type: "points", rewards: three, closed: true })).toContain("ow-stand");
  });
  it("keeps stamps on the stamp mix card", () => {
    const html = page({ balance: 5, type: "stamp", rewards: [{ title: "Kaffee", cost: 8 }] });
    expect(html).toContain("von 8");
    expect(html).not.toContain("ow-stand");
  });
});
