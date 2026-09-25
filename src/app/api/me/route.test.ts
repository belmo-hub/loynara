import { afterAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/http", () => ({
  sessionUser: async () => ({ id: "synthetic-owner" }),
  respondError: () => Response.json({ error: "Unavailable" }, { status: 500 }),
}));
vi.mock("@/lib/product", () => ({
  getMerchantContext: async () => ({ userId: "synthetic-owner", tenantId: "synthetic-tenant", programSlug: "demo-program", role: "owner" }),
}));

import { GET } from "./route";

const originalBaseUrl = process.env.PUBLIC_BASE_URL;
afterAll(() => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
  else process.env.PUBLIC_BASE_URL = originalBaseUrl;
});

describe("merchant origin handoff", () => {
  it("returns the configured HTTPS origin even when the private request arrives on loopback", async () => {
    process.env.PUBLIC_BASE_URL = "https://loyalty.owned-domain.org";
    const response = await GET(new Request("http://127.0.0.1:3002/api/me"));
    expect(response.status).toBe(200);
    expect((await response.json()).publicBaseUrl).toBe("https://loyalty.owned-domain.org");
  });

  it("does not fall back to the loopback request origin when configuration is missing", async () => {
    process.env.PUBLIC_BASE_URL = "";
    const response = await GET(new Request("http://127.0.0.1:3002/api/me"));
    expect(response.status).toBe(500);
  });
});
