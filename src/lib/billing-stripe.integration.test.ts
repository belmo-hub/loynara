import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingLocationPlans, billingWebhookEvents, programs, subscriptions } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { DomainError } from "./loyalty";
import { createMerchant } from "./product";
import { getBillingOverview } from "./billing";
import { applyStripeWebhook, createStripeCheckout, createStripePortal, runBillingJob, setStripeClient, setTenantPlan, STRIPE_STATUS, verifyStripeSignature, type StripeClient } from "./billing-stripe";
import { GUARANTEE_LINE, VAT_NOTE } from "./stripe-config";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Stripe billing tests require looplocal_test");

// Synthetic placeholders shaped like Stripe identifiers. No test ever reaches the Stripe API: the HTTP client refuses NODE_ENV=test.
const WEBHOOK_SECRET = `whsec_${"s".repeat(32)}`;
const STRIPE_ENV = { LIVE_BILLING_ENABLED: "true", STRIPE_SECRET_KEY: `sk_test_${"k".repeat(24)}`, STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET, STRIPE_PRICE_FOUNDING: "price_founding0001", STRIPE_PRICE_LIST: "price_list00000001", PUBLIC_BASE_URL: "http://localhost:3000" };
const saved: Record<string, string | undefined> = {};
const setEnv = (values: Record<string, string | undefined>) => { for (const [name, value] of Object.entries(values)) { if (!(name in saved)) saved[name] = process.env[name]; if (value === undefined) delete process.env[name]; else process.env[name] = value; } };

type FakeSub = { id: string; customer: string; status: keyof typeof STRIPE_STATUS; cancel_at_period_end: boolean; cancel_at: number | null; ended_at: number | null; start_date: number; metadata: { tenant_id: string }; items: { data: Array<{ id: string; quantity: number; current_period_end: number }> } };

