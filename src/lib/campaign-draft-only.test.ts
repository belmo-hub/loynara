import { afterEach, describe, expect, it, vi } from "vitest";
import { promotionalEmailMode } from "./transactional-email";
import { hiddenSurfaces } from "./pilot-surfaces";

/**
 * Campaigns and audiences are visible in the pilot because, with the production configuration below, they can
 * only produce drafts and previews. These tests pin that: if the configuration or the mode logic drifts so that
 * delivery could become available, they fail before the surfaces are shown to a real merchant.
 */
const PRODUCTION = {
  NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "loynara-production", TRUSTED_INGRESS: "cloudflare_tunnel",
  PUBLIC_REGISTRATION_ENABLED: "false", STAFF_INVITE_SIGNUP_ENABLED: "true",
  EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false", MAILGUN_PROMOTIONAL_SEND_APPROVED: "false", MAILGUN_SEND_APPROVED: "false",
  SMTP_HOST: "localhost", DATABASE_URL: "postgresql://x@localhost:5432/looplocal", PUBLIC_BASE_URL: "http://localhost:3000",
} as const;

afterEach(() => vi.unstubAllEnvs());
const stub = (extra: Record<string, string> = {}) => { for (const [name, value] of Object.entries({ ...PRODUCTION, ...extra })) vi.stubEnv(name, value); };

describe("draft-only campaigns in the pilot", () => {
  it("shows campaigns and audiences but keeps automations hidden under the production configuration", () => {
    const hidden = hiddenSurfaces({ ...PRODUCTION });
    expect(hidden).not.toContain("campaigns");
    expect(hidden).not.toContain("audiences");
    expect(hidden).toContain("automations");
    expect(hidden).toContain("billing");
  });

  it("promotional delivery is disabled with the production configuration, even with local-looking hosts", () => {
    stub();
    expect(promotionalEmailMode()).toBe("disabled");
  });

  it("requested-but-unapproved or half-configured external delivery stays disabled", () => {
    stub({ PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true" });
    expect(promotionalEmailMode()).toBe("disabled");
    stub({ PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_PROMOTIONAL_SEND_APPROVED: "true", MAILGUN_SEND_APPROVED: "true" });
    expect(promotionalEmailMode()).toBe("disabled"); // no domain, key, secrets or limits: the safety chain is incomplete
  });

  it("a Mailgun key alone, without the explicit promotional approvals, does not enable delivery", () => {
    stub({ MAILGUN_EU_API_KEY: "key-synthetic", MAILGUN_EU_DOMAIN: "mg.example.eu", MAILGUN_FROM_EMAIL: "x@mg.example.eu", MAILGUN_EU_WEBHOOK_SIGNING_KEY: "s".repeat(32) });
    expect(promotionalEmailMode()).toBe("disabled");
  });
});
