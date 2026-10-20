import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ handler: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("better-auth/next-js", () => ({ toNextJsHandler: () => ({ GET: state.handler, POST: state.handler }) }));
vi.mock("@/lib/operational-signals", () => ({ recordOperationalEvent: state.record }));
vi.mock("@/lib/rate-limit", () => ({ peerIdentity: () => "synthetic", enforcePeerLimit: async () => {} }));
vi.mock("@/lib/http", () => ({ respondError: () => { state.record("request_error"); return Response.json({ error: "Internal error" }, { status: 500 }); } }));
import { GET, POST } from "../app/api/auth/[...all]/route";
afterEach(() => vi.clearAllMocks());
it.each([GET, POST])("counts native auth rate limits without collecting the request", async handler => {
  state.handler.mockResolvedValue(new Response(null, { status: 429 }));
  expect((await handler(new Request("https://example.test/api/auth/session?token=synthetic-private"))).status).toBe(429);
  expect(state.record.mock.calls).toEqual([["rate_limit"]]);
});
it.each([GET, POST])("counts returned auth server failures", async handler => {
  state.handler.mockResolvedValue(new Response(null, { status: 503 }));
  await handler(new Request("https://example.test/api/auth/session"));
  expect(state.record.mock.calls).toEqual([["request_error"]]);
});
it("handles asynchronous POST rejection at the generic error boundary", async () => {
  state.handler.mockRejectedValue(new Error("synthetic-secret"));
  const response = await POST(new Request("https://example.test/api/auth/session", { method: "POST" }));
  expect(response.status).toBe(500);
  expect(await response.text()).not.toContain("synthetic-secret");
  expect(state.record.mock.calls).toEqual([["request_error"]]);
});
it("does not count expected authentication refusals as server failures", async () => {
  state.handler.mockResolvedValue(new Response(null, { status: 401 }));
  await POST(new Request("https://example.test/api/auth/session", { method: "POST" }));
  expect(state.record).not.toHaveBeenCalled();
});
