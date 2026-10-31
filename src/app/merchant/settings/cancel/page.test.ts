import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";

const state = vi.hoisted(() => ({ me: null as Partial<MeResponse> | null }));
vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: state.me, refresh: async () => {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

import CancelProgrammePage from "./page";

const page = (me: Partial<MeResponse>) => { state.me = { role: "owner", programSlug: "shop", ...me }; return renderToStaticMarkup(createElement(CancelProgrammePage)); };

describe("Programm beenden speaks the programme's unit (ENG-133, audit I-28)", () => {
  it("tells a stamp shop about Stempel and a points shop about Punkte", () => {
    expect(page({ programType: "stamp" })).toContain("Deine Kunden sammeln weiter Stempel und lösen Prämien ein, danach nicht mehr. Die Stempel bleiben gespeichert.");
    expect(page({ programType: "stamp" })).not.toContain("Punkte");
    expect(page({ programType: "points" })).toContain("Deine Kunden sammeln weiter Punkte und lösen Prämien ein, danach nicht mehr. Die Punkte bleiben gespeichert.");
  });

  it("gives the customer text the same unit once the end date is confirmed", () => {
    const confirmed = { cancellationEndDate: "2026-11-30", cancellationConfirmed: true };
    expect(page({ programType: "stamp", ...confirmed })).toContain("Unsere Stempelkarte läuft noch bis einschließlich 30.11.2026. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.");
    expect(page({ programType: "points", ...confirmed })).toContain("Unsere Punktekarte läuft noch bis einschließlich 30.11.2026.");
  });
});
