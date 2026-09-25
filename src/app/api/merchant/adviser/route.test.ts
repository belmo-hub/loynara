import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionUserMock, getAdviceMock } = vi.hoisted(() => ({ sessionUserMock: vi.fn(), getAdviceMock: vi.fn() }));
vi.mock("@/lib/http", () => ({
  sessionUser: sessionUserMock,
  respondError: (cause: unknown) => {
    const code = (cause as { code?: string }).code;
    return Response.json({ code: code ?? "INVALID_WINDOW" }, { status: code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 400 });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/adviser", () => ({ getMerchantAdvice: getAdviceMock }));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserMock.mockResolvedValue({ id: "synthetic-owner" });
  getAdviceMock.mockResolvedValue({ mode: "rule_based", recommendations: [], metrics: { currentActiveCards: 0 } });
});

describe("merchant adviser route", () => {
  it("uses the signed-in actor, restricts report windows and returns no-store rule-based advice", async () => {
    const response = await GET(new Request("http://localhost:3000/api/merchant/adviser?window=90"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(getAdviceMock).toHaveBeenCalledWith("synthetic-owner", { windowDays: 90 });
    expect(await response.json()).toMatchObject({ mode: "rule_based" });
  });

  it("rejects invalid windows and does not expose a model invocation option", async () => {
    expect((await GET(new Request("http://localhost:3000/api/merchant/adviser?window=365"))).status).toBe(400);
    expect(getAdviceMock).not.toHaveBeenCalled();
    const response = await GET(new Request("http://localhost:3000/api/merchant/adviser?window=30&model=true"));
    expect(response.status).toBe(200);
    expect(getAdviceMock).toHaveBeenCalledWith("synthetic-owner", { windowDays: 30 });
  });

  it("rejects missing sessions and service permission denials", async () => {
    sessionUserMock.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const request = () => new Request("http://localhost:3000/api/merchant/adviser");
    expect((await GET(request())).status).toBe(401);
    expect(getAdviceMock).not.toHaveBeenCalled();
    getAdviceMock.mockRejectedValueOnce({ code: "FORBIDDEN" });
    expect((await GET(request())).status).toBe(403);
  });
});
