import { beforeEach, describe, expect, it, vi } from "vitest";
import { memberships } from "@/db/schema";
import { GET as download } from "@/app/api/wallet/apple/download/[ticket]/route";

const boundary = vi.hoisted(() => ({
  available: true,
  validTicket: true,
  member: { scanCode: "old-code", closedAt: null as Date | null },
  active: true,
  archive: vi.fn(),
  update: vi.fn(),
  select: vi.fn(),
}));

// All external boundaries are in memory: no credentials, network or database is used.
vi.mock("@/lib/auth", () => ({ auth: {} }));
vi.mock("@/db", () => ({
  pool: {},
  db: {
    transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      select: boundary.select,
      update: () => ({ set: () => ({ where: boundary.update }) }),
    }),
    update: () => ({ set: () => ({ where: boundary.update }) }),
  },
}));
vi.mock("@/lib/rate-limit", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/rate-limit")>(),
  enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn(),
}));
vi.mock("./capability", () => ({ walletAvailability: () => ({ apple: boundary.available ? "available" : "unavailable", google: "unavailable" }) }));
vi.mock("./ticket", () => ({ readDownloadTicket: () => boundary.validTicket ? { passId: "pass-1" } : null, TICKET_TTL_SECONDS: 120 }));
vi.mock("./issue", () => ({ activeApplePass: async () => ({ id: "pass-1", membershipId: "member-1", credentialHash: "old-code" }) }));
vi.mock("./data", () => ({
  credentialHash: (scanCode: string) => scanCode,
  walletCardSnapshot: async () => ({ open: true, credentialHash: "old-code", pass: { merchantName: "Synthetic Café" } }),
}));
vi.mock("./apple", () => ({
  appleSigningConfig: () => ({}), applePassJson: () => ({}), applePassArchive: boundary.archive,
}));

const request = (accept = "text/html") => new Request("https://synthetic.example.test/api/wallet/apple/download/opaque-ticket", { headers: { accept } });
const context = () => ({ params: Promise.resolve({ ticket: "opaque-ticket" }) });

beforeEach(() => {
  boundary.available = true;
  boundary.validTicket = true;
  boundary.member = { scanCode: "old-code", closedAt: null };
  boundary.active = true;
  boundary.archive.mockReset().mockResolvedValue(Buffer.from("signed-pass"));
  boundary.update.mockReset().mockResolvedValue(undefined);
  boundary.select.mockReset().mockImplementation(() => ({
    from: (table: unknown) => ({ where: () => table === memberships
      ? { for: async () => [boundary.member] }
      : Promise.resolve(boundary.active ? [{ id: "pass-1" }] : []) }),
  }));
});

describe("Apple download browser failures", () => {
  it.each(["disabled", "expired", "signing"])("keeps %s failure readable without credentials or diagnostics", async cause => {
    if (cause === "disabled") boundary.available = false;
    if (cause === "expired") boundary.validTicket = false;
    if (cause === "signing") boundary.archive.mockRejectedValue(new Error("private-signing-path.pem"));
    const response = await download(request(), context());
    expect(response.status).toBe(cause === "disabled" ? 503 : cause === "expired" ? 404 : 502);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const html = await response.text();
    expect(html).toContain("Zurück zur Karte");
    expect(html).toContain("history.back()");
    expect(html).not.toContain("opaque-ticket");
    expect(html).not.toContain("private-signing-path");
    expect(html).not.toContain("WALLET_PROVIDER_ERROR");
    expect(html).not.toMatch(/href=["'][^"']*\/card\//);
  });

  it("preserves JSON status/code for API downloads", async () => {
    boundary.validTicket = false;
    const response = await download(request("application/json"), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("Apple download rechecks the credential after signing", () => {
  it.each(["reissued", "closed", "revoked"])("refuses the archive when the card was %s during signing", async change => {
    boundary.archive.mockImplementation(async () => {
      if (change === "reissued") boundary.member.scanCode = "new-code";
      if (change === "closed") boundary.member.closedAt = new Date();
      if (change === "revoked") boundary.active = false;
      return Buffer.from("signed-with-retired-code");
    });
    const response = await download(request("application/json"), context());
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).not.toBe("application/vnd.apple.pkpass");
    expect(boundary.update).not.toHaveBeenCalled();
  });

  it("returns the pass when the credential is still current", async () => {
    const response = await download(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/vnd.apple.pkpass");
    expect(await response.text()).toBe("signed-pass");
    expect(boundary.update).toHaveBeenCalledOnce();
  });
});
