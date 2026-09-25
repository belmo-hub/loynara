import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionUserMock, selectAudienceMock } = vi.hoisted(() => ({ sessionUserMock: vi.fn(), selectAudienceMock: vi.fn() }));
vi.mock("@/lib/http", () => ({
  sessionUser: sessionUserMock,
  respondError: (cause: unknown) => {
    const error = cause as { code?: string; issues?: unknown[] };
    const status = error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.issues ? 400 : 500;
    return Response.json({ error: "Request failed" }, { status });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/segments", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/segments")>();
  return { audienceDefinitionSchema: actual.audienceDefinitionSchema, selectAudienceBySlug: selectAudienceMock };
});

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserMock.mockResolvedValue({ id: "synthetic-owner" });
  selectAudienceMock.mockResolvedValue({ total: 7, membershipIds: ["private-card-id"], nextCursor: null, asOf: "2030-01-31T12:00:00.000Z", countingRule: "Distinct confirmed checkouts" });
});

describe("merchant audience preview route", () => {
  it("uses the signed-in actor and returns only an audience count", async () => {
    const response = await GET(new Request("http://localhost:3000/api/merchant/audiences/preview?programSlug=synthetic-card&kind=frequent_visitors&withinDays=30&minCheckouts=3"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(selectAudienceMock).toHaveBeenCalledWith({ actorUserId: "synthetic-owner", programSlug: "synthetic-card", definition: { kind: "frequent_visitors", withinDays: 30, minCheckouts: 3 }, limit: 1 });
    const body = await response.json();
    expect(body).toEqual({ total: 7, asOf: "2030-01-31T12:00:00.000Z", countingRule: "Distinct confirmed checkouts" });
    expect(JSON.stringify(body)).not.toContain("private-card-id");
  });

  it("rejects invalid audience controls before service access", async () => {
    const response = await GET(new Request("http://localhost:3000/api/merchant/audiences/preview?programSlug=synthetic-card&kind=frequent_visitors&withinDays=30&minCheckouts=0"));
    expect(response.status).toBe(400);
    expect(selectAudienceMock).not.toHaveBeenCalled();
  });

  it("requires a session and passes permission denial from the service", async () => {
    sessionUserMock.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    const request = () => new Request("http://localhost:3000/api/merchant/audiences/preview?programSlug=synthetic-card&kind=new&withinDays=7");
    expect((await GET(request())).status).toBe(401);
    expect(selectAudienceMock).not.toHaveBeenCalled();
    selectAudienceMock.mockRejectedValueOnce({ code: "FORBIDDEN" });
    expect((await GET(request())).status).toBe(403);
  });
});
