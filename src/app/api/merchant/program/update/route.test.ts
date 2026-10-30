import { afterEach, describe, expect, it, vi } from "vitest";

const product = vi.hoisted(() => ({ takeBackRuleChange: vi.fn(async () => ({ takenBack: true })), updateProgram: vi.fn(async () => ({ programSlug: "demo" })) }));
vi.mock("@/lib/product", () => product);
vi.mock("@/lib/http", async importActual => ({
  ...(await importActual<typeof import("@/lib/http")>()),
  requireSameOrigin: () => undefined,
  sessionUser: async () => ({ id: "synthetic-owner" }),
  jsonBody: async (request: Request) => request.json(),
}));

import { POST } from "./route";

afterEach(() => Object.values(product).forEach(fn => fn.mockClear()));
const post = (body: Record<string, unknown>) => POST(new Request("https://app.example.test/api/merchant/program/update", { method: "POST", body: JSON.stringify({ programSlug: "demo", ...body }) }));

describe("the programme update route (ENG-100)", () => {
  it("sends „Änderung zurücknehmen“ to the take-back only", async () => {
    expect((await post({ takeBack: true })).status).toBe(200);
    expect(product.takeBackRuleChange).toHaveBeenCalledWith({ programSlug: "demo", takeBack: true, actorUserId: "synthetic-owner" });
    expect(product.updateProgram).not.toHaveBeenCalled();
  });

  it("passes the owner's worse answer through to the save", async () => {
    expect((await post({ rulesText: "Fünf Punkte pro Pizza.", worse: true })).status).toBe(200);
    expect(product.updateProgram).toHaveBeenCalledWith({ programSlug: "demo", rulesText: "Fünf Punkte pro Pizza.", worse: true, actorUserId: "synthetic-owner" });
    expect(product.takeBackRuleChange).not.toHaveBeenCalled();
  });
});
