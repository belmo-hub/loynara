import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function request(path: string, method = "GET", host = "mail-events.getloynara.com") {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host } });
}

describe("Mailgun callback hostname isolation", () => {
  it("allows only POST to the exact webhook path", () => {
    expect(proxy(request("/api/email/mailgun/webhook", "POST")).status).toBe(200);
    for (const path of ["/", "/api/health", "/api/email/mailgun/webhook/extra", "/merchant", "/card/private-token"]) {
      expect(proxy(request(path, "POST")).status).toBe(404);
    }
    expect(proxy(request("/api/email/mailgun/webhook", "GET")).status).toBe(404);
  });

  it("leaves the Access-protected preview hostname on its existing route", () => {
    expect(proxy(request("/merchant", "GET", "preview.getloynara.com")).status).toBe(200);
  });
});
