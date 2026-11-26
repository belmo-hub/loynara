import { existsSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hiddenSurfaces, surfaceHidden } from "./pilot-surfaces";
import { stripeEnabled } from "./stripe-config";

const PROD = { PRODUCTION_ENVIRONMENT: "loynara-production" };
const digestOf = (fn: () => unknown) => { try { fn(); } catch (error) { return String((error as { digest?: string }).digest ?? "OTHER"); } return "NONE"; };

describe("pilot surfaces follow the canonical production definition", () => {
  it("hides billing, campaigns, automations, audiences, the cancel card, wallet previews, the logo upload and the NFC card on real production", () => {
    expect(hiddenSurfaces(PROD).sort()).toEqual(["audiences", "automations", "billing", "campaigns", "cancellation", "cardLogo", "nfc", "shopSearch", "walletMessages", "walletPreviews"]);
    expect(hiddenSurfaces({ NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production" }).length).toBe(10);
    // device-test / preview (NODE_ENV=production without the marker) and development keep every surface that does not depend on NFC keys
    expect(hiddenSurfaces({ NODE_ENV: "production" })).toEqual(["nfc", "shopSearch"]);
    expect(hiddenSurfaces({ NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "device-test" })).toEqual(["nfc", "shopSearch"]);
    expect(hiddenSurfaces({ NODE_ENV: "development" })).toEqual(["nfc", "shopSearch"]);
    expect(hiddenSurfaces({ NODE_ENV: "development", TAP_SYNTHETIC_KEY_FILE: "/x/keys.json" })).toEqual(["shopSearch"]);
    // The shop search in setup follows its key, everywhere (ENG-323).
    expect(hiddenSurfaces({ ...PROD, GOOGLE_MAPS_API_KEY: "synthetic" })).not.toContain("shopSearch");
    expect(surfaceHidden("billing", PROD)).toBe(true);
    expect(surfaceHidden("billing", {})).toBe(false);
    // Live billing is the founder's switch on real production (the production gate requires the whole Stripe group with it).
    expect(surfaceHidden("billing", { ...PROD, LIVE_BILLING_ENABLED: "true" })).toBe(false);
    expect(surfaceHidden("billing", { ...PROD, LIVE_BILLING_ENABLED: "TRUE" })).toBe(true);
    // stripeEnabled relies on this: whenever Stripe may run, the billing surface is shown (synthetic placeholders, no real key).
    const stripe = { LIVE_BILLING_ENABLED: "true", STRIPE_WEBHOOK_SECRET: `whsec_${"y".repeat(32)}`, STRIPE_PRICE_LIST: "price_list00000001", STRIPE_PRICE_TERMIN: "price_termin000001" };
    for (const env of [{ ...PROD, ...stripe, STRIPE_SECRET_KEY: `sk_live_${"x".repeat(24)}`, BILLING_PRODUCTION_APPROVED: "true", BILLING_VAT_MODE: "kleinunternehmer" }, { ...stripe, STRIPE_SECRET_KEY: `sk_test_${"x".repeat(24)}` }]) {
      expect(stripeEnabled(env)).toBe(true);
      expect(surfaceHidden("billing", env)).toBe(false);
    }
    expect(stripeEnabled({ ...stripe, STRIPE_SECRET_KEY: `sk_live_${"x".repeat(24)}` })).toBe(false);
    // On real production the founder's approval is the second switch: without it Stripe never runs.
    expect(stripeEnabled({ ...PROD, ...stripe, STRIPE_SECRET_KEY: `sk_live_${"x".repeat(24)}` })).toBe(false);
    // The owner's cancel card is withheld on real production only; every other process offers it.
    expect(surfaceHidden("cancellation", PROD)).toBe(true);
    expect(surfaceHidden("cancellation", {})).toBe(false);
    expect(surfaceHidden("cancellation", { NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "device-test" })).toBe(false);
  });
});

describe("the NFC surface follows capability", () => {
  const MASTER = "7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
  it("appears on real production exactly when NFC is enabled with the derived key provider, and then no other surface changes", () => {
    const configured = { ...PROD, NFC_ENABLED: "true", NFC_KEY_PROVIDER: "derived_v1", NFC_VERIFY_MASTER_KEY: MASTER };
    expect(hiddenSurfaces(configured).sort()).toEqual(["audiences", "automations", "billing", "campaigns", "cancellation", "cardLogo", "shopSearch", "walletMessages", "walletPreviews"]);
    expect(hiddenSurfaces({ ...configured, NFC_ENABLED: "false" })).toContain("nfc");
    expect(hiddenSurfaces({ ...configured, NFC_VERIFY_MASTER_KEY: "bad" })).toContain("nfc");
    expect(hiddenSurfaces({ ...PROD, NFC_ENABLED: "true", TAP_SYNTHETIC_KEY_FILE: "/x" })).toContain("nfc");
  });
});

describe("Wallet surfaces follow capability", () => {
  it("appear on real production only once a Wallet provider can issue a pass", async () => {
    const { appleFixture } = await import("./wallet/test-support");
    const apple = appleFixture();
    try {
      expect(hiddenSurfaces({ ...PROD, APPLE_WALLET_ENABLED: "true" })).toEqual(expect.arrayContaining(["walletPreviews", "cardLogo"]));
      expect(hiddenSurfaces({ ...PROD, ...apple.env }).sort()).toEqual(["audiences", "automations", "billing", "campaigns", "cancellation", "nfc", "shopSearch", "walletMessages"]);
    } finally { apple.cleanup(); }
  });
});

describe("direct routes for withheld surfaces", () => {
  afterEach(() => vi.unstubAllEnvs());
  const layouts = { billing: "@/app/merchant/billing/layout", campaigns: "@/app/merchant/campaigns/layout", automations: "@/app/merchant/automations/layout", audiences: "@/app/merchant/audiences/layout" };
  for (const [surface, path] of Object.entries(layouts)) {
    it(`${surface}: 404 on real production, available in development and on a device-test process`, async () => {
      const { default: Layout } = await import(path);
      const render = () => Layout({ children: "content" });
      vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
      expect(digestOf(render)).toContain("404");
      vi.stubEnv("PRODUCTION_ENVIRONMENT", "device-test"); vi.stubEnv("NODE_ENV", "production");
      expect(render()).toBe("content");
      vi.stubEnv("PRODUCTION_ENVIRONMENT", ""); vi.stubEnv("NODE_ENV", "development");
      expect(render()).toBe("content");
    });
  }
});

describe("app root and registration page in the pilot", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("the production root redirects to the login page (no draft pricing is ever rendered)", async () => {
    const { default: Home } = await import("@/app/page");
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    const digest = digestOf(() => Home());
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/login");
  });
  it("outside production the root redirects to the login page too (the draft landing is gone)", async () => {
    const { default: Home } = await import("@/app/page");
    vi.stubEnv("PRODUCTION_ENVIRONMENT", ""); vi.stubEnv("NODE_ENV", "development");
    const digest = digestOf(() => Home());
    expect(digest).toContain("NEXT_REDIRECT");
    expect(digest).toContain("/login");
  });
  it("the sign-up page is offered only while registration is enabled", async () => {
    const { default: Layout } = await import("@/app/register/layout");
    vi.stubEnv("PUBLIC_REGISTRATION_ENABLED", "false");
    expect(digestOf(() => Layout({ children: "x" }))).toContain("/login");
    vi.stubEnv("PUBLIC_REGISTRATION_ENABLED", "true");
    expect(Layout({ children: "x" })).toBe("x");
  });
  it("the not-found pages exist", () => {
    expect(existsSync("src/app/not-found.tsx")).toBe(true);
    expect(existsSync("src/app/merchant/not-found.tsx")).toBe(true);
  });
});
