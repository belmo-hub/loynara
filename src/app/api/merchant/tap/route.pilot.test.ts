import { afterEach, describe, expect, it, vi } from "vitest";

// Real respondError and real setTapPolicy guard; only the session, origin and database edges are stubbed.
vi.mock("@/db", () => ({ db: { transaction: async () => ({ mode: "staff_confirmed", cooldownSeconds: 60 }) } }));
vi.mock("@/lib/http", async () => ({
  ...(await vi.importActual<typeof import("@/lib/http")>("@/lib/http")),
  requireSameOrigin: () => undefined,
  sessionUser: async () => ({ id: "00000000-0000-4000-8000-000000000001" }),
}));
vi.mock("@/lib/rate-limit", async () => ({ ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")), enforceRateLimit: async () => undefined }));
import { POST } from "./route";

const programId = "00000000-0000-4000-8000-000000000002";
const call = (mode: string) => POST(new Request("https://example.test/api/merchant/tap", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "policy", programId, mode, cooldownSeconds: mode === "disabled" ? null : 60 }) }));

describe("merchant tap route under the pilot policy", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("rejects automatic_fixed on the production deployment with a clear 400", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    const response = await call("automatic_fixed");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "TAP_AUTOMATIC_NOT_ALLOWED" });
  });

  it("rejects automatic_fixed with the production marker even when NODE_ENV is production too", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    vi.stubEnv("NODE_ENV", "production");
    expect((await call("automatic_fixed")).status).toBe(400);
  });

  it("does not reject automatic_fixed on a device-test process (NODE_ENV=production, no production marker)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect((await call("automatic_fixed")).status).toBe(200);
  });

  it("still accepts staff_confirmed and disabled on production", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect((await call("staff_confirmed")).status).toBe(200);
    expect((await call("disabled")).status).toBe(200);
  });

  it("does not reject automatic_fixed outside production (development and device tests)", async () => {
    expect((await call("automatic_fixed")).status).toBe(200);
  });
});