/** An in-memory Stripe that answers only the calls the provider makes, and records them. */
function fakeStripe() {
  const calls: Array<{ method: string; path: string; params: Record<string, string>; key?: string }> = [];
  const subs = new Map<string, FakeSub>();
  const sessions = new Map<string, { id: string; status: "open" | "complete" | "expired"; url: string }>();
  const prices: Record<string, object> = {
    price_founding0001: { id: "price_founding0001", active: true, currency: "eur", unit_amount: 3900, recurring: { interval: "month", interval_count: 1 } },
    price_list00000001: { id: "price_list00000001", active: true, currency: "eur", unit_amount: 4900, recurring: { interval: "month", interval_count: 1 } },
  };
  const invoices = new Map<string, object>();
  const taxRate = { active: true, percentage: 19, inclusive: false };
  let next = 0;
  const notFound = () => { throw new DomainError("PROVIDER_ERROR", "Stripe request failed (404, resource_missing)"); };
  const client: StripeClient = async (method, path, params = {}, key) => {
    calls.push({ method, path, params, key });
    let match: RegExpExecArray | null;
    if (method === "GET" && (match = /^\/prices\/(.+)$/.exec(path))) return prices[match[1]] ?? notFound();
    if (method === "POST" && path === "/customers") return { id: `cus_test${++next}` };
    if (method === "POST" && path === "/checkout/sessions") { const id = `cs_test_${++next}`; const session = { id, status: "open" as const, url: `https://checkout.stripe.com/c/pay/${id}` }; sessions.set(id, session); return session; }
    if (method === "GET" && (match = /^\/checkout\/sessions\/([^/]+)$/.exec(path))) return sessions.get(match[1]) ?? notFound();
    if (method === "POST" && (match = /^\/checkout\/sessions\/([^/]+)\/expire$/.exec(path))) { const session = sessions.get(match[1])!; session.status = "expired"; return session; }
    if (method === "POST" && path === "/billing_portal/sessions") return { url: "https://billing.stripe.com/p/session/test_portal" };
    if (method === "GET" && (match = /^\/subscriptions\/([^/]+)$/.exec(path))) return structuredClone(subs.get(match[1])) ?? notFound();
    if (method === "POST" && /^\/subscriptions\/[^/]+$/.test(path)) return {};
    if (method === "GET" && (match = /^\/invoices\/([^/]+)$/.exec(path))) return invoices.get(match[1]) ?? notFound();
    if (method === "POST" && path === "/invoiceitems") return { id: `ii_test${++next}` };
    if (method === "GET" && /^\/tax_rates\//.test(path)) return taxRate;
    if (method === "POST" && (match = /^\/subscription_items\/([^/]+)$/.exec(path))) { for (const sub of subs.values()) for (const item of sub.items.data) if (item.id === match[1]) item.quantity = Number(params.quantity); return {}; }
    throw new Error(`Unexpected Stripe call ${method} ${path}`);
  };
  return { client, calls, subs, sessions, prices, invoices, taxRate };
}

let stripe = fakeStripe();
beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
  stripe = fakeStripe();
  setStripeClient(stripe.client);
  setEnv({ ...STRIPE_ENV, BILLING_FIXTURE_MODE: undefined, START_GUARANTEE_ENABLED: undefined, START_GUARANTEE_MIN_CUSTOMERS: undefined, START_GUARANTEE_CONTRACT_CUTOFF: undefined, BILLING_VAT_MODE: undefined, STRIPE_TAX_RATE_ID: undefined, PLATE_OPERATOR_USER_IDS: undefined });
});
afterEach(() => { setStripeClient(); setEnv(saved); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic billing tester", `${id}@example.test`]);
  return id;
}
async function shop() {
  const ownerId = await user();
  const operatorId = await user();
  setEnv({ PLATE_OPERATOR_USER_IDS: operatorId });
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Stripe Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
  return { ...merchant, ownerId, operatorId };
}
const sub = async (tenantId: string) => (await db.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)))[0];
const programme = async (programId: string) => (await db.select().from(programs).where(eq(programs.id, programId)))[0];
const sign = (raw: string, at: Date, secret = WEBHOOK_SECRET) => { const t = Math.floor(at.getTime() / 1000); return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${raw}`).digest("hex")}`; };
const eventFor = (type: string, subscriptionId: string, id = `evt_${randomUUID().replaceAll("-", "")}`) => JSON.stringify({ id, type, data: { object: { id: subscriptionId, object: "subscription" } } });
const deliver = (raw: string, at = new Date()) => applyStripeWebhook(raw, sign(raw, at), at);

const START = new Date("2026-11-02T10:00:00.000Z");
const PERIOD_END = new Date("2026-12-02T10:00:00.000Z");
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

