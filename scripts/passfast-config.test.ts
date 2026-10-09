import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "./config-check";
import { productionWalletRuntimeIssues } from "./wallet-runtime-config";
import { walletAvailability } from "../src/lib/wallet/capability";
const safe = { NODE_ENV: "production" as const, PRODUCTION_ENVIRONMENT: "loynara-production", PRODUCTION_APPROVED_ORIGIN: "https://app.owned-domain.org", DATABASE_URL: "postgresql://fixture:fixture-only@db.railway.internal/loynara", BETTER_AUTH_URL: "https://app.owned-domain.org", PUBLIC_BASE_URL: "https://app.owned-domain.org", BETTER_AUTH_SECRET: "fixture-auth-".repeat(4), SMTP_HOST:"disabled", PG_POOL_MAX:"5", TRUSTED_INGRESS:"cloudflare_tunnel" };
// Deliberately fake key; never sent to any provider.
const on = { ...safe, PASSFAST_ENABLED:"true", WALLET_PRODUCTION_APPROVED:"true", PASSFAST_API_KEY:"sk_live_"+"abcdef0123456789".repeat(4), PASSFAST_APP_ID:"11111111-1111-4111-8111-111111111111", PASSFAST_TEMPLATE_ID:"22222222-2222-4222-8222-222222222222", PASSFAST_TENANT_TEMPLATES:JSON.stringify([{tenantId:"33333333-3333-4333-8333-333333333333",locationId:"44444444-4444-4444-8444-444444444444",templateId:"22222222-2222-4222-8222-222222222222"}]) };
describe("canonical PassFast configuration and private capability",()=>{
  it("keeps every provider off by default",()=>{
    expect(walletAvailability(safe)).toEqual({apple:"unavailable",google:"unavailable"});
    expect(productionConfigIssues(safe)).toEqual([]);
  });
  it("accepts complete approved managed-provider declarations without native materials",()=>{
    expect(productionConfigIssues(on)).toEqual([]);
    expect(productionWalletRuntimeIssues(on)).toEqual([]);
    expect(walletAvailability(on,"33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444")).toEqual({apple:"available",google:"unavailable"});
  });
  it.each(["PASSFAST_API_KEY","PASSFAST_APP_ID","PASSFAST_TENANT_TEMPLATES","WALLET_PRODUCTION_APPROVED"])("fails closed without %s",name=>{
    const env={...on,[name]:""};
    expect(productionConfigIssues(env).length).toBeGreaterThan(0);
    expect(productionWalletRuntimeIssues(env).length).toBeGreaterThan(0);
    expect(walletAvailability(env)).toEqual({apple:"unavailable",google:"unavailable"});
  });
  it.each(["TRUE","1","yes",""])("rejects ambiguous flag %s",flag=>{
    expect(productionConfigIssues({...on,PASSFAST_ENABLED:flag}).length).toBeGreaterThan(0);
  });
  it("rejects reused, fixture, publishable and unknown-platform configuration",()=>{
    for(const extra of [{PASSFAST_API_KEY:on.BETTER_AUTH_SECRET},{PASSFAST_API_KEY:"sk_live_synthetic_0123456789abcdef0123456789"},{PASSFAST_API_KEY:"pk_live_"+"abcdef0123456789".repeat(4)},{PASSFAST_WALLET_TYPES:"all"}]) expect(productionConfigIssues({...on,...extra}).length).toBeGreaterThan(0);
  });
  it("separates platform availability without disclosing setup",()=>{
    expect(walletAvailability({...on,PASSFAST_WALLET_TYPES:"apple"},"33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444")).toEqual({apple:"available",google:"unavailable"});
    expect(JSON.stringify(walletAvailability(on,"33333333-3333-4333-8333-333333333333","44444444-4444-4444-8444-444444444444"))).not.toContain("PASSFAST");
  });
  it("production uses only the allowlist, with no global-template fallback",()=>{
    expect(productionConfigIssues({...on,PASSFAST_TEMPLATE_ID:""})).toEqual([]);
    expect(walletAvailability({...on,PASSFAST_TENANT_TEMPLATES:undefined})).toEqual({apple:"unavailable",google:"unavailable"});
  });
  it("requires independent Google Direct setup while native Apple stays dormant",()=>{
    expect(productionConfigIssues({...on,APPLE_WALLET_ENABLED:"true"})).toEqual(expect.arrayContaining([expect.stringMatching(/dormant/)]));
    expect(productionConfigIssues({...on,GOOGLE_WALLET_ENABLED:"true"})).toEqual(expect.arrayContaining([expect.stringMatching(/GOOGLE_DIRECT/)]));
  });
});
