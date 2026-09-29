import { beforeEach, describe, expect, it, vi } from "vitest";

const { enforcePeerLimit, recordMailgunWebhook, TestRateLimitError } = vi.hoisted(() => ({ enforcePeerLimit: vi.fn(), recordMailgunWebhook: vi.fn(), TestRateLimitError: class extends Error {} }));
vi.mock("@/lib/http", () => ({ jsonBody: (request: Request) => request.json() }));
vi.mock("@/lib/rate-limit", () => ({ enforcePeerLimit, RateLimitError: TestRateLimitError }));
vi.mock("@/lib/transactional-email", () => ({ recordMailgunWebhook }));

import { POST } from "./route";

beforeEach(() => {
  enforcePeerLimit.mockReset();
  recordMailgunWebhook.mockReset();
});

describe("provider-facing Mailgun webhook route", () => {
  it("rate limits a public webhook request before reading its body", async () => {
    enforcePeerLimit.mockRejectedValue(new TestRateLimitError("limited"));
    const request = new Request("https://mail-events.getloynara.com/api/email/mailgun/webhook", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "sensitive@example.test" }),
    });
    const response = await POST(request);
    expect(response.status).toBe(429);
    expect(recordMailgunWebhook).not.toHaveBeenCalled();
  });
});

// Peer limiting is only the pre-auth resource bound; provider signatures remain authoritative.
it("valid ingress never substitutes for provider authentication", async () => {
  recordMailgunWebhook.mockResolvedValue({ accepted: false });
  const response = await POST(new Request("https://mail-events.getloynara.com/api/email/mailgun/webhook", {
    method: "POST", headers: { "content-type": "application/json", "cf-connecting-ip": "192.0.2.1" }, body: "{}",
  }));
  expect(response.status).toBe(406);
  expect(recordMailgunWebhook).toHaveBeenCalledOnce();
});
it("missing ingress identity cannot reach provider processing", async () => {
  enforcePeerLimit.mockRejectedValue(new Error("Invalid ingress metadata"));
  const response = await POST(new Request("https://mail-events.getloynara.com/api/email/mailgun/webhook", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }));
  expect(response.status).toBe(503);
  expect(recordMailgunWebhook).not.toHaveBeenCalled();
});
