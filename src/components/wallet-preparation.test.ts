import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { iphoneDevice, prepareAppleWallet, readWalletStatus, sheetOpened, waitForSheet } from "./wallet-preparation";
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
it("counts Apple's sheet as opened only when the server handed the pass out (ENG-172)", async () => {
  const signal = new AbortController().signal;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ apple: "available", google: "unavailable", appleDownloaded: true })));
  expect(await sheetOpened("synthetic", signal)).toBe(true);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ apple: "available", google: "unavailable", appleDownloaded: false })));
  expect(await sheetOpened("synthetic", signal)).toBe(false);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "RATE_LIMIT" }, { status: 429 })));
  expect(await sheetOpened("synthetic", signal)).toBe(false);
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
  expect(await sheetOpened("synthetic", signal)).toBe(false);
});
const status = (appleDownloaded: boolean) => () => Promise.resolve(Response.json({ apple: "available", google: "unavailable", appleDownloaded }));
it("keeps reading every 4 s until the pass was handed out, through a failed read (ENG-172)", async () => {
  const fetcher = vi.fn(status(false)).mockImplementationOnce(status(false)).mockImplementationOnce(() => Promise.reject(new TypeError("offline"))).mockImplementationOnce(status(true));
  vi.stubGlobal("fetch", fetcher);
  const task = waitForSheet("synthetic", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(3999); expect(fetcher).toHaveBeenCalledTimes(0);
  await vi.advanceTimersByTimeAsync(8001); expect(fetcher).toHaveBeenCalledTimes(3);
  expect(await task).toBe(true);
});
it("gives up after about 30 s with no further reads (ENG-172)", async () => {
  const fetcher = vi.fn(status(false)); vi.stubGlobal("fetch", fetcher);
  const task = waitForSheet("synthetic", new AbortController().signal);
  await vi.advanceTimersByTimeAsync(32_000); expect(await task).toBe(false); expect(fetcher).toHaveBeenCalledTimes(8);
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(8);
});
it("stops at once on a press or unmount, even with a yes on its way (ENG-172)", async () => {
  const fetcher = vi.fn(status(false)); vi.stubGlobal("fetch", fetcher);
  const press = new AbortController(); const task = waitForSheet("synthetic", press.signal);
  await vi.advanceTimersByTimeAsync(4000); press.abort(); expect(await task).toBe(false);
  await vi.advanceTimersByTimeAsync(60_000); expect(fetcher).toHaveBeenCalledTimes(1);
  let answer: (value: Response) => void = () => {}; vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { answer = resolve; })));
  const late = new AbortController(); const racing = waitForSheet("synthetic", late.signal);
  await vi.advanceTimersByTimeAsync(4000); late.abort(); answer(Response.json({ appleDownloaded: true }));
  expect(await racing).toBe(false);
});
it("opens the sheet by itself on an iPhone or iPod only, not on a touch iPad (ENG-172)", () => {
  for (const [userAgent, expected] of [["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", true], ["Mozilla/5.0 (iPod touch; CPU iPhone OS 12_0 like Mac OS X)", true], ["Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)", false], ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", false], ["Mozilla/5.0 (Linux; Android 15)", false]] as const) {
    vi.stubGlobal("navigator", { userAgent, maxTouchPoints: 5 });
    expect(iphoneDevice()).toBe(expected);
  }
});
