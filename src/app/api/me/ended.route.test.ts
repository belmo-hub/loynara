import { afterAll, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/loyalty";

const state = vi.hoisted(() => ({ failure: null as unknown, ended: null as unknown, asked: [] as string[] }));
vi.mock("@/lib/http", () => ({
  sessionUser: async () => ({ id: "synthetic-owner" }),
  respondError: (error: { code?: string }) => Response.json({ code: error.code }, { status: error.code === "PROGRAM_ENDED" ? 400 : 500 }),
}));
vi.mock("@/lib/locations", () => ({ selectedLocationFromRequest: () => null }));
vi.mock("@/lib/product", () => ({ getMerchantContext: async () => { throw state.failure; } }));
vi.mock("@/lib/programme-end", () => ({ endedAccount: async (userId: string) => { state.asked.push(userId); return state.ended; } }));

import { GET } from "./route";

const original = process.env.PUBLIC_BASE_URL;
afterAll(() => { if (original === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = original; });
const get = () => { process.env.PUBLIC_BASE_URL = "https://loyalty.owned-domain.org"; return GET(new Request("http://127.0.0.1:3002/api/me")); };

describe("/api/me for a shop whose programme has ended", () => {
  it("answers 200 with only the user's own ended-programme data", async () => {
    state.failure = new DomainError("PROGRAM_ENDED", "Programm beendet");
    state.ended = { tenantId: "synthetic-tenant", role: "owner", businessName: "Synthetic Café", endedOn: "2026-10-31", exportUntil: "2026-11-30", exportOpen: true };
    const response = await get();
    expect(response.status).toBe(200);
    expect(state.asked).toEqual(["synthetic-owner"]); // only the signed-in user is looked up
    expect(await response.json()).toEqual({ userId: "synthetic-owner", tenantId: "synthetic-tenant", publicBaseUrl: "https://loyalty.owned-domain.org",
      programEnded: { role: "owner", businessName: "Synthetic Café", endedOn: "2026-10-31", exportUntil: "2026-11-30", exportOpen: true } });
  });

  it("still fails when the account has no ended shop, and for every other error", async () => {
    state.failure = new DomainError("PROGRAM_ENDED", "Programm beendet"); state.ended = null;
    expect((await get()).status).toBe(400);
    state.failure = new DomainError("SETUP_INCOMPLETE", "x"); state.ended = { tenantId: "t" };
    expect((await get()).status).toBe(500);
  });
});
