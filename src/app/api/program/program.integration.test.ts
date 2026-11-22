import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { GET as program } from "@/app/api/program/[slug]/route";
import { createMerchant } from "@/lib/product";
import { withEnv } from "@/lib/wallet/test-support";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE'); });
afterAll(async () => { await pool.end(); });

async function shop(name: string) {
  const owner = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [owner, name, `${owner}@example.test`]);
  return createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", programType: "stamp", rulesText: "Eine Einheit pro Kauf.", rewardTitle: "Kaffee", rewardCost: 5 });
}
const get = (slug: string, address = "198.51.100.40") => program(new Request(`http://localhost:3000/api/program/${slug}`, { headers: { "cf-connecting-ip": address } }), { params: Promise.resolve({ slug }) });
const read = async (slug: string) => (await get(slug)).json();

describe("the public programme tells the join page about Wallet (ENG-130)", () => {
  it("says walletMessages only while the surface is on in production", async () => {
    const { programSlug } = await shop("Surface Café");
    await withEnv({ PRODUCTION_ENVIRONMENT: "loynara-production", TRUSTED_INGRESS: "cloudflare_tunnel", WALLET_MESSAGES_ENABLED: undefined }, async () => {
      expect(await read(programSlug)).toMatchObject({ walletMessages: false });
    });
    await withEnv({ PRODUCTION_ENVIRONMENT: "loynara-production", TRUSTED_INGRESS: "cloudflare_tunnel", WALLET_MESSAGES_ENABLED: "true" }, async () => {
      expect(await read(programSlug)).toMatchObject({ walletMessages: true });
    });
  });
  it("says appleWallet only for the location that can issue an Apple pass", async () => {
    const bound = await shop("Bound Café"), other = await shop("Other Café");
    // PassFast's Apple template is bound to one location only; native Apple issuance is off.
    await withEnv({ APPLE_WALLET_ENABLED: "false", PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111",
      PASSFAST_WALLET_TYPES: "apple", PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: bound.tenantId, locationId: bound.locationId, templateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]) }, async () => {
      expect(await read(bound.programSlug)).toMatchObject({ appleWallet: true });
      expect(await read(other.programSlug)).toMatchObject({ appleWallet: false });
    });
  });
});

describe("the public programme read is paced per address", () => {
  it("refuses a flood from one address and keeps serving another", async () => {
    const { programSlug } = await shop("Paced Café");
    await withEnv({ TRUSTED_INGRESS: "cloudflare_tunnel" }, async () => {
      for (let i = 0; i < 240; i++) await get(programSlug, "198.51.100.41");
      expect((await get(programSlug, "198.51.100.41")).status).toBe(429);
      expect((await get(programSlug, "198.51.100.42")).status).toBe(200);
    });
  });
});
