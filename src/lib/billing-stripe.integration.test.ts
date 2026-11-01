import { createHmac, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingHandoffs, billingLocationPlans, billingWebhookEvents, programs, subscriptions } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { DomainError } from "./loyalty";
import { createMerchant } from "./product";
import { operatorProgramme, requestCancellation, withdrawCancellation } from "./programme-end";
import { getBillingOverview } from "./billing";
import { operatorOverview } from "./operator";
import { applyStripeWebhook, createStripeCheckout, createStripePortal, endInFreeMonth, runBillingJob, syncShopEnd, setStripeClient, setTenantPlan, startBilling, STRIPE_STATUS, verifyStripeSignature, type StripeClient } from "./billing-stripe";
import { expectedFreeUntil, GUARANTEE_LINE, VAT_NOTE, VAT_STANDARD_NOTE } from "./stripe-config";

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
  const failing = new Set<string>();
  // Stripe's clock for subscriptions the provider creates, and an optional wrong first billing date to simulate a surprise.
  const clock = { now: new Date(), anchorOverride: null as number | null };
  const creditNotes: Array<{ id: string; invoice: string; metadata: Record<string, string> }> = [];
  const taxRate = { active: true, percentage: 19, inclusive: false };
  let next = 0;
  const notFound = () => { throw new DomainError("PROVIDER_ERROR", "Stripe request failed (404, resource_missing)"); };
  const client: StripeClient = async (method, path, params = {}, key) => {
    calls.push({ method, path, params, key });
    if (method === "POST" && failing.has(path)) throw new DomainError("PROVIDER_ERROR", "Stripe request failed (500)");
    let match: RegExpExecArray | null;
    if (method === "GET" && (match = /^\/prices\/(.+)$/.exec(path))) return prices[match[1]] ?? notFound();
    if (method === "POST" && path === "/subscriptions") {
      const id = `sub_test${++next}`;
      // billing_cycle_anchor_config: the given day of the month at the given UTC time, the next one after now (Stripe's month rule).
      const anchor = clock.anchorOverride ?? Math.floor(expectedFreeUntil(clock.now).getTime() / 1000);
      const sub: FakeSub = { id, customer: params.customer, status: "active", cancel_at_period_end: false, cancel_at: null, ended_at: null, start_date: Math.floor(clock.now.getTime() / 1000), metadata: { tenant_id: params["metadata[tenant_id]"] }, items: { data: [{ id: `si_${id}`, quantity: Number(params["items[0][quantity]"]), current_period_end: anchor }] } };
      subs.set(id, sub);
      return { ...structuredClone(sub), billing_cycle_anchor: anchor };
    }
    if (method === "DELETE" && (match = /^\/subscriptions\/([^/]+)$/.exec(path))) { const sub = subs.get(match[1]); if (sub) sub.status = "canceled"; return sub ?? notFound(); }
    if (method === "POST" && path === "/customers") return { id: `cus_test${++next}` };
    if (method === "POST" && (match = /^\/customers\/(cus_[A-Za-z0-9]+)$/.exec(path))) return { id: match[1] };
    if (method === "POST" && path === "/checkout/sessions") { const id = `cs_test_${++next}`; const session = { id, status: "open" as const, url: `https://checkout.stripe.com/c/pay/${id}` }; sessions.set(id, session); return session; }
    if (method === "GET" && (match = /^\/checkout\/sessions\/([^/]+)$/.exec(path))) return sessions.get(match[1]) ?? notFound();
    if (method === "POST" && (match = /^\/checkout\/sessions\/([^/]+)\/expire$/.exec(path))) { const session = sessions.get(match[1])!; session.status = "expired"; return session; }
    if (method === "POST" && path === "/billing_portal/sessions") return { url: "https://billing.stripe.com/p/session/test_portal" };
    if (method === "GET" && (match = /^\/subscriptions\/([^/]+)$/.exec(path))) return structuredClone(subs.get(match[1])) ?? notFound();
    if (method === "POST" && (match = /^\/subscriptions\/([^/]+)$/.exec(path))) { const sub = subs.get(match[1]); if (sub && "cancel_at" in params) sub.cancel_at = params.cancel_at ? Number(params.cancel_at) : null; if (sub && "cancel_at_period_end" in params) sub.cancel_at_period_end = params.cancel_at_period_end === "true"; return sub ? structuredClone(sub) : {}; }
    if (method === "GET" && (match = /^\/invoices\/([^/]+)$/.exec(path))) return invoices.get(match[1]) ?? notFound();
    // The month-two invoices of a subscription (ENG-167: voided when a free-month cancellation came in time).
    if (method === "GET" && path === "/invoices") return { data: [...invoices.values()].filter(invoice => (invoice as { subscription?: string }).subscription === params.subscription) };
    if (method === "POST" && (match = /^\/invoices\/([^/]+)\/void$/.exec(path))) { const invoice = invoices.get(match[1]) as { status: string } | undefined; if (invoice) invoice.status = "void"; return invoice ?? notFound(); }
    if (method === "DELETE" && (match = /^\/invoices\/([^/]+)$/.exec(path))) { const found = invoices.delete(match[1]); return found ? { deleted: true } : notFound(); }
    if (method === "POST" && path === "/invoiceitems") return { id: `ii_test${++next}` };
    if (method === "POST" && path === "/credit_notes") { const note = { id: `cn_test${++next}`, invoice: params.invoice, metadata: { guarantee_key: params["metadata[guarantee_key]"] } }; creditNotes.push(note); return note; }
    if (method === "GET" && path === "/credit_notes") return { data: creditNotes.filter(note => note.invoice === params.invoice) };
    if (method === "GET" && /^\/tax_rates\//.test(path)) return taxRate;
    if (method === "POST" && (match = /^\/subscription_items\/([^/]+)$/.exec(path))) { for (const sub of subs.values()) for (const item of sub.items.data) if (item.id === match[1]) item.quantity = Number(params.quantity); return {}; }
    throw new Error(`Unexpected Stripe call ${method} ${path}`);
  };
  return { client, calls, subs, sessions, prices, invoices, taxRate, failing, creditNotes, clock };
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

  it("refuses a second active subscription while the shop's own runs, and keeps the shop on its own (W-1)", async () => {
    const s = await subscribed();
    const second = "sub_testintruder01";
    stripe.subs.set(second, { ...structuredClone(s.fake()), id: second, status: "active" });
    await expect(deliver(eventFor("customer.subscription.created", second))).rejects.toMatchObject({ code: "BILLING_STATE" });
    expect(await sub(s.tenantId)).toMatchObject({ status: "active", providerSubscriptionId: s.subscriptionId });
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
  it("shows no amount before the operator sets a plan, then exactly what checkout charges (one source, L10)", async () => {
    const s = await shop();
    await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    expect(await getBillingOverview(s.ownerId)).toMatchObject({ liveBilling: true, charge: null, planCode: null });
    await expect(createStripeCheckout(s.ownerId)).rejects.toMatchObject({ code: "PLAN_UNAVAILABLE" });
    for (const [planCode, unitMinor, price] of [["founding", 3900, "price_founding0001"], ["list", 4900, "price_list00000001"]] as const) {
      await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode });
      const page = await getBillingOverview(s.ownerId);
      expect(page.charge).toEqual({ planCode, unitMinor, quantity: 2, totalMinor: unitMinor * 2 });
      await createStripeCheckout(s.ownerId);
      // The page's amount is what Stripe charges: the handoff total, the line quantity, and the verified Stripe unit price.
      const [handoff] = await db.select().from(billingHandoffs).where(eq(billingHandoffs.tenantId, s.tenantId)).orderBy(billingHandoffs.createdAt).then(rows => rows.slice(-1));
      expect(handoff.amountMinor).toBe(page.charge!.totalMinor);
      const session = stripe.calls.filter(call => call.method === "POST" && call.path === "/checkout/sessions").at(-1)!;
      expect(session.params).toMatchObject({ "line_items[0][price]": price, "line_items[0][quantity]": String(page.charge!.quantity) });
      expect((stripe.prices[price] as { unit_amount: number }).unit_amount).toBe(page.charge!.unitMinor);
    }
  });

  it("takes the VAT line from the VAT setting, never from the page: none by default (D-021), § 19 or 19 % only when set", async () => {
    const s = await shop();
    expect((await getBillingOverview(s.ownerId)).taxNote).toBe("");
    setEnv({ BILLING_VAT_MODE: "kleinunternehmer" });
    expect((await getBillingOverview(s.ownerId)).taxNote).toBe(VAT_NOTE);
    setEnv({ BILLING_VAT_MODE: "standard", STRIPE_TAX_RATE_ID: "txr_test00000001" });
    expect((await getBillingOverview(s.ownerId)).taxNote).toBe(VAT_STANDARD_NOTE);
  });

  it("puts no VAT wording and no tax rate on the Stripe customer or subscription while the mode is unset", async () => {
    const s = await shop();
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "list" });
    await createStripeCheckout(s.ownerId);
    expect(stripe.calls.find(call => call.path === "/customers")!.params["invoice_settings[footer]"]).toBeUndefined();
    expect(stripe.calls.find(call => call.method === "POST" && call.path === "/checkout/sessions")!.params["subscription_data[default_tax_rates][0]"]).toBeUndefined();
    expect(stripe.calls.some(call => call.path.startsWith("/tax_rates/"))).toBe(false);
  });

  it("refuses checkout until the operator chose a plan, then charges that plan per location with the § 19 note on the customer", async () => {
    setEnv({ BILLING_VAT_MODE: "kleinunternehmer" });
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
    expect((await getBillingOverview(s.ownerId)).taxNote).toBe("Zuzüglich 19 % Umsatzsteuer.");
  });

  it("closes an open checkout when the operator changes the plan, so it can never complete at the old price", async () => {
    const s = await shop();
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "founding" });
    const first = await createStripeCheckout(s.ownerId);
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "list" });
    expect([...stripe.sessions.values()].map(session => session.status)).toEqual(["expired"]);
    const second = await createStripeCheckout(s.ownerId);
    expect(second.url).not.toBe(first.url);
    expect(stripe.calls.filter(call => call.method === "POST" && call.path === "/checkout/sessions").map(call => call.params["line_items[0][price]"])).toEqual(["price_founding0001", "price_list00000001"]);
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
    expect(await programme(s.programId)).toMatchObject({ status: "active", cancellationEndDate: "2026-12-02", cancellationConfirmedAt: null, cancellationRequestedAt: expect.any(Date) });
    // It is a request in /operator's Kündigungen block (active, with an end date), unconfirmed and marked as asked for, not planned by the operator.
    const row = (await operatorOverview(s.operatorId)).rows.find(item => item.programId === s.programId)!;
    expect(row).toMatchObject({ status: "active", endDate: "2026-12-02", confirmed: false, requestedDays: 0 });
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
  function invoiceEvent(s: { customer: string; subscriptionId: string }, created: Date, overrides: Record<string, unknown> = {}) {
    const id = `in_test${++invoiceNumber}x${randomUUID().slice(0, 8)}`;
    stripe.invoices.set(id, { id, customer: s.customer, status: "draft", billing_reason: "subscription_cycle", created: seconds(created), parent: { subscription_details: { subscription: s.subscriptionId } }, ...overrides });
    return { id, raw: JSON.stringify({ id: `evt_${randomUUID().replaceAll("-", "")}`, type: "invoice.created", data: { object: { id, object: "invoice" } } }) };
  }
  async function cycleInvoice(s: { customer: string; subscriptionId: string }, created: Date, overrides: Record<string, unknown> = {}) {
    const event = invoiceEvent(s, created, overrides);
    return { ...event, result: await deliver(event.raw) };
  }
  const credits = () => stripe.calls.filter(call => call.method === "POST" && (call.path === "/invoiceitems" || call.path === "/credit_notes"));
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
    expect(credits()).toMatchObject([{ path: "/invoiceitems", params: { customer: s.customer, invoice: invoice.id, amount: "-3900", currency: "eur", description: GUARANTEE_LINE, "metadata[guarantee_key]": `guarantee-${invoice.id}-${s.locationId}` }, key: `guarantee-${invoice.id}-${s.locationId}` }]);
    expect(await plan(s.tenantId, s.locationId)).toMatchObject({ guaranteeOutcome: "credit", guaranteeCustomers: 19, guaranteeInvoiceId: invoice.id, guaranteeCreditRef: expect.stringMatching(/^ii_/) });
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
    expect(await plan(full.tenantId, full.locationId)).toMatchObject({ guaranteeOutcome: "reached", guaranteeCustomers: 20, guaranteeCreditRef: null });
    const mixed = await subscribed();
    await customers(mixed, 16, inside);
    const regular = await card(mixed.tenantId, mixed.programId);
    for (let i = 0; i < 3; i++) await credit(mixed.tenantId, mixed.locationId, regular, inside);
    const reversed = await card(mixed.tenantId, mixed.programId);
    const award = await credit(mixed.tenantId, mixed.locationId, reversed, inside);
    await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', (SELECT user_id FROM staff_roles WHERE tenant_id = $1 LIMIT 1), gen_random_uuid(), 'g-rev-' || gen_random_uuid(), $4)", [mixed.tenantId, mixed.locationId, reversed, award]);
    await credit(mixed.tenantId, mixed.locationId, await card(mixed.tenantId, mixed.programId), inside, "welcome_bonus");
    await credit(mixed.tenantId, mixed.locationId, await card(mixed.tenantId, mixed.programId), inside, "nfc_tap");
    // A reversal made after the first month cannot pull the location under the threshold: this award keeps counting.
    const reversedLate = await card(mixed.tenantId, mixed.programId);
    const lateAward = await credit(mixed.tenantId, mixed.locationId, reversedLate, inside);
    await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id, created_at) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', (SELECT user_id FROM staff_roles WHERE tenant_id = $1 LIMIT 1), gen_random_uuid(), 'g-rev-' || gen_random_uuid(), $4, $5)", [mixed.tenantId, mixed.locationId, reversedLate, lateAward, windowEnd]);
    await cycleInvoice(mixed, PERIOD_END);
    // 16 + one customer with three credits + one NFC tap + one reversed only after the month = 19;
    // the award reversed inside the month and the welcome bonus do not count.
    expect(await plan(mixed.tenantId, mixed.locationId)).toMatchObject({ guaranteeOutcome: "credit", guaranteeCustomers: 19 });
    expect(credits()).toHaveLength(1);
  });

  it("counts a reversal made inside the first month", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const inside = new Date(windowStart.getTime() + 86_400_000);
    const s = await subscribed();
    await customers(s, 19, inside);
    const reversed = await card(s.tenantId, s.programId);
    const award = await credit(s.tenantId, s.locationId, reversed, inside);
    await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id, created_at) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', (SELECT user_id FROM staff_roles WHERE tenant_id = $1 LIMIT 1), gen_random_uuid(), 'g-rev-' || gen_random_uuid(), $4, $5)", [s.tenantId, s.locationId, reversed, award, new Date(inside.getTime() + 3600_000)]);
    await cycleInvoice(s, PERIOD_END);
    expect(await plan(s.tenantId, s.locationId)).toMatchObject({ guaranteeOutcome: "credit", guaranteeCustomers: 19 });
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
    const month2 = await cycleInvoice(s, PERIOD_END);
    expect(credits().map(call => call.key)).toEqual([`guarantee-${month2.id}-${s.locationId}`]);
    expect(await plan(s.tenantId, busy.locationId)).toMatchObject({ guaranteeOutcome: "reached", guaranteeCustomers: 25 });
    expect((await plan(s.tenantId, late.locationId)).guaranteeDecidedAt).toBeNull();
    const month3 = await cycleInvoice(s, new Date("2027-01-02T10:00:00.000Z"));
    expect(credits().map(call => call.key)).toEqual([`guarantee-${month2.id}-${s.locationId}`, `guarantee-${month3.id}-${late.locationId}`]);
  });

  it("gives nothing to a cancelling shop, a contract after the cut-off day, or with fewer customers than a configured threshold", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const cancelling = await subscribed("founding", { cancel_at_period_end: true });
    await cycleInvoice(cancelling, PERIOD_END);
    expect(await plan(cancelling.tenantId, cancelling.locationId)).toMatchObject({ guaranteeOutcome: "ineligible", guaranteeCustomers: 0 });
    setEnv({ START_GUARANTEE_CONTRACT_CUTOFF: "2026-11-01" });
    const late = await subscribed();
    await cycleInvoice(late, PERIOD_END);
    expect(await plan(late.tenantId, late.locationId)).toMatchObject({ guaranteeOutcome: "ineligible" });
    setEnv({ START_GUARANTEE_CONTRACT_CUTOFF: "2026-11-02", START_GUARANTEE_MIN_CUSTOMERS: "10" });
    const ten = await subscribed();
    await customers(ten, 10, new Date(windowStart.getTime() + 3600_000));
    await cycleInvoice(ten, PERIOD_END);
    expect(await plan(ten.tenantId, ten.locationId)).toMatchObject({ guaranteeOutcome: "reached", guaranteeCustomers: 10 });
    expect(credits()).toHaveLength(0);
  });

  it("issues a credit note with the same line and amount when Stripe already finalized month 2 (19 % rate in standard VAT mode)", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    setEnv({ BILLING_VAT_MODE: "standard", STRIPE_TAX_RATE_ID: "txr_test00000001" });
    const invoice = await cycleInvoice(s, PERIOD_END, { status: "open" });
    expect(credits()).toMatchObject([{ path: "/credit_notes", key: `guarantee-${invoice.id}-${s.locationId}`, params: { invoice: invoice.id, "lines[0][type]": "custom_line_item", "lines[0][description]": GUARANTEE_LINE, "lines[0][quantity]": "1", "lines[0][unit_amount]": "3900", "lines[0][tax_rates][0]": "txr_test00000001" } }]);
    expect(await plan(s.tenantId, s.locationId)).toMatchObject({ guaranteeOutcome: "credit", guaranteeCreditRef: expect.stringMatching(/^cn_/) });
  });

  it("records the decision before calling Stripe: a failed credit stays owed and the retried event issues it once, with the same key", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    stripe.failing.add("/invoiceitems");
    const event = invoiceEvent(s, PERIOD_END);
    await expect(deliver(event.raw)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(await plan(s.tenantId, s.locationId)).toMatchObject({ guaranteeOutcome: "credit", guaranteeInvoiceId: event.id, guaranteeCreditRef: null });
    stripe.failing.clear();
    // Stripe retries the same event: a duplicate for the decision, and the owed credit is issued now.
    expect(await deliver(event.raw, new Date(Date.now() + 60_000))).toEqual({ status: "duplicate" });
    expect((await plan(s.tenantId, s.locationId)).guaranteeCreditRef).toMatch(/^ii_/);
    expect(credits().map(call => call.key)).toEqual([`guarantee-${event.id}-${s.locationId}`, `guarantee-${event.id}-${s.locationId}`]);
    expect(await deliver(event.raw, new Date(Date.now() + 120_000))).toEqual({ status: "duplicate" });
    expect(credits()).toHaveLength(2);
    expect((await runBillingJob()).credited).toBe(0);
  });

  it("records a credit Stripe already holds under the key instead of issuing a second one (id lost after the idempotency window)", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    stripe.failing.add("/invoiceitems");
    const event = invoiceEvent(s, PERIOD_END);
    await deliver(event.raw).catch(() => undefined);
    stripe.failing.clear();
    // Stripe did create the line, then finalized the invoice; only our database never learned the id.
    const key = `guarantee-${event.id}-${s.locationId}`;
    Object.assign(stripe.invoices.get(event.id)!, { status: "open", lines: { data: [{ id: "il_testsub", metadata: {} }, { id: "il_testguarantee", metadata: { guarantee_key: key } }] } });
    expect((await runBillingJob()).credited).toBe(1);
    expect((await plan(s.tenantId, s.locationId)).guaranteeCreditRef).toBe("il_testguarantee");
    expect(credits().filter(call => call.path === "/credit_notes")).toHaveLength(0);
    // The same for a credit note already on a finalized invoice.
    const t = await subscribed();
    stripe.failing.add("/credit_notes");
    const second = invoiceEvent(t, PERIOD_END, { status: "open" });
    await deliver(second.raw).catch(() => undefined);
    stripe.failing.clear();
    stripe.creditNotes.push({ id: "cn_testexisting", invoice: second.id, metadata: { guarantee_key: `guarantee-${second.id}-${t.locationId}` } });
    expect((await runBillingJob()).credited).toBe(1);
    expect((await plan(t.tenantId, t.locationId)).guaranteeCreditRef).toBe("cn_testexisting");
  });

  it("the daily sweep issues a credit that is still owed", async () => {
    setEnv({ START_GUARANTEE_ENABLED: "true" });
    const s = await subscribed();
    stripe.failing.add("/invoiceitems");
    await cycleInvoice(s, PERIOD_END).catch(() => undefined);
    stripe.failing.clear();
    expect((await runBillingJob()).credited).toBe(1);
    expect((await plan(s.tenantId, s.locationId)).guaranteeCreditRef).toMatch(/^ii_/);
  });

  it("keeps the Stripe quantity equal to the shop's location count", async () => {
    const s = await subscribed();
    await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    expect((await runBillingJob()).quantities).toBe(1);
    expect(s.fake().items.data[0].quantity).toBe(2);
    // K-09: the later location pays pro rata from its own start day (its plan's creation), on the shop's next invoice.
    const [newest] = await db.select({ createdAt: billingLocationPlans.createdAt }).from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, s.tenantId)).orderBy(billingLocationPlans.createdAt).then(rows => rows.slice(-1));
    expect(stripe.calls.filter(call => call.path.startsWith("/subscription_items/")).at(-1)!.params).toEqual({ quantity: "2", proration_behavior: "create_prorations", proration_date: String(Math.floor(newest.createdAt.getTime() / 1000)) });
    expect((await runBillingJob()).quantities).toBe(0);
    // Fewer locations: from the next invoice on, no credit for the running month.
    await db.update(subscriptions).set({ activeLocationCount: 1 }).where(eq(subscriptions.tenantId, s.tenantId));
    await runBillingJob();
    expect(stripe.calls.filter(call => call.path.startsWith("/subscription_items/")).at(-1)!.params).toEqual({ quantity: "1", proration_behavior: "none" });
  });
});

