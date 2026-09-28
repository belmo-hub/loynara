import { describe, expect, it, vi } from "vitest";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

describe("worker heartbeat", () => {
  it("requires an HTTPS monitor URL with no query or alternate host", () => {
    expect(validHeartbeatUrl("https://heartbeat.uptimerobot.com/m123-abc")).toBe(true);
    expect(validHeartbeatUrl("http://heartbeat.uptimerobot.com/m123-abc")).toBe(false);
    expect(validHeartbeatUrl("https://other.example/m123-abc")).toBe(false);
    expect(validHeartbeatUrl("https://heartbeat.uptimerobot.com/m123-abc?token=extra")).toBe(false);
  });
  it("sends only to the configured monitor and prints no URL on a network failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("secret URL in network error"));
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await sendWorkerHeartbeat("https://heartbeat.uptimerobot.com/m123-abc", request);
    expect(request).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.flat().join(" ")).not.toContain("m123-abc");
    log.mockRestore();
  });
});
