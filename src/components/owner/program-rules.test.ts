import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse, PublicProgram } from "@/components/client-api";
import { EXCLUDED_GOODS } from "@/lib/card-extras";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/merchant/program/rule" }));
vi.mock("./owner-context", () => ({ useDirtyGuard: () => {}, useOwner: () => ({ refresh: async () => true, announce: () => {}, guard: (action: () => void) => action() }) }));

import { RuleQuestion } from "./program-rules";

const program = (change: Partial<PublicProgram>) => ({
  businessName: "Café Lindenblatt", programType: "stamp", earningMode: "manual", pointsPerCurrencyUnit: 1, currency: "EUR", locale: "de", rulesText: "",
  ownerRulesText: "Ein Stempel pro Heißgetränk.", rewards: [{ id: "v1", rewardId: "r1", title: "Gratiskaffee", cost: 10, sortOrder: 0 }], ...change,
}) as PublicProgram;
const screen = (change: Partial<PublicProgram>) => renderToStaticMarkup(h(RuleQuestion, { me: { programSlug: "cafe" } as MeResponse, program: program(change) }));

describe("the rule screens' sign-up preview (14, 52)", () => {
  it.each([
    ["stamps (14)", {}],
    ["manual points (14)", { programType: "points", ownerRulesText: "10 Punkte pro Pizza." }],
    ["points by purchase amount (52)", { programType: "points", earningMode: "purchase", ownerRulesText: "" }],
  ] as const)("%s ends with Legal's exclusions, as the sign-up page does", (_, change) => {
    const html = screen(change);
    expect(html).toContain(`<p class="ow-cardline-rules">${EXCLUDED_GOODS}</p></div>`); // the card's last line
    expect(html.indexOf(EXCLUDED_GOODS)).toBeGreaterThan(html.lastIndexOf("Gratiskaffee"));
  });

  it("leaves them out where the sign-up page doesn't print them (French)", () => {
    expect(screen({ locale: "fr" })).not.toContain(EXCLUDED_GOODS);
  });
});