describe("billing starts at go-live with the free first month (ENG-123)", () => {
  const GO_LIVE = new Date("2026-11-10T10:00:00Z"); // 11:00 Berlin
  const RECIPIENT = { name: "Synthetische Inhaberin", line1: "Beispielweg 2", postalCode: "34117", city: "Kassel", email: "rechnung@example.test" };
  const startAs = (s: { operatorId: string; tenantId: string }, at = GO_LIVE, billing: unknown = RECIPIENT) => { stripe.clock.now = at; return startBilling({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, billing, at }); };

  it("follows Stripe's month rule for the first billing date, from the Berlin go-live day", () => {
    expect(expectedFreeUntil(new Date("2026-11-10T10:00:00Z")).toISOString()).toBe("2026-12-10T00:00:00.000Z");
    expect(expectedFreeUntil(new Date("2027-01-31T10:00:00Z")).toISOString()).toBe("2027-02-28T00:00:00.000Z");
    expect(expectedFreeUntil(new Date("2028-01-31T10:00:00Z")).toISOString()).toBe("2028-02-29T00:00:00.000Z");
    expect(expectedFreeUntil(new Date("2026-12-15T10:00:00Z")).toISOString()).toBe("2027-01-15T00:00:00.000Z");
    expect(expectedFreeUntil(new Date("2026-11-10T23:30:00Z")).toISOString()).toBe("2026-12-11T00:00:00.000Z"); // already 11 Nov in Berlin
  });

  it("starts with no payment method, no trial and no invoice; first billing date the same date next month; list price by default", async () => {
    const s = await shop();
    await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    await expect(startBilling({ actorUserId: s.ownerId, env: process.env, tenantId: s.tenantId, billing: RECIPIENT, at: GO_LIVE })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await startAs(s)).toMatchObject({ planCode: "list", freeUntil: new Date("2026-12-10T00:00:00Z"), lastFreeDay: "2026-12-09" });
    const created = stripe.calls.find(call => call.method === "POST" && call.path === "/subscriptions")!;
    expect(created.params).toMatchObject({ "items[0][price]": "price_list00000001", "items[0][quantity]": "2", "billing_cycle_anchor_config[day_of_month]": "10", "billing_cycle_anchor_config[hour]": "0", "billing_cycle_anchor_config[minute]": "0", "billing_cycle_anchor_config[second]": "0", proration_behavior: "none", collection_method: "charge_automatically", "metadata[tenant_id]": s.tenantId });
    expect(Object.keys(created.params).some(name => /trial|default_payment_method$|payment_method$/.test(name))).toBe(false);
    expect(stripe.calls.some(call => /invoice/.test(call.path))).toBe(false);
    // § 14 UStG: the recipient's full name and address are on the Stripe customer before the subscription exists.
    const recipientCall = stripe.calls.findIndex(call => call.method === "POST" && /^\/customers\/cus_/.test(call.path));
    expect(stripe.calls[recipientCall].params).toEqual({ name: "Synthetische Inhaberin", email: "rechnung@example.test", "address[line1]": "Beispielweg 2", "address[postal_code]": "34117", "address[city]": "Kassel", "address[country]": "DE" });
    expect(recipientCall).toBeLessThan(stripe.calls.findIndex(call => call.method === "POST" && call.path === "/subscriptions"));
    expect(stripe.calls.find(call => call.path === "/customers")!.params["invoice_settings[footer]"]).toBeUndefined();
    expect(await sub(s.tenantId)).toMatchObject({ status: "active", provider: "stripe", planCode: "list", priceMinor: 4900, freeUntil: new Date("2026-12-10T00:00:00Z"), startedAt: GO_LIVE });
    await expect(startAs(s)).rejects.toMatchObject({ code: "BILLING_STATE" });
  });

  it("keeps the operator's founding plan and applies the 19 % rate in standard VAT mode", async () => {
    setEnv({ BILLING_VAT_MODE: "standard", STRIPE_TAX_RATE_ID: "txr_test00000001" });
    const s = await shop();
    await setTenantPlan({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, planCode: "founding" });
    expect(await startAs(s)).toMatchObject({ planCode: "founding" });
    expect(stripe.calls.find(call => call.method === "POST" && call.path === "/subscriptions")!.params).toMatchObject({ "items[0][price]": "price_founding0001", "default_tax_rates[0]": "txr_test00000001" });
  });

  it("ends the contract inside the free month on the last free day, before Stripe could draw the first invoice (§ 2 (3))", async () => {
    const s = await shop();
    await startAs(s);
    const subscriptionId = (await sub(s.tenantId)).providerSubscriptionId!;
    const inside = new Date("2026-11-20T10:00:00Z");
    await expect(endInFreeMonth({ actorUserId: s.ownerId, env: process.env, tenantId: s.tenantId, at: inside })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: inside })).toMatchObject({ lastFreeDay: "2026-12-09" });
    const cancel = stripe.calls.filter(call => call.method === "POST" && call.path === `/subscriptions/${subscriptionId}`).at(-1)!;
    // 9 Dec 21:00 UTC: still 9 December in Berlin, and before the first billing date (10 Dec 00:00 UTC).
    expect(cancel.params).toEqual({ cancel_at: String(Math.floor(new Date("2026-12-09T21:00:00Z").getTime() / 1000)), proration_behavior: "none" });
    expect(await sub(s.tenantId)).toMatchObject({ cancelAtPeriodEnd: true });
    // Stripe's update arrives: the programmes get the last free day as their provisional end, for the operator to confirm.
    await deliver(eventFor("customer.subscription.updated", subscriptionId));
    expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: "2026-12-09", cancellationConfirmedAt: null });
    await expect(endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: new Date("2026-12-10T01:00:00Z") })).rejects.toMatchObject({ code: "BILLING_STATE" });
  });

  it("ends it at once in the last hours of the free month, when that end time has passed, with no final invoice (review N-2)", async () => {
    const s = await shop();
    await startAs(s);
    const subscriptionId = (await sub(s.tenantId)).providerSubscriptionId!;
    // 9 Dec 22:30 UTC: still 9 December in Berlin until midnight, but past 21:00 UTC.
    await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: new Date("2026-12-09T22:30:00Z") });
    expect(stripe.calls.filter(call => call.path === `/subscriptions/${subscriptionId}`).at(-1)).toMatchObject({ method: "DELETE", params: { invoice_now: "false", prorate: "false" } });
    expect(stripe.calls.some(call => call.method === "POST" && call.path === `/subscriptions/${subscriptionId}` && "cancel_at" in call.params)).toBe(false);
    expect(await sub(s.tenantId)).toMatchObject({ cancelAtPeriodEnd: true });
  });

  it("refuses a go-live without the recipient's full name and address, before any Stripe call", async () => {
    const s = await shop();
    const noEmail = Object.fromEntries(Object.entries(RECIPIENT).filter(([key]) => key !== "email"));
    for (const billing of [null, { ...RECIPIENT, postalCode: "3411" }, { ...RECIPIENT, line1: "" }, { ...RECIPIENT, extra: "x" }, noEmail, { ...RECIPIENT, email: "keine-adresse" }]) {
      await expect(startAs(s, GO_LIVE, billing)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(stripe.calls).toHaveLength(0);
  });

  it("refuses a go-live in the first hours after Berlin midnight, before any Stripe call", async () => {
    const s = await shop();
    await expect(startAs(s, new Date("2026-11-10T23:30:00Z"))).rejects.toMatchObject({ code: "BILLING_START_TIME" });
    expect(stripe.calls).toHaveLength(0);
  });

  it("undoes a subscription whose first billing date is not the promised one and records nothing", async () => {
    const s = await shop();
    stripe.clock.anchorOverride = Math.floor(GO_LIVE.getTime() / 1000) + 3600;
    await expect(startAs(s)).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    const created = stripe.calls.find(call => call.method === "POST" && call.path === "/subscriptions")!;
    expect(stripe.calls.some(call => call.method === "DELETE" && call.path.startsWith("/subscriptions/sub_test"))).toBe(true);
    expect(created).toBeTruthy();
    expect(await sub(s.tenantId)).toMatchObject({ providerSubscriptionId: null, freeUntil: null, status: "manual_pending" });
  });
});

