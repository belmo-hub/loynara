import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse, PublicProgram } from "@/components/client-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => "/merchant/program/challenge" }));
vi.mock("./owner-context", () => ({ useDirtyGuard: () => {}, useOwner: () => ({ refresh: async () => true, announce: () => {}, guard: (action: () => void) => action() }) }));

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
});
