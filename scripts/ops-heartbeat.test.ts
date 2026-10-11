import { describe, expect, it, vi } from "vitest";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

describe("worker heartbeat", () => {
  it("requires an HTTPS monitor URL with no query or alternate host", () => {
    expect(validHeartbeatUrl("https://heartbeat.uptimerobot.com/m123-abc")).toBe(true);
    expect(validHeartbeatUrl("https://hc-ping.com/123e4567-e89b-42d3-a456-426614174000")).toBe(true);
    expect(validHeartbeatUrl("http://hc-ping.com/123e4567-e89b-42d3-a456-426614174000")).toBe(false);
    expect(validHeartbeatUrl("https://hc-ping.com/123e4567-e89b-42d3-a456-426614174000/fail")).toBe(false);
    expect(validHeartbeatUrl("https://hc-ping.com/123e4567-e89b-42d3-a456-426614174000?x=1")).toBe(false);
    expect(validHeartbeatUrl("https://hc-ping.com.evil.test/123e4567-e89b-42d3-a456-426614174000")).toBe(false);
    expect(validHeartbeatUrl("http://heartbeat.uptimerobot.com/m123-abc")).toBe(false);
    expect(validHeartbeatUrl("https://other.example/m123-abc")).toBe(false);
    expect(validHeartbeatUrl("https://heartbeat.uptimerobot.com/m123-abc?token=extra")).toBe(false);
  });
  it("sends only to the configured monitor and prints no URL on a network failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("secret URL in network error"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await sendWorkerHeartbeat("https://heartbeat.uptimerobot.com/m123-abc", request)).toBe(false);
    expect(request).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("m123-abc");
    log.mockRestore();
  });
  it("aborts a pending monitor request during worker shutdown", async () => {
    const controller = new AbortController();
    const request: typeof fetch = async (_input, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const pending = sendWorkerHeartbeat("https://heartbeat.uptimerobot.com/m123-abc", request, controller.signal);
    controller.abort();
    try {
      expect(await Promise.race([pending.then(() => true), new Promise(resolve => setTimeout(() => resolve(false),30))])).toBe(true);
    } finally { log.mockRestore(); }
  });

  it("reports acknowledgment only for a successful response; unset and rejected requests are not acknowledgments", async () => {
    const request = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    expect(await sendWorkerHeartbeat(undefined, request)).toBe(false);
    expect(request).not.toHaveBeenCalled();
    expect(await sendWorkerHeartbeat("https://heartbeat.uptimerobot.com/m123-abc", request)).toBe(true);
    request.mockResolvedValue(new Response("private provider body", { status: 403 }));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(await sendWorkerHeartbeat("https://heartbeat.uptimerobot.com/m123-abc", request)).toBe(false);
      expect(log.mock.calls).toEqual([["Worker heartbeat rejected by monitor"]]);
    } finally { log.mockRestore(); }
    await expect(sendWorkerHeartbeat("https://unapproved.example/token", request)).rejects.toThrow("Invalid worker heartbeat configuration");
    expect(request).toHaveBeenCalledTimes(2);
  });

});
