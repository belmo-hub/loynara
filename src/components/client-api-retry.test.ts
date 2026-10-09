import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson, ClientApiError } from "./client-api";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("rate-limit backoff supplied to waiting clients", () => {
  it("preserves the server's Retry-After seconds with the structured API error", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ code: "RATE_LIMIT", error: "Wait" }, { status: 429, headers: { "Retry-After": "8" } }));
    const error = await apiJson("/api/tap/status").catch(error => error);
    expect(error).toBeInstanceOf(ClientApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMIT", retryAfterMs: 8000 });
  });
  it("accepts an HTTP-date retry delay and ignores malformed or elapsed delays", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-09T12:00:00Z"));
    for (const [retry, delay] of [["Fri, 09 Oct 2026 12:00:10 GMT", 10000], ["nonsense", undefined], ["-8", undefined], ["Fri, 09 Oct 2026 11:00:00 GMT", undefined]] as const) {
      vi.stubGlobal("fetch", async () => Response.json({ code: "RATE_LIMIT" }, { status: 429, headers: { "Retry-After": retry } }));
      const error = await apiJson("/api/tap/status").catch(error => error);
      if (!(error instanceof ClientApiError)) throw error;
      expect(error.retryAfterMs).toBe(delay);
    }
  });
});
