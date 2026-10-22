import { afterEach, describe, expect, it, vi } from "vitest";

const request = vi.hoisted(() => vi.fn(async () => ({ endDate: "2026-10-31", nextMonth: false, confirmed: false })));
vi.mock("@/lib/http", () => ({
  requireSameOrigin: () => undefined,
  sessionUser: async () => ({ id: "synthetic-owner" }),
  jsonBody: async () => ({ programSlug: "demo-program" }),
  respondError: (error: { code?: string }) => Response.json({ code: error.code }, { status: error.code === "NOT_FOUND" ? 404 : 500 }),
}));
vi.mock("@/lib/rate-limit", () => ({ enforceRateLimit: async () => undefined }));
vi.mock("@/lib/programme-end", () => ({ requestCancellation: request, withdrawCancellation: request }));

import { POST } from "./route";

afterEach(() => { vi.unstubAllEnvs(); request.mockClear(); });
const post = () => POST(new Request("https://app.example.test/api/merchant/program/cancel", { method: "POST" }));

describe("the owner's cancel route follows the pilot surface", () => {
  it("is refused as not available on real production, without reaching the programme", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    const response = await post();
    expect(response.status).toBe(404);
    expect(request).not.toHaveBeenCalled();
  });

  it("works on a development or preview process", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "");
    const response = await post();
    expect(response.status).toBe(200);
    expect(request).toHaveBeenCalledOnce();
  });
});
