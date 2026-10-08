import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareAppleWallet, readWalletStatus } from "./wallet-preparation";
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("posts the bearer and waits for a fresh ready ticket without repeating issuance", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ status: "pending" }, { status: 202 }))
    .mockResolvedValueOnce(Response.json({ apple: "available", google: "unavailable", applePass: { status: "pending", retryAfterSeconds: 10 } }))
    .mockResolvedValueOnce(Response.json({ apple: "available", google: "unavailable", applePass: { status: "ready", url: "/api/wallet/apple/download/fresh" } }));
  vi.stubGlobal("fetch", fetcher);
  const task = prepareAppleWallet("synthetic-token", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(5000); expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(9999); expect(fetcher).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1); expect(await task).toBe("/api/wallet/apple/download/fresh");
  expect(fetcher.mock.calls.map(call => call[0])).toEqual(["/api/wallet/apple", "/api/wallet/status", "/api/wallet/status"]);
  for (const [, init] of fetcher.mock.calls) expect(init).toMatchObject({ method: "POST", body: JSON.stringify({ token: "synthetic-token" }), cache: "no-store", credentials: "same-origin" });
});
it("aborts polling on unmount and performs no late requests", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ status: "pending" }, { status: 202 })); vi.stubGlobal("fetch", fetcher);
  const abort = new AbortController(); const task = prepareAppleWallet("synthetic", abort.signal); const rejection = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(1); abort.abort(); await rejection; await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(1);
});
it("bounds a stalled HTTP request including response parsing", async () => {
  vi.stubGlobal("fetch", (_url: string, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(init.signal!.reason), { once: true })));
  const task = readWalletStatus("synthetic", new AbortController().signal); const rejection = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(20_000); await rejection;
});
it("ends failed preparation and caps never-ending pending polling", async () => {
  const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(url.endsWith("apple") ? { status: "pending" } : { applePass: { status: "pending", retryAfterSeconds: 60 } })));
  vi.stubGlobal("fetch", fetcher); const task = prepareAppleWallet("synthetic", new AbortController().signal); const rejection = expect(task).rejects.toThrow();
  await vi.advanceTimersByTimeAsync(300_000); await rejection; expect(fetcher.mock.calls.length).toBeLessThanOrEqual(7);
  fetcher.mockReset().mockResolvedValueOnce(Response.json({ status: "pending" })).mockResolvedValueOnce(Response.json({ applePass: { status: "failed" } }));
  const failed = prepareAppleWallet("synthetic", new AbortController().signal); const failure = expect(failed).rejects.toThrow(); await vi.advanceTimersByTimeAsync(5000); await failure; expect(fetcher).toHaveBeenCalledTimes(2);
});