describe("the operator's confirmed shop end ends the Stripe subscription (ENG-125)", () => {
  const NOW = new Date("2026-11-10T10:00:00Z");
  // With consent: these tests are about Stripe; the consent rule itself is pinned in programme-end's tests.
  const confirm = (s: { operatorId: string }, programId: string, endDate: string, now = NOW, execute = true) => operatorProgramme({ actorUserId: s.operatorId, env: process.env, programId, command: "schedule", endDate, consent: true, execute, now });
  const endCalls = (subscriptionId: string) => stripe.calls.filter(call => call.path === `/subscriptions/${subscriptionId}` && (call.method === "DELETE" || "cancel_at" in call.params || "cancel_at_period_end" in call.params));
  const PERIOD_END_AT = seconds(PERIOD_END);
  // The shop's billing month renews: Stripe's period moves on one month (the fake's clock, as a renewal would).
  const renew = (fake: FakeSub, to: Date) => { fake.items.data[0].current_period_end = seconds(to); };
  const withdraw = async (s: { ownerId: string; programId: string }, now = NOW) => withdrawCancellation({ actorUserId: s.ownerId, programSlug: (await programme(s.programId)).slug, now });

  // subscribed(): billed on the 2nd, so a billing month runs from the 2nd to the 1st; valid ends are 1 Dec, 1 Jan, …
  it("ends the billing month that holds the confirmed end, in full: cancel_at_period_end, so no further invoice", async () => {
    const s = await subscribed();
    await confirm(s, s.programId, "2026-12-01");
    expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([{ cancel_at_period_end: "true" }]);
    expect(s.fake()).toMatchObject({ cancel_at_period_end: true, cancel_at: null });
    expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: PERIOD_END, cancelAtPeriodEnd: true });
  });

  it("holds an end in a later billing month here and never sends a future cancel_at; the renewal sends it (review R-2)", async () => {
    const s = await subscribed();
    await confirm(s, s.programId, "2027-01-01");
    expect(endCalls(s.subscriptionId)).toEqual([]);
    expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: null, cancelAtPeriodEnd: false });
    expect(await runBillingJob()).toMatchObject({ ends: 0 });
    // 2 Dec: Stripe renews and bills December in full; the update webhook then ends the subscription with that month.
    renew(s.fake(), new Date("2027-01-02T10:00:00Z"));
    await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
    expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([{ cancel_at_period_end: "true" }]);
    expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: new Date("2027-01-02T10:00:00Z") });
    expect(stripe.calls.some(call => "cancel_at" in call.params && call.params.cancel_at !== "")).toBe(false);
  });

  it("the daily job sends it once the month has begun, also when the renewal webhook never arrived", async () => {
    const s = await subscribed();
    await confirm(s, s.programId, "2027-01-01");
    renew(s.fake(), new Date("2027-01-02T10:00:00Z"));
    expect(await runBillingJob()).toMatchObject({ ends: 1 });
    expect(await runBillingJob()).toMatchObject({ ends: 0 });
    expect(endCalls(s.subscriptionId)).toHaveLength(1);
  });

  it("a go-live on the 31st bills on the shorter month's last day: 27 February ends a billing month, 28 February doesn't (G1d)", async () => {
    const s = await shop();
    const goLive = new Date("2026-12-31T10:00:00Z");
    stripe.clock.now = goLive;
    await startBilling({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, billing: { name: "Synthetische Inhaberin", line1: "Beispielweg 2", postalCode: "34117", city: "Kassel", email: "rechnung@example.test" }, at: goLive });
    await expect(confirm(s, s.programId, "2027-02-28", new Date("2027-01-05T10:00:00Z"))).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2027-03-30") });
    await confirm(s, s.programId, "2027-02-27", new Date("2027-01-05T10:00:00Z"));
    expect((await programme(s.programId)).cancellationEndDate).toBe("2027-02-27");
  });

  it("refuses a confirmed end that isn't the last day of a billing month, naming the next valid day (G-1)", async () => {
    const s = await subscribed();
    for (const execute of [false, true]) {
      await expect(confirm(s, s.programId, "2026-11-30", NOW, execute)).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2026-12-01") });
    }
    await expect(confirm(s, s.programId, "2026-12-31")).rejects.toMatchObject({ message: expect.stringContaining("2027-01-01") });
    expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: null, cancellationConfirmedAt: null });
    expect(endCalls(s.subscriptionId)).toEqual([]);
  });

  it("is safe to retry: a repeated confirmation, a second sync and the daily job call Stripe no second time", async () => {
    const s = await subscribed();
    await confirm(s, s.programId, "2026-12-01");
    await confirm(s, s.programId, "2026-12-01");
    expect(await syncShopEnd(s.tenantId, NOW)).toMatchObject({ action: "unchanged" });
    expect(await runBillingJob()).toMatchObject({ ends: 0 });
    expect(endCalls(s.subscriptionId)).toHaveLength(1);
    // Moved into a later month: Stripe's end is taken back, to be sent at that month's renewal.
    await confirm(s, s.programId, "2027-01-01");
    expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([{ cancel_at_period_end: "true" }, { cancel_at_period_end: "false" }]);
  });

  it("keeps the confirmed date when Stripe fails; running it again or the daily job finishes it once", async () => {
    const s = await subscribed();
    stripe.failing.add(`/subscriptions/${s.subscriptionId}`);
    await expect(confirm(s, s.programId, "2026-12-01")).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: "2026-12-01" });
    expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: null, cancelAtPeriodEnd: false });
    stripe.failing.clear();
    expect(await runBillingJob()).toMatchObject({ ends: 1 });
    expect(await runBillingJob()).toMatchObject({ ends: 0 });
    expect(s.fake().cancel_at_period_end).toBe(true);
  });

  it("one shop's Stripe error does not stop the daily job for the other shops (review N-1)", async () => {
    const broken = await subscribed();
    await db.update(programs).set({ cancellationEndDate: "2026-12-01", cancellationConfirmedAt: NOW }).where(eq(programs.id, broken.programId));
    const fine = await subscribed();
    await db.update(programs).set({ cancellationEndDate: "2026-12-01", cancellationConfirmedAt: NOW }).where(eq(programs.id, fine.programId));
    stripe.failing.add(`/subscriptions/${broken.subscriptionId}`);
    expect(await runBillingJob()).toMatchObject({ ends: 1 });
    expect(fine.fake().cancel_at_period_end).toBe(true);
    expect(await sub(broken.tenantId)).toMatchObject({ billingEndsAt: null });
  });

  it("sends the ends first, so a quantity or credit failure for another shop can't let a held end renew (review N-1b)", async () => {
    const broken = await subscribed();
    await db.update(subscriptions).set({ activeLocationCount: 2 }).where(eq(subscriptions.tenantId, broken.tenantId));
    stripe.failing.add(`/subscription_items/si_${broken.subscriptionId}`);
    const ending = await subscribed();
    await db.update(programs).set({ cancellationEndDate: "2026-12-01", cancellationConfirmedAt: NOW }).where(eq(programs.id, ending.programId));
    await expect(runBillingJob()).rejects.toMatchObject({ code: "PROVIDER_ERROR" });
    expect(ending.fake().cancel_at_period_end).toBe(true);
  });

  it("one date for the whole business (ENG-167): confirming one location ends every location, with one Stripe call", async () => {
    const s = await subscribed();
    const second = await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    await confirm(s, s.programId, "2026-12-01");
    expect(await programme(second.programId)).toMatchObject({ cancellationEndDate: "2026-12-01" });
    expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([{ cancel_at_period_end: "true" }]);
  });

  it("clears Stripe's end when the owner withdraws, so the shop keeps running and paying", async () => {
    const s = await subscribed();
    await confirm(s, s.programId, "2026-12-01");
    await withdraw(s);
    expect(endCalls(s.subscriptionId).at(-1)!.params).toEqual({ cancel_at_period_end: "false" });
    expect(s.fake().cancel_at_period_end).toBe(false);
    expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: null, cancelAtPeriodEnd: false });
    // The same end again is a new transition with its own idempotency key, so Stripe applies it instead of replaying the first.
    await confirm(s, s.programId, "2026-12-01");
    const keys = endCalls(s.subscriptionId).map(call => call.key);
    expect(keys).toHaveLength(3);
    expect(new Set(keys).size).toBe(3);
    expect(s.fake().cancel_at_period_end).toBe(true);
  });

  it("an immediate end bills the running month in full and ends with it, once", async () => {
    const s = await subscribed();
    await operatorProgramme({ actorUserId: s.operatorId, env: process.env, programId: s.programId, command: "end", execute: true });
    expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([{ cancel_at_period_end: "true" }]);
    expect(await runBillingJob()).toMatchObject({ ends: 0 });
    expect(endCalls(s.subscriptionId)).toHaveLength(1);
    expect(PERIOD_END_AT).toBe(s.fake().items.data[0].current_period_end);
  });

  describe("inside the free month (#160's rule)", () => {
    const GO_LIVE = new Date("2026-11-10T10:00:00Z");
    const INSIDE = new Date("2026-11-20T10:00:00Z");
    const RECIPIENT = { name: "Synthetische Inhaberin", line1: "Beispielweg 2", postalCode: "34117", city: "Kassel", email: "rechnung@example.test" };
    const live = async () => {
      const s = await shop();
      stripe.clock.now = GO_LIVE;
      await startBilling({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, billing: RECIPIENT, at: GO_LIVE });
      const subscriptionId = (await sub(s.tenantId)).providerSubscriptionId!;
      return { ...s, subscriptionId, fake: () => stripe.subs.get(subscriptionId)! };
    };
    // free_until 10 Dec 00:00 UTC less 3 hours: 9 Dec 21:00 UTC, the last free day in Berlin, before the first invoice.
    const FREE_END = String(seconds(new Date("2026-12-09T21:00:00Z")));
    const FREE_PARAMS = { cancel_at: FREE_END, proration_behavior: "none" };

    it("ends at free_until − 3 h on the last free day, the first month's end: no first invoice; any other free day is refused", async () => {
      const s = await live();
      await expect(confirm(s, s.programId, "2026-12-05", INSIDE)).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2026-12-09") });
      await confirm(s, s.programId, "2026-12-09", INSIDE);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("„Gekündigt im kostenlosen Monat“ is recorded at once; the confirmation of the proposed day calls Stripe no second time", async () => {
      const s = await live();
      await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: INSIDE });
      expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: new Date("2026-12-09T21:00:00Z"), cancelAtPeriodEnd: true });
      // Proposed at once, not only by the webhook, so the sweep never reads it as withdrawn.
      expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: "2026-12-09", cancellationConfirmedAt: null });
      expect(await runBillingJob()).toMatchObject({ ends: 0 });
      await confirm(s, s.programId, "2026-12-09", INSIDE);
      expect(endCalls(s.subscriptionId)).toHaveLength(1);
    });

    it("a withdrawal after „Gekündigt im kostenlosen Monat“, before the confirmation, clears Stripe's end too (review N-2)", async () => {
      const s = await live();
      await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: INSIDE });
      await withdraw(s, INSIDE);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS, { cancel_at: "", proration_behavior: "none" }]);
      expect(s.fake().cancel_at).toBeNull();
      expect(await sub(s.tenantId)).toMatchObject({ billingEndsAt: null, cancelAtPeriodEnd: false });
    });

    it("moves an end first confirmed for month two into the free month with a Stripe call (review N-3, M10)", async () => {
      const s = await live();
      await confirm(s, s.programId, "2027-01-09", INSIDE);
      expect(endCalls(s.subscriptionId)).toEqual([]);
      await confirm(s, s.programId, "2026-12-09", INSIDE);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("after „Gekündigt im kostenlosen Monat“, a confirmed end in month two lifts the free-month end and ends with month two (M11)", async () => {
      const s = await live();
      await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: INSIDE });
      await confirm(s, s.programId, "2027-01-09", INSIDE);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS, { cancel_at: "", proration_behavior: "none" }]);
      // 10 Dec: month two starts, billed in full; then Stripe ends with it.
      renew(s.fake(), new Date("2027-01-10T00:00:00Z"));
      await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
      expect(endCalls(s.subscriptionId).at(-1)!.params).toEqual({ cancel_at_period_end: "true" });
    });

    const requested = (programId: string, at: string) => db.update(programs).set({ cancellationRequestedAt: new Date(at) }).where(eq(programs.id, programId));

    it("a request on the last free day at 23:59 Berlin costs nothing: the end is request day + 14, Stripe ends at once without an invoice", async () => {
      const s = await live();
      const late = new Date("2026-12-09T22:59:00Z"); // 23:59 Berlin on 9 December
      await requested(s.programId, late.toISOString());
      await expect(confirm(s, s.programId, "2026-12-20", late)).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2026-12-23") });
      await expect(confirm(s, s.programId, "2026-12-24", late)).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END" });
      await confirm(s, s.programId, "2026-12-23", late);
      expect(endCalls(s.subscriptionId)).toEqual([expect.objectContaining({ method: "DELETE", params: { invoice_now: "false", prorate: "false" } })]);
    });

    it("a request on day 25 of the free month ends on day 39, with no month-two charge; a later end needs the shop's consent and is billed", async () => {
      const s = await live();
      const day25 = new Date("2026-12-04T10:00:00Z"); // go-live 10 Nov is day 1
      await requested(s.programId, day25.toISOString());
      await expect(confirm(s, s.programId, "2026-12-17", day25)).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2026-12-18") });
      await confirm(s, s.programId, "2026-12-18", day25);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
      // Nothing more reaches Stripe before the free month ends, so month two is never billed; the programme runs on to 18 December.
      expect(await runBillingJob()).toMatchObject({ ends: 0 });
      expect(endCalls(s.subscriptionId)).toHaveLength(1);
    });

    it("an end the shop agrees to after its notice end is billed: the free-month end is lifted, month two ends it", async () => {
      const s = await live();
      const day25 = new Date("2026-12-04T10:00:00Z");
      await requested(s.programId, day25.toISOString());
      await confirm(s, s.programId, "2026-12-18", day25);
      await confirm(s, s.programId, "2027-01-09", day25);
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS, { cancel_at: "", proration_behavior: "none" }]);
      renew(s.fake(), new Date("2027-01-10T00:00:00Z"));
      await deliver(eventFor("customer.subscription.updated", s.subscriptionId));
      expect(endCalls(s.subscriptionId).at(-1)!.params).toEqual({ cancel_at_period_end: "true" });
    });

    it("a request after the free month follows the billing-month rule", async () => {
      const s = await live();
      await requested(s.programId, "2026-12-15T10:00:00Z");
      await expect(confirm(s, s.programId, "2026-12-29", new Date("2026-12-15T11:00:00Z"))).rejects.toMatchObject({ message: expect.stringContaining("2027-01-09") });
      await confirm(s, s.programId, "2027-01-09", new Date("2026-12-15T11:00:00Z"));
      expect(endCalls(s.subscriptionId)).toEqual([]);
    });

    it("an ended location's old request doesn't count (review R-3); the earliest running request does (F6)", async () => {
      const s = await live();
      const second = await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
      await db.update(programs).set({ status: "ended", cancellationEndDate: "2026-10-31", cancellationConfirmedAt: new Date("2026-10-15T10:00:00Z"), cancellationRequestedAt: new Date("2026-10-15T10:00:00Z") }).where(eq(programs.id, second.programId));
      await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: new Date("2026-12-04T10:00:00Z") });
      await confirm(s, s.programId, "2026-12-18", new Date("2026-12-04T11:00:00Z"));
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
      // Two running locations: the earliest request inside the free month counts, a later one after it doesn't.
      const t = await live();
      const third = await createAdditionalLocation(t.ownerId, { name: "Third counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Third card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
      await requested(t.programId, "2026-12-04T10:00:00Z");
      await requested(third.programId, "2026-12-15T10:00:00Z");
      await confirm(t, t.programId, "2026-12-18", new Date("2026-12-04T11:00:00Z"));
      await confirm(t, third.programId, "2026-12-18", new Date("2026-12-04T11:00:00Z"));
      expect(endCalls(t.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("an ended location's request after go-live doesn't count either: the running location's later request decides (review N-7)", async () => {
      const s = await live();
      const second = await createAdditionalLocation(s.ownerId, { name: "Second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
      // Free day 5: the second location was ended at once; its request would make the notice end the last free day.
      await db.update(programs).set({ status: "ended", cancellationEndDate: "2026-11-14", cancellationConfirmedAt: new Date("2026-11-14T10:00:00Z"), cancellationRequestedAt: new Date("2026-11-14T10:00:00Z") }).where(eq(programs.id, second.programId));
      await requested(s.programId, "2026-12-04T10:00:00Z"); // free day 25
      await confirm(s, s.programId, "2026-12-18", new Date("2026-12-04T11:00:00Z"));
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("a request from before this subscription started doesn't count as a free-month request (CTO ruling on R-3)", async () => {
      const s = await live();
      // A running programme still carries a request older than go-live (10 Nov): it opens no free-month notice end.
      await requested(s.programId, "2026-11-01T10:00:00Z");
      await expect(confirm(s, s.programId, "2026-11-15", new Date("2026-11-12T10:00:00Z"))).rejects.toMatchObject({ code: "NOT_BILLING_MONTH_END", message: expect.stringContaining("2026-12-09") });
      await confirm(s, s.programId, "2026-12-09", new Date("2026-11-12T10:00:00Z"));
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("„Gekündigt im kostenlosen Monat“ late in the month proposes request day + 14", async () => {
      const s = await live();
      await endInFreeMonth({ actorUserId: s.operatorId, env: process.env, tenantId: s.tenantId, at: new Date("2026-12-04T10:00:00Z") });
      expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: "2026-12-18", cancellationConfirmedAt: null });
      await confirm(s, s.programId, "2026-12-18", new Date("2026-12-04T11:00:00Z"));
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
    });

    it("an owner's cancellation in the free month binds and tells Stripe at once, before anyone confirms (ENG-167)", async () => {
      const s = await live();
      const day25 = new Date("2026-12-04T10:00:00Z");
      expect(await requestCancellation({ actorUserId: s.ownerId, programSlug: (await programme(s.programId)).slug, now: day25 })).toEqual({ endDate: "2026-12-18", confirmed: true });
      expect(endCalls(s.subscriptionId).map(call => call.params)).toEqual([FREE_PARAMS]);
      // The operator's confirmation keeps it: nothing more reaches Stripe.
      await confirm(s, s.programId, "2026-12-18", new Date("2026-12-05T10:00:00Z"));
      expect(endCalls(s.subscriptionId)).toHaveLength(1);
    });

    it("an e-mailed cancellation that arrived in the free month but is entered after the first invoice costs nothing: the invoice is voided", async () => {
      const s = await live();
      const fake = stripe.subs.get(s.subscriptionId)!;
      stripe.invoices.set("in_testmonth2", { id: "in_testmonth2", status: "open", created: seconds(new Date("2026-12-10T00:00:00Z")), subscription: s.subscriptionId, customer: fake.customer, billing_reason: "subscription_cycle" });
      stripe.invoices.set("in_testdraft", { id: "in_testdraft", status: "draft", created: seconds(new Date("2026-12-10T00:05:00Z")), subscription: s.subscriptionId, customer: fake.customer, billing_reason: "subscription_cycle" });
      const entered = new Date("2026-12-10T08:00:00Z");
      // Arrived 9 December, 23:30 Berlin: on the last free day.
      await operatorProgramme({ actorUserId: s.operatorId, env: process.env, programId: s.programId, command: "request", receivedAt: "2026-12-09T23:30:00+01:00", execute: true, now: entered });
      expect(await programme(s.programId)).toMatchObject({ cancellationEndDate: "2026-12-23" });
      expect(endCalls(s.subscriptionId)).toEqual([expect.objectContaining({ method: "DELETE", params: { invoice_now: "false", prorate: "false" } })]);
      expect(stripe.invoices.get("in_testmonth2")).toMatchObject({ status: "void" });
      expect(stripe.invoices.has("in_testdraft")).toBe(false);
    });

    it("ends at once, with no invoice, when the free month's end time has already passed, once", async () => {
      const s = await live();
      const late = new Date("2026-12-09T22:30:00Z"); // 23:30 Berlin on the last free day, after 21:00 UTC
      await db.update(programs).set({ cancellationEndDate: "2026-12-09", cancellationConfirmedAt: late }).where(eq(programs.id, s.programId));
      expect(await syncShopEnd(s.tenantId, late)).toMatchObject({ action: "ended" });
      expect(endCalls(s.subscriptionId)).toEqual([expect.objectContaining({ method: "DELETE", params: { invoice_now: "false", prorate: "false" } })]);
      expect(await syncShopEnd(s.tenantId, late)).toMatchObject({ action: "unchanged" });
    });
  });
});
