import { beforeEach, describe, expect, it, vi } from "vitest";

const { sessionUserMock, requireSameOriginMock, listMock, upsertMock } = vi.hoisted(() => ({ sessionUserMock: vi.fn(), requireSameOriginMock: vi.fn(), listMock: vi.fn(), upsertMock: vi.fn() }));
vi.mock("@/lib/http", () => ({
  sessionUser: sessionUserMock, requireSameOrigin: requireSameOriginMock, jsonBody: (request: Request) => request.json(),
  respondError: (cause: unknown) => {
    const error = cause as { code?: string; issues?: unknown[] };
    return Response.json({ error: "Request failed" }, { status: error.code === "UNAUTHENTICATED" ? 401 : error.code === "FORBIDDEN" ? 403 : error.issues ? 400 : 500 });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/automations", () => ({ listAutomations: listMock, upsertAutomationRule: upsertMock }));

import { GET, POST } from "./route";

const url = "http://localhost:3000/api/merchant/automations";
const valid = { programSlug: "synthetic-card", triggerKind: "inactive", enabled: true, subject: "Synthetic subject", body: "Synthetic local message", inactivityDays: 30, cooldownDays: 7, dailyCap: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  sessionUserMock.mockResolvedValue({ id: "signed-in-owner" });
  listMock.mockResolvedValue({ rules: [], runs: [], localOnly: true });
  upsertMock.mockResolvedValue({ id: "rule-id", enabled: true });
});

describe("merchant automation route", () => {
  it("binds list and mutation to the session identity, not request-supplied actor", async () => {
    const get = await GET(new Request(`${url}?programSlug=synthetic-card`));
    expect(get.status).toBe(200);
    expect(get.headers.get("Cache-Control")).toBe("no-store");
    expect(listMock).toHaveBeenCalledWith({ actorUserId: "signed-in-owner", programSlug: "synthetic-card" });
    const post = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify(valid) }));
    expect(post.status).toBe(200);
    expect(requireSameOriginMock).toHaveBeenCalledOnce();
    expect(upsertMock).toHaveBeenCalledWith({ actorUserId: "signed-in-owner", ...valid });
  });

  it("rejects absent sessions and unbounded or forged inputs", async () => {
    sessionUserMock.mockRejectedValueOnce({ code: "UNAUTHENTICATED" });
    expect((await GET(new Request(`${url}?programSlug=synthetic-card`))).status).toBe(401);
    const bad = await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...valid, actorUserId: "forged" }) }));
    expect(bad.status).toBe(400);
    expect(upsertMock).not.toHaveBeenCalled();
    requireSameOriginMock.mockImplementationOnce(() => { throw { code: "FORBIDDEN" }; });
    expect((await POST(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(valid) }))).status).toBe(403);
  });
});
