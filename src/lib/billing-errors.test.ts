import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DomainError } from "./loyalty";
import { RateLimitError } from "./rate-limit";

const { checkout, overview } = vi.hoisted(() => ({ checkout: vi.fn(), overview: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => ({ user: { id: "synthetic-owner" } }) } } }));
vi.mock("@/lib/rate-limit", async original => ({ ...await original<typeof import("./rate-limit")>(), enforcePeerLimit: vi.fn(), enforceRateLimit: vi.fn() }));
vi.mock("@/lib/stripe-config", () => ({ stripeEnabled: () => true }));
vi.mock("@/lib/billing-stripe", () => ({ createStripeCheckout: checkout }));
vi.mock("@/lib/billing", () => ({ createFixtureHandoff: vi.fn(), getBillingOverview: overview }));

import { POST as handoff } from "@/app/api/merchant/billing/handoff/route";
import { GET as read } from "@/app/api/merchant/billing/route";
import { BILLING_FALLBACK_TEXT } from "./billing-errors";

const post = () => handoff(new Request("http://localhost:3000/api/merchant/billing/handoff", { method: "POST", headers: { origin: "http://localhost:3000" } }));
const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
const logged = () => log.mock.calls.map(args => args.join(" ")).join("\n");

beforeEach(() => { vi.clearAllMocks(); process.env.PUBLIC_BASE_URL = "http://localhost:3000"; process.env.BETTER_AUTH_URL = "http://localhost:3000"; });
afterEach(() => { delete process.env.PUBLIC_BASE_URL; delete process.env.BETTER_AUTH_URL; });

describe("owner billing errors are German; the detail stays in the log (ENG-072)", () => {
  it("a Stripe failure: 502, one German line, Stripe's status and code only in the log", async () => {
    checkout.mockRejectedValue(new DomainError("PROVIDER_ERROR", "Stripe request failed (402, card_declined)"));
    const response = await post();
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body).toEqual({ error: BILLING_FALLBACK_TEXT, code: "PROVIDER_ERROR" });
    expect(JSON.stringify(body)).not.toMatch(/stripe|request failed|card_declined/i);
    expect(logged()).toContain("PROVIDER_ERROR: Stripe request failed (402, card_declined)");
  });

  it("an unexpected crash and an unparseable provider answer: never „Internal error“ or field lists for the owner", async () => {
    checkout.mockRejectedValue(new TypeError("Cannot read properties of undefined (reading 'url')"));
    const crash = await post();
    expect(crash.status).toBe(500);
    expect(await crash.json()).toEqual({ error: BILLING_FALLBACK_TEXT });
    const parse = z.object({ url: z.string() }).safeParse({ url: 42 });
    checkout.mockRejectedValue(parse.error);
    const odd = await post();
    expect(odd.status).toBe(502);
    expect(await odd.json()).toEqual({ error: BILLING_FALLBACK_TEXT });
    expect(logged()).toContain("unexpected provider response at url");
    expect(logged()).not.toContain("42");
  });

  it.each([
    ["BILLING_STATE", "A fixture checkout is unavailable in this state", 409, "Der Stand hat sich gerade geändert. Bitte lade die Seite neu."],
    ["PLAN_UNAVAILABLE", "No location plan available", 400, "Dein Tarif wird noch festgelegt. Danach kannst du das Abo hier abschließen."],
    ["BILLING_DISABLED", "Live billing is unavailable", 400, "Die Online-Zahlung ist gerade nicht verfügbar. Bitte versuch es später noch einmal."],
    ["PLAN_MISCONFIGURED", "The Stripe price does not match the plan", 400, BILLING_FALLBACK_TEXT],
  ])("%s keeps its status and says it in German", async (code, internal, status, text) => {
    checkout.mockRejectedValue(new DomainError(code, internal));
    const response = await post();
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: text, code });
    expect(logged()).toContain(`${code}: ${internal}`);
  });

  it("expected answers stay quiet in the log; a rate limit keeps the client's German 429 and its Retry-After", async () => {
    checkout.mockRejectedValue(new DomainError("FORBIDDEN", "Active owner access required"));
    const forbidden = await post();
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({ error: "Nur Inhaber:innen können Abrechnungsdaten sehen.", code: "FORBIDDEN" });
    checkout.mockRejectedValue(new RateLimitError(30));
    const limited = await post();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("30");
    expect(log).not.toHaveBeenCalled();
  });

  it("the page read says „Subscription not found“ only to the log", async () => {
    overview.mockRejectedValue(new DomainError("NOT_FOUND", "Subscription not found"));
    const response = await read(new Request("http://localhost:3000/api/merchant/billing"));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Dieser Eintrag ist nicht mehr da. Bitte lade die Seite neu.", code: "NOT_FOUND" });
    expect(logged()).toContain("NOT_FOUND: Subscription not found");
  });
});
