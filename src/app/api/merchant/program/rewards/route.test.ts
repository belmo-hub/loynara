import { afterEach, describe, expect, it, vi } from "vitest";

const product = vi.hoisted(() => ({
  archiveReward: vi.fn(async () => ({ archived: true })), createReward: vi.fn(), editReward: vi.fn(async () => ({ edited: true })),
  getMerchantRewards: vi.fn(), reorderRewards: vi.fn(), takeBackRewardChange: vi.fn(async () => ({ takenBack: true })),
}));
vi.mock("@/lib/product", () => product);
vi.mock("@/lib/http", async importActual => ({
  ...(await importActual<typeof import("@/lib/http")>()),
  requireSameOrigin: () => undefined,
  sessionUser: async () => ({ id: "synthetic-owner" }),
  jsonBody: async (request: Request) => request.json(),
}));

import { POST } from "./route";

afterEach(() => Object.values(product).forEach(fn => fn.mockClear()));
const rewardId = "11111111-1111-4111-8111-111111111111";
const post = (body: Record<string, unknown>) => POST(new Request("https://app.example.test/api/merchant/program/rewards", { method: "POST", body: JSON.stringify({ programSlug: "demo", rewardId, ...body }) }));

describe("the reward route sends each ENG-100 action to its own function", () => {
  it.each([
    [{ action: "price", cost: 9 }, "editReward"],
    [{ action: "rename", title: "Espresso", worse: true }, "editReward"],
    [{ action: "rename", title: "Espresso", worse: false }, "editReward"],
    [{ action: "takeBack" }, "takeBackRewardChange"],
    [{ action: "archive" }, "archiveReward"],
  ] as const)("%o reaches %s only", async (body, called) => {
    expect((await post(body)).status).toBe(200);
    for (const [name, fn] of Object.entries(product)) expect(fn.mock.calls.length, name).toBe(name === called ? 1 : 0);
  });

  it.each([{ action: "rename", title: "Espresso" }, { action: "rename", title: "Espresso", worse: "yes" }])("refuses a rename without the owner's choice: %o", async body => {
    const response = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Invalid input" });
    for (const fn of Object.values(product)) expect(fn).not.toHaveBeenCalled();
  });
});
