import { afterAll, beforeAll, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "@/lib/auth";
import { createMerchant } from "@/lib/product";
import { POST } from "./route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// Every location's programme shares one hourly join budget. It must hold 20 visitor addresses' worth of joins
// (20 x 25 = 500 new cards in an hour), so a busy shop has headroom and blocking it takes at least 20 addresses.
const origin = "http://localhost:3000";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED, production: process.env.PRODUCTION_ENVIRONMENT };
let slug = "";
beforeAll(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  delete process.env.PRODUCTION_ENVIRONMENT;
  const owner = await auth.api.signUpEmail({ body: { name: "Join limit owner", email: "join-limit-owner@example.test", password: "synthetic-join-limit-password" } });
  slug = (await createMerchant({ userId: owner.user.id, businessName: "Busy café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Busy", programType: "stamp", rulesText: "One stamp per coffee", rewardTitle: "Coffee", rewardCost: 5 })).programSlug;
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: previous.ingress, PUBLIC_REGISTRATION_ENABLED: previous.registration, PRODUCTION_ENVIRONMENT: previous.production })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});
const join = (ip: string) => POST(new Request(`${origin}/api/enroll`, {
  method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ slug, acceptedTerms: true }),
}));

it("lets 20 addresses' worth of guests join one programme within the hour, then refuses the next", async () => {
  const statuses: number[] = [];
  for (let address = 1; address <= 20; address += 1) {
    for (let guest = 0; guest < 25; guest += 1) statuses.push((await join(`203.0.113.${address}`)).status);
  }
  expect(statuses.filter(status => status === 201)).toHaveLength(500);
  const next = await join("198.51.100.21");
  expect(next.status).toBe(429);
  expect(Number(next.headers.get("retry-after"))).toBeGreaterThan(0);
}, 120_000);