/** Operator picks the plan, the owner checks out, Stripe creates the subscription and sends `created`. */
async function subscribed(planCode: "founding" | "list" = "founding", state: Partial<FakeSub> = {}) {
  const s = await shop();
  await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode });
  await createStripeCheckout(s.ownerId);
  const customer = (await sub(s.tenantId)).providerCustomerId!;
  const subscriptionId = `sub_test${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  stripe.subs.set(subscriptionId, { id: subscriptionId, customer, status: "active", cancel_at_period_end: false, cancel_at: null, ended_at: null, start_date: seconds(START), metadata: { tenant_id: s.tenantId }, items: { data: [{ id: `si_${subscriptionId}`, quantity: 1, current_period_end: seconds(PERIOD_END) }] }, ...state });
  expect(await deliver(eventFor("customer.subscription.created", subscriptionId))).toEqual({ status: "applied" });
  // Billing for this location starts with the subscription, whatever today's date is.
  await pool.query("UPDATE billing_location_plans SET created_at = $1 WHERE tenant_id = $2", [new Date("2026-10-01T09:00:00.000Z"), s.tenantId]);
  return { ...s, subscriptionId, customer, fake: () => stripe.subs.get(subscriptionId)! };
}

describe("Stripe webhook signatures", () => {
  const raw = JSON.stringify({ id: "evt_signature0001", type: "invoice.paid", data: { object: { id: "in_1" } } });
  const at = new Date("2026-11-02T10:00:00.000Z");
  it("accepts a valid signature, also among several v1 values (secret rotation)", () => {
    expect(() => verifyStripeSignature(raw, sign(raw, at), WEBHOOK_SECRET, at)).not.toThrow();
    const t = seconds(at);
    expect(() => verifyStripeSignature(raw, `t=${t},v1=${"0".repeat(64)},${sign(raw, at).split(",")[1]}`, WEBHOOK_SECRET, at)).not.toThrow();
  });
  it("rejects another secret, a changed body, a malformed header and a signature older than five minutes", () => {
    expect(() => verifyStripeSignature(raw, sign(raw, at, `whsec_${"o".repeat(32)}`), WEBHOOK_SECRET, at)).toThrow(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
    expect(() => verifyStripeSignature(raw.replace("invoice.paid", "invoice.void"), sign(raw, at), WEBHOOK_SECRET, at)).toThrow(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
    for (const header of ["", "v1=abc", `t=${seconds(at)}`, `t=abc,v1=${"a".repeat(64)}`]) expect(() => verifyStripeSignature(raw, header, WEBHOOK_SECRET, at), header).toThrow(expect.objectContaining({ code: "INVALID_SIGNATURE" }));
    expect(() => verifyStripeSignature(raw, sign(raw, new Date(at.getTime() - 5 * 60_000 - 1000)), WEBHOOK_SECRET, at)).toThrow(/Expired/);
  });
  it("rejects an unsigned event at the webhook before reading the database, and ignores event types it does not handle", async () => {
    await expect(applyStripeWebhook(raw, "t=1,v1=bad")).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    expect(await deliver(raw)).toEqual({ status: "ignored" });
  });
  it("treats a replayed event as a duplicate and never applies it twice", async () => {
    const s = await subscribed();
    s.fake().cancel_at_period_end = true;
    const raw = eventFor("customer.subscription.updated", s.subscriptionId);
    expect(await deliver(raw)).toEqual({ status: "applied" });
    s.fake().cancel_at_period_end = false;
    // Stripe retries the same event with a fresh signature: recognised by its ID, nothing re-read or rewritten.
    expect(await deliver(raw, new Date(Date.now() + 60_000))).toEqual({ status: "duplicate" });
    expect((await sub(s.tenantId)).cancelAtPeriodEnd).toBe(true);
    expect(await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.tenantId, s.tenantId))).toHaveLength(2);
  });
  it("is unavailable unless the whole billing group is configured", async () => {
    setEnv({ STRIPE_PRICE_LIST: undefined });
    const raw = eventFor("customer.subscription.updated", "sub_none");
    await expect(deliver(raw)).rejects.toMatchObject({ code: "BILLING_DISABLED" });
  });
});

describe("Stripe subscription state", () => {
  it.each(Object.entries(STRIPE_STATUS))("maps Stripe %s to %s", async (stripeStatus, ours) => {
    const s = await subscribed();
    s.fake().status = stripeStatus as FakeSub["status"];
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    expect((await sub(s.tenantId))).toMatchObject({ status: ours, provider: "stripe", providerSubscriptionId: s.subscriptionId, currentPeriodEnd: PERIOD_END });
  });

  it("is out-of-order safe: an older event delivered late cannot undo a newer state", async () => {
    const s = await subscribed();
    s.fake().cancel_at_period_end = true;
    const newer = eventFor("customer.subscription.updated", s.subscriptionId);
    const older = eventFor("customer.subscription.created", s.subscriptionId);
    await deliver(newer);
    await deliver(older);
    expect(await sub(s.tenantId)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });

  it("refuses a subscription whose customer is not the shop's, and an unknown shop", async () => {
    const s = await subscribed();
    s.fake().customer = "cus_someoneelse";
    await expect(deliver(eventFor("customer.subscription.updated", s.subscriptionId))).rejects.toMatchObject({ code: "NOT_FOUND" });
    s.fake().metadata.tenant_id = randomUUID();
    await expect(deliver(eventFor("customer.subscription.updated", s.subscriptionId))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("records a late event for a replaced subscription without touching the new one", async () => {
    const s = await subscribed();
    s.fake().status = "canceled";
    await deliver(eventFor("customer.subscription.deleted", s.subscriptionId));
    await createStripeCheckout(s.ownerId);
    const second = "sub_testsecond0001";
    stripe.subs.set(second, { ...structuredClone(s.fake()), id: second, status: "active" });
    expect(await deliver(eventFor("customer.subscription.created", second))).toEqual({ status: "applied" });
    expect(await deliver(eventFor("customer.subscription.deleted", s.subscriptionId))).toEqual({ status: "stale" });
    expect(await sub(s.tenantId)).toMatchObject({ status: "active", providerSubscriptionId: second });
  });
});

describe("plans and checkout", () => {
  it("refuses checkout until the operator chose a plan, then charges that plan per location with the § 19 note on the customer", async () => {
    const s = await shop();
    await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    await expect(createStripeCheckout(s.ownerId)).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" });
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "founding" });
    const checkout = await createStripeCheckout(s.ownerId);
    expect(checkout.url).toMatch(/^https:\/\/checkout\.stripe\.com\//);
    const customer = stripe.calls.find(call => call.path === "/customers")!;
    expect(customer.params).toMatchObject({ "metadata[tenant_id]": s.tenantId, "invoice_settings[footer]": VAT_NOTE, "preferred_locales[0]": "de", "invoice_settings[custom_fields][0][name]": "Geschäft", "invoice_settings[custom_fields][0][value]": "Synthetic Stripe Café" });
    const session = stripe.calls.find(call => call.method === "POST" && call.path === "/checkout/sessions")!;
    expect(session.params).toMatchObject({ mode: "subscription", "line_items[0][price]": "price_founding0001", "line_items[0][quantity]": "2", "subscription_data[metadata][tenant_id]": s.tenantId });
    expect((await getBillingOverview(s.ownerId))).toMatchObject({ liveBilling: true, planCode: "founding", monthlySubtotalMinor: 7800, status: "pending_checkout" });
    // A second click reuses the open session instead of opening a second one.
    expect((await createStripeCheckout(s.ownerId)).url).toBe(checkout.url);
    expect(stripe.calls.filter(call => call.method === "POST" && call.path === "/checkout/sessions")).toHaveLength(1);
  });

  it("refuses a Stripe price that does not match the plan (a swapped price ID never charges)", async () => {
    const s = await shop();
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "founding" });
    setEnv({ STRIPE_PRICE_FOUNDING: "price_list00000001", STRIPE_PRICE_LIST: "price_founding0001" });
    await expect(createStripeCheckout(s.ownerId)).rejects.toMatchObject({ code: "PLAN_MISCONFIGURED" });
    expect(stripe.calls.some(call => call.path === "/checkout/sessions")).toBe(false);
  });

  it("standard VAT mode: no § 19 footer, the exclusive 19 % rate on the subscription, and the owner sees it; an inclusive rate is refused", async () => {
    setEnv({ BILLING_VAT_MODE: "standard", STRIPE_TAX_RATE_ID: "txr_test00000001" });
    const s = await shop();
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "list" });
    stripe.taxRate.inclusive = true;
    await expect(createStripeCheckout(s.ownerId)).rejects.toMatchObject({ code: "PLAN_MISCONFIGURED" });
    stripe.taxRate.inclusive = false;
    await createStripeCheckout(s.ownerId);
    expect(stripe.calls.find(call => call.path === "/customers")!.params["invoice_settings[footer]"]).toBeUndefined();
    expect(stripe.calls.find(call => call.method === "POST" && call.path === "/checkout/sessions")!.params).toMatchObject({ "line_items[0][price]": "price_list00000001", "subscription_data[default_tax_rates][0]": "txr_test00000001" });
    expect((await getBillingOverview(s.ownerId)).countingRule).toContain("Zuzüglich 19 % Umsatzsteuer.");
  });

  it("lets only the operator choose the plan, and locks it while a subscription runs", async () => {
    const s = await subscribed("founding");
    await expect(setTenantPlan({ actorUserId: s.ownerId, env: process.env, tenantId: s.tenantId, planCode: "list" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "list" })).rejects.toMatchObject({ code: "BILLING_STATE" });
    await expect(setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "premium" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect((await db.select().from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, s.tenantId))).map(plan => plan.priceMinor)).toEqual([3900]);
    expect((await createStripePortal(s.ownerId)).url).toMatch(/^https:\/\/billing\.stripe\.com\//);
  });
});

describe("cancellation sets the programme's provisional end date (#84)", () => {
  it("a cancel at period end proposes the last paid Berlin day, unconfirmed; withdrawing it removes that date again", async () => {
    const s = await subscribed();
    s.fake().cancel_at_period_end = true;
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    expect(await programme(s.programId)).toMatchObject({ status: "active", cancellationEndDate: "2026-12-02", cancellationConfirmedAt: null });
    s.fake().cancel_at_period_end = false;
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: null, cancellationRequestedAt: null });
  });

  it("never moves a date the operator confirmed, nor removes it when the cancel is withdrawn", async () => {
    const s = await subscribed();
    // Confirmed on exactly the day a Stripe cancel would propose, so only the confirmation check protects it.
    await db.update(programs).set({ cancellationEndDate: "2026-12-02", cancellationConfirmedAt: new Date() }).where(eq(programs.id, s.programId));
    s.fake().cancel_at_period_end = true;
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    s.fake().cancel_at_period_end = false;
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    expect(await programme(s.programId)).toMatchObject({ status: "active", cancellationEndDate: "2026-12-02" });
  });

  it("an immediate Stripe cancellation also proposes (not confirms) the end", async () => {
    const s = await subscribed();
    Object.assign(s.fake(), { status: "canceled", ended_at: seconds(new Date("2026-11-20T08:00:00.000Z")) });
    await deliver(eventFor("customer.subscription.deleted", s.subscriptionId));
    expect(await programme(s.programId)).toMatchObject({ status: "active", cancellationEndDate: "2026-11-20", cancellationConfirmedAt: null });
    expect(await sub(s.tenantId)).toMatchObject({ status: "cancelled", cancelAtPeriodEnd: false });
  });
});

describe("start guarantee (per location, decided on the month-2 invoice)", () => {
  // START is 2 Nov 11:00 Berlin, so the first month is 2 Nov 00:00 Berlin (1 Nov 23:00 UTC) up to 2 Dec 00:00 Berlin.
  const windowStart = new Date("2026-11-01T23:00:00.000Z");
  const windowEnd = new Date("2026-12-01T23:00:00.000Z");
  let invoiceNumber = 0;
  async function card(tenantId: string, programId: string) {
    const { rows } = await pool.query("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token, balance) VALUES ($1, $2, 'sc_g' || md5(random()::text), 'card_g' || md5(random()::text), 0) RETURNING id", [tenantId, programId]);
    return rows[0].id as string;
  }
  async function credit(tenantId: string, locationId: string, membershipId: string, at: Date, source = "staff_online") {
    const { rows } = await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at) VALUES ($1, $2, $3, 1, 'award', $4::varchar, CASE WHEN $4::varchar = 'nfc_tap' THEN NULL ELSE (SELECT user_id FROM staff_roles WHERE tenant_id = $1 LIMIT 1) END, gen_random_uuid(), 'g-' || gen_random_uuid(), $5) RETURNING id", [tenantId, locationId, membershipId, source, at]);
    return rows[0].id as string;
  }
  /** `count` customers, each with one confirmed cashier credit at `at`. */
  async function customers(s: { tenantId: string; locationId: string; programId: string }, count: number, at: Date) {
    for (let i = 0; i < count; i++) await credit(s.tenantId, s.locationId, await card(s.tenantId, s.programId), at);
  }
  async function cycleInvoice(s: { customer: string; subscriptionId: string }, created: Date, overrides: Record<string, unknown> = {}) {
    const id = `in_test${++invoiceNumber}x${randomUUID().slice(0, 8)}`;
    stripe.invoices.set(id, { id, customer: s.customer, status: "draft", billing_reason: "subscription_cycle", created: seconds(created), parent: { subscription_details: { subscription: s.subscriptionId } }, ...overrides });
    const raw = JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, type: "invoice.created", data: { object: { id, object: "invoice" } } });
    return { id, result: await deliver(raw), raw };
  }
  const credits = () => stripe.calls.filter(call => call.method === "POST" && call.path === "/invoiceitems");
  const plan = async (tenantId: string, locationId: string) => (await db.select().from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, tenantId))).find(row => row.locationId === locationId)!;

  it("is off by default: the month-2 invoice is left alone", async () => {
    const s = await subscribed();
    expect((await cycleInvoice(s, PERIOD_END)).result).toEqual({ status: "ignored" });
    expect(credits()).toHaveLength(0);
    expect((await plan(s.tenantId, s.locationId)).guaranteeDecidedAt).toBeNull();
  });

  it("19 customers in the first month: one credit line of the location's price on the draft month-2 invoice, exactly once", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    await customers(s, 18, new Date(windowStart.getTime() + 3600_000));
    await customers(s, 1, windowStart); // the first instant of the start day counts
    await customers(s, 1, new Date(windowStart.getTime() - 1000)); // the day before does not
    await customers(s, 1, windowEnd); // nor the same day a month later
    const invoice = await cycleInvoice(s, PERIOD_END);
    expect(invoice.result).toEqual({ status: "applied" });
    expect(credits()).toMatchObject([{ params: { customer: s.customer, invoice: invoice.id, amount: "-3900", currency: "eur", description: GUARANTEE_LINE }, key: `guarantee-${s.locationId}` }]);
    expect(await plan(s.tenantId, s.locationId)).toMatchObject({ guaranteeApplied: true, guaranteeCustomers: 19 });
    expect(await deliver(invoice.raw)).toEqual({ status: "duplicate" });
    await cycleInvoice(s, new Date("2027-01-02T10:00:00.000Z"));
    expect(credits()).toHaveLength(1);
  });

  it("counts distinct customers with a confirmed credit: repeats once, reversed credits and bonuses not at all", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const inside = new Date(windowStart.getTime() + 86_400_000);
    const full = await subscribed();
    await customers(full, 20, inside);
    await cycleInvoice(full, PERIOD_END);
    expect(await plan(full.tenantId, full.locationId)).toMatchObject({ guaranteeApplied: false, guaranteeCustomers: 20 });
    const mixed = await subscribed();
    await customers(mixed, 17, inside);
    const regular = await card(mixed.tenantId, mixed.programId);
    for (let i = 0; i < 3; i++) await credit(mixed.tenantId, mixed.locationId, regular, inside);
    const reversed = await card(mixed.tenantId, mixed.programId);
    const award = await credit(mixed.tenantId, mixed.locationId, reversed, inside);
    await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', (SELECT user_id FROM staff_roles WHERE tenant_id = $1 LIMIT 1), gen_random_uuid(), 'g-rev-' || gen_random_uuid(), $4)", [mixed.tenantId, mixed.locationId, reversed, award]);
    await credit(mixed.tenantId, mixed.locationId, await card(mixed.tenantId, mixed.programId), inside, "welcome_bonus");
    await credit(mixed.tenantId, mixed.locationId, await card(mixed.tenantId, mixed.programId), inside, "nfc_tap");
    await cycleInvoice(mixed, PERIOD_END);
    // 17 + one customer with three credits + one NFC tap = 19; the reversed award and the welcome bonus do not count.
    expect(await plan(mixed.tenantId, mixed.locationId)).toMatchObject({ guaranteeApplied: true, guaranteeCustomers: 19 });
    expect(credits()).toHaveLength(1);
  });

  it("decides each location on its own first month, a later location on a later invoice", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    const busy = await createAdditionalLocation(s.ownerId, { name: "Busy counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Busy card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    const late = await createAdditionalLocation(s.ownerId, { name: "Late counter", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Late card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    await pool.query("UPDATE billing_location_plans SET created_at = $1 WHERE location_id = $2", [new Date("2026-10-01T09:00:00.000Z"), busy.locationId]);
    await pool.query("UPDATE billing_location_plans SET created_at = $1 WHERE location_id = $2", [new Date("2026-11-20T09:00:00.000Z"), late.locationId]);
    await customers({ tenantId: s.tenantId, ...busy }, 25, new Date(windowStart.getTime() + 3600_000));
    await cycleInvoice(s, PERIOD_END);
    expect(credits().map(call => call.key)).toEqual([`guarantee-${s.locationId}`]);
    expect(await plan(s.tenantId, busy.locationId)).toMatchObject({ guaranteeApplied: false, guaranteeCustomers: 25 });
    expect((await plan(s.tenantId, late.locationId)).guaranteeDecidedAt).toBeNull();
    await cycleInvoice(s, new Date("2027-01-02T10:00:00.000Z"));
    expect(credits().map(call => call.key)).toEqual([`guarantee-${s.locationId}`, `guarantee-${late.locationId}`]);
  });

  it("gives nothing to a cancelling shop, a contract after the cut-off day, or with fewer customers than a configured threshold", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const cancelling = await subscribed("founding", { cancel_at_period_end: true });
    await cycleInvoice(cancelling, PERIOD_END);
    expect(await plan(cancelling.tenantId, cancelling.locationId)).toMatchObject({ guaranteeApplied: false, guaranteeCustomers: 0 });
    setEnv({ START_GUARANTEE_CONTRACT_CUTOFF: "2026-11-01" });
    const late = await subscribed();
    await cycleInvoice(late, PERIOD_END);
    expect(await plan(late.tenantId, late.locationId)).toMatchObject({ guaranteeApplied: false });
    setEnv({ START_GUARANTEE_CONTRACT_CUTOFF: "2026-11-02", START_GUARANTEE_MIN_CUSTOMERS: "10" });
    const ten = await subscribed();
    await customers(ten, 10, new Date(windowStart.getTime() + 3600_000));
    await cycleInvoice(ten, PERIOD_END);
    expect(await plan(ten.tenantId, ten.locationId)).toMatchObject({ guaranteeApplied: false, guaranteeCustomers: 10 });
    expect(credits()).toHaveLength(0);
  });

  it("puts the credit on the next invoice when Stripe already finalized month 2, with the 19 % rate in standard VAT mode", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    setEnv({ BILLING_VAT_MODE: "standard", STRIPE_TAX_RATE_ID: "txr_test00000001" });
    await cycleInvoice(s, PERIOD_END, { status: "open" });
    expect(credits()).toMatchObject([{ params: { subscription: s.subscriptionId, "tax_rates[0]": "txr_test00000001" } }]);
    expect(credits()[0].params.invoice).toBeUndefined();
  });

  it("keeps the Stripe quantity equal to the shop's location count", async () => {
    const s = await subscribed();
    await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    expect((await runBillingJob()).quantities).toBe(1);
    expect(s.fake().items.data[0].quantity).toBe(2);
    expect((await runBillingJob()).quantities).toBe(0);
  });
});
