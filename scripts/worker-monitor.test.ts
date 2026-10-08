import { describe, expect, it } from "vitest";

describe("independent bounded worker monitoring", () => {
  it("keeps sending heartbeats during an active long job and stops cleanly", async () => {
    const implementation = await import("./worker-monitor").catch(() => null);
    expect(implementation?.startWorkerMonitor).toBeTypeOf("function");
    const beats: number[] = [];
    const stop = implementation!.startWorkerMonitor({ intervalMs: 15, timeoutMs: 30, heartbeat: async () => { beats.push(Date.now()); } });
    await new Promise(resolve => setTimeout(resolve, 100));
    await stop();
    expect(beats.length).toBeGreaterThanOrEqual(4);
    const count = beats.length;
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(beats).toHaveLength(count);
  });
  it("fails closed on a stalled heartbeat without overlapping monitor operations", async () => {
    const implementation = await import("./worker-monitor").catch(() => null);
    expect(implementation?.startWorkerMonitor).toBeTypeOf("function");
    let beats = 0, failed = false;
    const stop = implementation!.startWorkerMonitor({ intervalMs: 10, timeoutMs: 25, heartbeat: async () => { beats++; await new Promise(() => {}); }, onFailure: () => { failed = true; } });
    await new Promise(resolve => setTimeout(resolve, 80));
    await stop();
    expect(failed).toBe(true);
    expect(beats).toBe(1);
  });
  it("aborts monitor cleanup promptly during shutdown so it cannot extend the Wallet job deadline", async () => {
    const { startWorkerMonitor } = await import("./worker-monitor");
    let aborted = false;
    const stop = startWorkerMonitor({ timeoutMs: 200, heartbeat: async (signal: AbortSignal) => {
      signal.addEventListener("abort", () => { aborted = true; });
      await new Promise(() => {});
    } });
    await new Promise(resolve => setTimeout(resolve, 10));
    const stopped = stop();
    expect(await Promise.race([stopped.then(() => true), new Promise(resolve => setTimeout(() => resolve(false),30))])).toBe(true);
    expect(aborted).toBe(true);
  });

});
