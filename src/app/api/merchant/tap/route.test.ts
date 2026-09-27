import { describe, expect, it, vi } from "vitest";

const { setTapPolicy } = vi.hoisted(() => ({ setTapPolicy: vi.fn(async () => ({ mode: "disabled", cooldownSeconds: null })) }));
vi.mock("@/lib/secure-tap", () => ({ setTapPolicy }));
vi.mock("@/lib/http", () => ({
  requireSameOrigin: () => undefined,
  sessionUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
  jsonBody: async (request: Request) => request.json(),
  respondError: () => Response.json({ error: "rejected" }, { status: 400 }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => undefined }));
import { POST } from "./route";

describe("merchant tap HTTP boundary", () => {
  it("accepts policy changes but rejects physical tag lifecycle actions", async () => {
    const programId = "00000000-0000-4000-8000-000000000002";
    const policy = await POST(new Request("https://example.test/api/merchant/tap", { method: "POST", body: JSON.stringify({ action: "policy", programId, mode: "disabled", cooldownSeconds: null }) }));
    expect(policy.status).toBe(200);
    expect(setTapPolicy).toHaveBeenCalledTimes(1);
    for (const action of ["provision", "activate", "revoke", "replace"]) {
      const response = await POST(new Request("https://example.test/api/merchant/tap", { method: "POST", body: JSON.stringify({ action, programId, tagId: programId }) }));
      expect(response.status).toBe(400);
    }
    expect(setTapPolicy).toHaveBeenCalledTimes(1);
  });
});
