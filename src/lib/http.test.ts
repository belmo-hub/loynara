import { describe, expect, it } from "vitest";
import { jsonBody } from "./http";

describe("bounded JSON request bodies", () => {
  it("rejects an advertised oversized body before reading the stream", async () => {
    const request = new Request("http://localhost/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1001" },
      body: "{}",
    });
    await expect(jsonBody(request, 1000)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(request.bodyUsed).toBe(false);
  });

  it("stops reading when a chunked body crosses the limit", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"value":"'));
        controller.enqueue(new TextEncoder().encode("x".repeat(100)));
      },
      cancel() { cancelled = true; },
    });
    const request = new Request("http://localhost/api/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    await expect(jsonBody(request, 20)).rejects.toMatchObject({ code: "TOO_LARGE" });
    expect(cancelled).toBe(true);
  });

  it("accepts valid JSON exactly within its byte limit", async () => {
    const request = new Request("http://localhost/api/enroll", { method: "POST", headers: { "content-type": "application/json" }, body: '{"ok":true}' });
    await expect(jsonBody(request, 11)).resolves.toEqual({ ok: true });
  });
});
