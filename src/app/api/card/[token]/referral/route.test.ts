import { beforeEach, describe, expect, it, vi } from "vitest";
import { DomainError } from "@/lib/loyalty";

const { share } = vi.hoisted(() => ({ share: vi.fn() }));
vi.mock("@/lib/referrals", () => ({ getCardReferralShare: share }));
vi.mock("@/lib/rate-limit", async () => ({ ...(await vi.importActual<typeof import("@/lib/rate-limit")>("@/lib/rate-limit")), enforcePeerLimit: async () => undefined, enforceRateLimit: async () => undefined }));
import { GET } from "@/app/api/card/[token]/referral/route";

const call = () => GET(new Request("https://example.test/api/card/card_x/referral"), { params: Promise.resolve({ token: "card_x" }) });

describe("card referral endpoint", () => {
  beforeEach(() => { share.mockReset(); }); // braces: a returned function would be run as test cleanup
  it("answers a disabled programme with 200 and enabled:false (a normal state, no failed request)", async () => {
    share.mockImplementation(async () => { throw new DomainError("REFERRAL_DISABLED", "off"); });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: false });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("still returns the share when referrals are enabled", async () => {
    share.mockResolvedValue({ shareUrl: "https://example.test/join/x?ref=ref_1", referrerBonus: 2, referredBonus: 1, programType: "stamp" });
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ referrerBonus: 2 });
  });
  it("keeps real errors: an unknown or closed card is still 404", async () => {
    share.mockImplementation(async () => { throw new DomainError("NOT_FOUND", "Card not found"); });
    expect((await call()).status).toBe(404);
  });
});
