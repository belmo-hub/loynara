import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse, PublicProgram } from "@/components/client-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/merchant/program/challenge" }));
vi.mock("./owner-context", () => ({ useDirtyGuard: () => {}, useOwner: () => ({ refresh: async () => true, announce: () => {}, guard: (action: () => void) => action() }) }));

import { CardStudio } from "./card-studio";
import { ExtrasQuestion } from "./program-extras";

const me = (change: Partial<MeResponse>) => ({ role: "owner", programType: "points", hiddenSurfaces: [], ...change }) as MeResponse;

describe("owner programme screens count one in the singular (ENG-108)", () => {
  it("pending challenge hint, for this month and the next", () => {
    const hint = (bonus: number, next: number, programType: "stamp" | "points" = "points") =>
      renderToStaticMarkup(h(ExtrasQuestion, { me: me({ programType, challengeVisits: 3, challengeBonus: bonus, challengeNext: { from: "2026-11-01", visits: 4, bonus: next } }), question: "challenge", program: { rewards: [{ cost: 100 }] } as unknown as PublicProgram }));
    expect(hint(1, 2)).toContain("Diesen Monat gilt noch: 3-mal, +1 Punkt. Gilt ab 1.11.: 4-mal, +2 Punkte.");
    expect(hint(2, 1)).toContain("Diesen Monat gilt noch: 3-mal, +2 Punkte. Gilt ab 1.11.: 4-mal, +1 Punkt.");
    expect(hint(1, 2, "stamp")).toContain("Diesen Monat gilt noch: 3-mal, +1 Stempel. Gilt ab 1.11.: 4-mal, +2 Stempel.");
  });
  it("card studio's reward line", () => {
    const studio = (rewardCost: number, programType: "stamp" | "points" = "points") => renderToStaticMarkup(h(CardStudio, {
      me: me({ programType }), onSaved: () => {}, initial: { businessName: "Synthetic Café", locationName: "Kassel", brandColor: "#1F4A3A", logoData: null },
      program: { programName: "Treuekarte", programType, rewardTitle: "Kaffee", rewardCost, rewards: [{ id: "r1", title: "Kaffee", cost: rewardCost }] } as unknown as PublicProgram,
    }));
    expect(studio(1)).toContain("<dt>Prämie</dt><dd>1 Punkt → Kaffee</dd>");
    expect(studio(2)).toContain("<dt>Prämie</dt><dd>2 Punkte → Kaffee</dd>");
    expect(studio(1, "stamp")).toContain("<dt>Prämie</dt><dd>1 Stempel → Kaffee</dd>");
  });
});
