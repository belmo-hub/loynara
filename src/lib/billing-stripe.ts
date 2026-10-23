import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { billingHandoffs, billingLocationPlans, billingWebhookEvents, programs, subscriptions, tenants } from "@/db/schema";
import { ownerTenant } from "./billing";
import { DomainError } from "./loyalty";
import { assertPlateOperator } from "./plates";
import { GUARANTEE_LINE, guaranteeSettings, isPlanCode, PLANS, stripeEnabled, VAT_NOTE, vatMode, type PlanCode } from "./stripe-config";

/**
 * Real billing through Stripe (ENG-055): hosted Checkout for the monthly subscription, the hosted customer portal for card
 * changes, invoices and cancellation, and signed webhooks. Runs only when the billing group is fully configured AND the
 * billing surface is shown; otherwise the local fixture in ./billing stays the only provider.
 */
type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const STRIPE_API_VERSION = "2025-03-31.basil";
const SIGNATURE_WINDOW_MS = 5 * 60_000;
export const STRIPE_EVENT_MAX_BYTES = 256 * 1024;
// A suspended (unpaid) subscription still exists in Stripe: the owner fixes the card in the portal, never a second checkout.
const CHECKOUT_OPEN = ["manual_pending", "pending_checkout", "cancelled"];
const RUNNING = ["active", "past_due", "suspended"];

export type StripeClient = (method: "GET" | "POST", path: string, params?: Record<string, string>, idempotencyKey?: string) => Promise<unknown>;

const httpClient: StripeClient = async (method, path, params, idempotencyKey) => {
  if (process.env.NODE_ENV === "test") throw new Error("Tests must use a fake Stripe client");
  const form = new URLSearchParams(params).toString();
  const response = await fetch(`https://api.stripe.com/v1${path}${method === "GET" && form ? `?${form}` : ""}`, {
    method, signal: AbortSignal.timeout(10_000),
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "Stripe-Version": STRIPE_API_VERSION, "Content-Type": "application/x-www-form-urlencoded", ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}) },
    body: method === "POST" ? form : undefined,
  });
  const json = await response.json().catch(() => null) as { error?: { code?: string } } | null;
  // Stripe's error message can quote request values; only the status and the error code leave this function.
  if (!response.ok) throw new DomainError("PROVIDER_ERROR", `Stripe request failed (${response.status}${json?.error?.code ? `, ${json.error.code}` : ""})`);
  return json;
};
let client: StripeClient = httpClient;
/** Test seam: tests install a fake; never the real API. */
export function setStripeClient(next?: StripeClient) { client = next ?? httpClient; }

function requireStripe() { if (!stripeEnabled()) throw new DomainError("BILLING_DISABLED", "Live billing is unavailable"); }

const berlinDay = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);
const appUrl = (path: string) => new URL(path, process.env.PUBLIC_BASE_URL).toString();

const checkoutSession = z.object({ id: z.string().regex(/^cs_[A-Za-z0-9_]+$/), status: z.enum(["open", "complete", "expired"]), url: z.string().startsWith("https://checkout.stripe.com/").nullable() });
const stripePrice = z.object({ id: z.string(), active: z.boolean(), currency: z.string(), unit_amount: z.number().int().nullable(), recurring: z.object({ interval: z.string(), interval_count: z.number() }).nullable() });
const stripeSubscription = z.object({
  id: z.string().regex(/^sub_[A-Za-z0-9]+$/), customer: z.string(), start_date: z.number().int(),
  status: z.enum(["active", "trialing", "past_due", "unpaid", "paused", "canceled", "incomplete", "incomplete_expired"]),
  cancel_at_period_end: z.boolean(), cancel_at: z.number().int().nullable(), ended_at: z.number().int().nullable(),
  metadata: z.object({ tenant_id: z.uuid() }),
  items: z.object({ data: z.array(z.object({ id: z.string(), quantity: z.number().int(), current_period_end: z.number().int() })).min(1) }),
});
const stripeInvoice = z.object({
  id: z.string().regex(/^in_[A-Za-z0-9]+$/), customer: z.string(), status: z.string(), billing_reason: z.string().nullable(), created: z.number().int(),
  parent: z.object({ subscription_details: z.object({ subscription: z.string() }).nullable().optional() }).nullable().optional(),
  lines: z.object({ data: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.string()).nullable().optional() })) }).optional(),
});
const taggedList = z.object({ data: z.array(z.object({ id: z.string(), metadata: z.record(z.string(), z.string()).nullable().optional() })) });
const stripeEvent = z.object({ id: z.string().regex(/^evt_[A-Za-z0-9]{8,100}$/), type: z.string().max(64), data: z.object({ object: z.object({ id: z.string().max(120) }) }) });

/** Our states for Stripe's. `incomplete_expired` is a first payment that never happened: back to the start, not a cancellation. */
export const STRIPE_STATUS = {
  active: "active", trialing: "active", past_due: "past_due", unpaid: "suspended", paused: "suspended",
  canceled: "cancelled", incomplete: "pending_checkout", incomplete_expired: "manual_pending",
} as const;

async function lockedSubscription(tx: Transaction, tenantId: string) {
  const [sub] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).for("update");
  if (!sub) throw new DomainError("NOT_FOUND", "Subscription not found");
  return sub;
}

/** Owner: open (or reuse) a Stripe Checkout for the operator-chosen plan, one unit per location. */
export async function createStripeCheckout(actorUserId: string, at = new Date()) {
  requireStripe();
  // shortcut: Stripe calls run inside the row lock, which serializes one shop's checkouts (no second open session); fine at pilot volume.
  return db.transaction(async tx => {
    const tenantId = await ownerTenant(actorUserId, tx);
    const sub = await lockedSubscription(tx, tenantId);
    if (!CHECKOUT_OPEN.includes(sub.status)) throw new DomainError("BILLING_STATE", "Für dieses Geschäft läuft bereits ein Abo.");
    if (!isPlanCode(sub.planCode) || sub.currency !== "EUR") throw new DomainError("PLAN_UNAVAILABLE", "Der Tarif wird noch festgelegt. Bitte wende dich an Loynara.");
    const plan = PLANS[sub.planCode];
    const amountMinor = plan.priceMinor * sub.activeLocationCount;
    const [pending] = await tx.select().from(billingHandoffs).where(and(eq(billingHandoffs.tenantId, tenantId), eq(billingHandoffs.provider, "stripe"), eq(billingHandoffs.status, "pending")))
      .orderBy(desc(billingHandoffs.createdAt)).limit(1);
    if (pending?.providerRef) {
      const open = checkoutSession.parse(await client("GET", `/checkout/sessions/${pending.providerRef}`));
      if (open.status === "open" && open.url && pending.amountMinor === amountMinor) return { provider: "stripe" as const, url: open.url };
      if (open.status === "complete") throw new DomainError("BILLING_STATE", "Die Zahlung wird gerade bestätigt. Bitte lade die Seite gleich neu.");
      // The total changed (a location was added): close the old session so it can never complete later.
      if (open.status === "open") await client("POST", `/checkout/sessions/${open.id}/expire`, {}, `expire-${open.id}`);
      await tx.update(billingHandoffs).set({ status: "expired", completedAt: at }).where(eq(billingHandoffs.id, pending.id));
    }
    const price = stripePrice.parse(await client("GET", `/prices/${process.env[plan.priceEnv]}`));
    if (!price.active || price.currency !== "eur" || price.unit_amount !== plan.priceMinor || price.recurring?.interval !== "month" || price.recurring.interval_count !== 1) {
      throw new DomainError("PLAN_MISCONFIGURED", "The Stripe price does not match the plan");
    }
    const standardVat = vatMode() === "standard";
    if (standardVat) {
      const rate = z.object({ active: z.boolean(), percentage: z.number(), inclusive: z.boolean() }).parse(await client("GET", `/tax_rates/${process.env.STRIPE_TAX_RATE_ID}`));
      if (!rate.active || rate.percentage !== 19 || rate.inclusive) throw new DomainError("PLAN_MISCONFIGURED", "The Stripe tax rate must be an active, exclusive 19 % rate");
    }
    let customerId = sub.providerCustomerId;
    if (!customerId) {
      const [shop] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId));
      // Every invoice names the shop (custom field) next to the owner's name and address that Checkout collects. Kleinunternehmer:
      // the § 19 UStG note is the footer and prices carry no tax rate.
      // shortcut: the VAT mode is fixed per customer and subscription at checkout; switching a running shop needs a one-time Stripe update, add a job if an operator ever registers for VAT mid-contract.
      const customer = z.object({ id: z.string().regex(/^cus_[A-Za-z0-9]+$/) }).parse(await client("POST", "/customers", {
        "metadata[tenant_id]": tenantId, "preferred_locales[0]": "de", "invoice_settings[custom_fields][0][name]": "Geschäft", "invoice_settings[custom_fields][0][value]": shop.name.slice(0, 140),
        ...(standardVat ? {} : { "invoice_settings[footer]": VAT_NOTE }),
      }, `customer-${tenantId}`));
      customerId = customer.id;
      await tx.update(subscriptions).set({ providerCustomerId: customerId }).where(eq(subscriptions.tenantId, tenantId));
    }
    const [handoff] = await tx.insert(billingHandoffs).values({ tenantId, provider: "stripe", currency: "EUR", amountMinor, createdAt: at }).returning();
    const session = checkoutSession.parse(await client("POST", "/checkout/sessions", {
      mode: "subscription", customer: customerId, client_reference_id: tenantId, locale: "de",
      "line_items[0][price]": price.id, "line_items[0][quantity]": String(sub.activeLocationCount),
      "subscription_data[metadata][tenant_id]": tenantId, "metadata[handoff_id]": handoff.id,
      billing_address_collection: "required", "customer_update[address]": "auto", "customer_update[name]": "auto",
      ...(standardVat ? { "subscription_data[default_tax_rates][0]": process.env.STRIPE_TAX_RATE_ID! } : {}),
      success_url: appUrl("/merchant/billing?checkout=done"), cancel_url: appUrl("/merchant/billing"),
    }, `checkout-${handoff.id}`));
    if (session.status !== "open" || !session.url) throw new DomainError("PROVIDER_ERROR", "Stripe did not open a checkout");
    await tx.update(billingHandoffs).set({ providerRef: session.id }).where(eq(billingHandoffs.id, handoff.id));
    await tx.update(subscriptions).set({ status: "pending_checkout", updatedAt: at }).where(eq(subscriptions.tenantId, tenantId));
    return { provider: "stripe" as const, url: session.url };
  });
}

/** Owner: the Stripe customer portal (card, invoices, cancellation at period end). */
export async function createStripePortal(actorUserId: string) {
  requireStripe();
  const tenantId = await ownerTenant(actorUserId);
  const [sub] = await db.select({ customerId: subscriptions.providerCustomerId }).from(subscriptions).where(eq(subscriptions.tenantId, tenantId));
  if (!sub?.customerId) throw new DomainError("BILLING_STATE", "Es gibt noch kein Zahlungskonto für dieses Geschäft.");
  const session = z.object({ url: z.string().startsWith("https://billing.stripe.com/") }).parse(await client("POST", "/billing_portal/sessions", { customer: sub.customerId, return_url: appUrl("/merchant/billing"), locale: "de" }));
  return { provider: "stripe" as const, url: session.url };
}

/** Stripe's `Stripe-Signature`: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">[,v1=…]. Constant-time, five-minute window. */
export function verifyStripeSignature(raw: string, header: string, secret: string, at: Date) {
  const pairs = header.split(",").map(part => { const i = part.indexOf("="); return [part.slice(0, i), part.slice(i + 1)]; });
  const time = pairs.find(([key]) => key === "t")?.[1] ?? "";
  const received = pairs.filter(([key, value]) => key === "v1" && /^[a-f0-9]{64}$/.test(value)).map(([, value]) => Buffer.from(value, "hex"));
  if (!/^\d{9,11}$/.test(time) || !received.length) throw new DomainError("INVALID_SIGNATURE", "Invalid Stripe signature");
  if (Math.abs(at.getTime() - Number(time) * 1000) > SIGNATURE_WINDOW_MS) throw new DomainError("INVALID_SIGNATURE", "Expired Stripe signature");
  const expected = createHmac("sha256", secret).update(`${time}.${raw}`).digest();
  if (!received.some(value => timingSafeEqual(value, expected))) throw new DomainError("INVALID_SIGNATURE", "Invalid Stripe signature");
}

/**
 * Applies a signed `customer.subscription.*` or `invoice.created` event. Out-of-order safe: the event only says WHICH object
 * changed; what is written comes from that object as Stripe returns it now, read under the shop's row lock. Idempotent: an
 * event ID is stored once and a repeat is a no-op. Other event types are acknowledged and ignored.
 */
export async function applyStripeWebhook(raw: string, signature: string, at = new Date()) {
  requireStripe();
  if (Buffer.byteLength(raw) > STRIPE_EVENT_MAX_BYTES) throw new DomainError("TOO_LARGE", "Stripe event is too large");
  verifyStripeSignature(raw, signature, process.env.STRIPE_WEBHOOK_SECRET!, at);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new DomainError("INVALID_JSON", "Invalid Stripe event"); }
  const event = stripeEvent.parse(parsed);
  if (!event.type.startsWith("customer.subscription.") && event.type !== "invoice.created") return { status: "ignored" as const };
  const payloadHash = createHash("sha256").update(raw).digest("hex");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.id}::text, 13))`);
    const [prior] = await tx.select({ tenantId: billingWebhookEvents.tenantId }).from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, event.id));
    if (prior) return { status: "duplicate" as const, tenantId: prior.tenantId };
    if (event.type === "invoice.created") return decideStartGuarantee(tx, event.data.object.id, { eventId: event.id, eventType: event.type, payloadHash }, at);
    const current = stripeSubscription.parse(await client("GET", `/subscriptions/${event.data.object.id}`));
    const tenantId = current.metadata.tenant_id;
    const sub = await lockedSubscription(tx, tenantId);
    if (sub.providerCustomerId !== current.customer) throw new DomainError("NOT_FOUND", "Subscription does not belong to this shop");
    const status = STRIPE_STATUS[current.status];
    if (sub.providerSubscriptionId && sub.providerSubscriptionId !== current.id) {
      // A late event for a subscription this shop has replaced: record it, change nothing.
      if (status === "cancelled" || status === "manual_pending") {
        await tx.insert(billingWebhookEvents).values({ eventId: event.id, tenantId, eventType: event.type, payloadHash });
        return { status: "stale" as const };
      }
      if (RUNNING.includes(sub.status)) {
        // Stripe retries a refused event for days and only a 4xx shows; this fixed line is what someone searches for.
        console.error(`Billing: second Stripe subscription for tenant ${tenantId} refused; review in Stripe (kept ${sub.providerSubscriptionId})`);
        throw new DomainError("BILLING_STATE", "A second Stripe subscription for this shop needs review");
      }
    }
    const periodEnd = new Date(current.items.data[0].current_period_end * 1000);
    const cancelling = status !== "cancelled" && (current.cancel_at_period_end || current.cancel_at !== null);
    await tx.update(subscriptions).set({
      status, provider: "stripe", providerSubscriptionId: current.id, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: cancelling, graceUntil: null,
      startedAt: sub.providerSubscriptionId === current.id && sub.startedAt ? sub.startedAt : new Date(current.start_date * 1000), updatedAt: at,
    }).where(eq(subscriptions.tenantId, tenantId));
    if (status === "active") await tx.update(billingHandoffs).set({ status: "complete", completedAt: at }).where(and(eq(billingHandoffs.tenantId, tenantId), eq(billingHandoffs.provider, "stripe"), eq(billingHandoffs.status, "pending")));
    if (cancelling || status === "cancelled") {
      // #84: a Stripe cancellation proposes the programme's PROVISIONAL end date (the last paid Berlin day); only the operator's confirmation ends it.
      const endsAt = new Date(((current.cancel_at ?? current.ended_at) ?? current.items.data[0].current_period_end) * 1000);
      await tx.update(programs).set({ cancellationEndDate: berlinDay(endsAt), cancellationRequestedAt: at })
        .where(and(eq(programs.tenantId, tenantId), eq(programs.status, "active"), isNull(programs.cancellationEndDate)));
    } else if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd) {
      // Cancellation withdrawn in the portal: remove the provisional date this link set (same day, still unconfirmed); an owner's own request or a confirmed date stays.
      await tx.update(programs).set({ cancellationEndDate: null, cancellationRequestedAt: null })
        .where(and(eq(programs.tenantId, tenantId), eq(programs.status, "active"), isNull(programs.cancellationConfirmedAt), eq(programs.cancellationEndDate, berlinDay(sub.currentPeriodEnd))));
    }
    await tx.insert(billingWebhookEvents).values({ eventId: event.id, tenantId, eventType: event.type, payloadHash });
    return { status: "applied" as const };
  });
  // The guarantee decision is committed above; only now is the credit issued. If it fails, the error makes Stripe retry the
  // event, whose duplicate delivery lands here again and finishes the credit (the daily sweep is the backstop).
  if (event.type === "invoice.created" && "tenantId" in result && result.tenantId) await creditOwedGuarantees(result.tenantId);
  return { status: result.status };
}

/** Operator (/operator): which plan a shop gets. Locked while a Stripe subscription runs: the founding price holds for the contract term. */
export async function setTenantPlan(input: { actorUserId: string; env: Env; tenantId: string; planCode: unknown }) {
  if (!isPlanCode(input.planCode) || !z.uuid().safeParse(input.tenantId).success) throw new DomainError("INVALID_INPUT", "Invalid plan");
  const plan = PLANS[input.planCode];
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const sub = await lockedSubscription(tx, input.tenantId);
    if (sub.currency !== "EUR") throw new DomainError("PLAN_UNAVAILABLE", "Plans are priced in EUR");
    if (sub.providerSubscriptionId && RUNNING.includes(sub.status)) throw new DomainError("BILLING_STATE", "Der Tarif ist für die Vertragslaufzeit fest.");
    // An open checkout still shows the old price: close it so it can never complete at that price.
    const open = await tx.select().from(billingHandoffs).where(and(eq(billingHandoffs.tenantId, input.tenantId), eq(billingHandoffs.provider, "stripe"), eq(billingHandoffs.status, "pending")));
    for (const handoff of open) {
      if (handoff.providerRef) await client("POST", `/checkout/sessions/${handoff.providerRef}/expire`, {}, `expire-${handoff.providerRef}`);
      await tx.update(billingHandoffs).set({ status: "expired", completedAt: new Date() }).where(eq(billingHandoffs.id, handoff.id));
    }
    await tx.update(subscriptions).set({ planCode: input.planCode as PlanCode, priceMinor: plan.priceMinor, updatedAt: new Date() }).where(eq(subscriptions.tenantId, input.tenantId));
    await tx.update(billingLocationPlans).set({ priceMinor: plan.priceMinor }).where(eq(billingLocationPlans.tenantId, input.tenantId));
    return { tenantId: input.tenantId, planCode: input.planCode, priceMinor: plan.priceMinor };
  });
}

type Recorded = { eventId: string; eventType: string; payloadHash: string };

/**
 * Start guarantee (pilot agreement § 3 (5)), off by default, decided when Stripe drafts a subscription-cycle invoice, so the
 * credit lands on the month-2 invoice (a daily job could run after Stripe drew it). Per location, once: its first billing
 * month runs from the Berlin day it started billing (the subscription start, or the day a later location was added) to the
 * day before the same day a month later. It qualifies with fewer than START_GUARANTEE_MIN_CUSTOMERS distinct customers who
 * got a team-confirmed credit there (a cashier award, or an NFC tap award, which production only books after the cashier
 * confirms it; not reversed within that month; bonuses and open tap requests do not count). Outcomes: credit, reached, ineligible (cancelling or unpaid shop, contract after the cut-off day), late.
 * Only the decision is written here, in the webhook's transaction; the credit itself is issued after commit
 * (creditOwedGuarantees), so a retry can never credit twice.
 */
async function decideStartGuarantee(tx: Transaction, invoiceId: string, recorded: Recorded, at: Date) {
  const invoice = stripeInvoice.parse(await client("GET", `/invoices/${invoiceId}`));
  const subscriptionId = invoice.parent?.subscription_details?.subscription;
  const [owner] = subscriptionId ? await tx.select({ tenantId: subscriptions.tenantId }).from(subscriptions)
    .where(and(eq(subscriptions.providerSubscriptionId, subscriptionId), eq(subscriptions.providerCustomerId, invoice.customer))) : [];
  // Not an invoice of a subscription we know: nothing to decide and no shop to record the event against.
  if (!owner) return { status: "ignored" as const };
  const sub = await lockedSubscription(tx, owner.tenantId);
  const settings = guaranteeSettings(process.env);
  let decided = 0;
  if (settings && invoice.billing_reason === "subscription_cycle" && sub.startedAt) {
    const eligible = sub.status === "active" && !sub.cancelAtPeriodEnd && (!settings.cutoff || berlinDay(sub.startedAt) <= settings.cutoff);
    const invoiceAt = new Date(invoice.created * 1000).toISOString();
    // A reversal counts only inside the month it measures: one made later cannot pull a location under the threshold.
    const { rows } = await tx.execute(sql`SELECT p.location_id AS "locationId",
        ${invoiceAt}::timestamptz < ((w.first_day + interval '2 months')::date::timestamp AT TIME ZONE 'Europe/Berlin') AS "onTime",
        (SELECT count(DISTINCT l.membership_id) FROM ledger_entries l
          WHERE l.tenant_id = p.tenant_id AND l.location_id = p.location_id AND l.kind = 'award' AND l.source IN ('staff_online', 'staff_offline', 'nfc_tap')
            AND l.created_at >= w.month_start AND l.created_at < w.month_end
            AND NOT EXISTS (SELECT 1 FROM ledger_entries r WHERE r.tenant_id = l.tenant_id AND r.reversal_of_id = l.id AND r.created_at < w.month_end))::int AS customers
      FROM billing_location_plans p
      CROSS JOIN LATERAL (SELECT (greatest(${sub.startedAt.toISOString()}::timestamptz, p.created_at) AT TIME ZONE 'Europe/Berlin')::date AS first_day) d
      CROSS JOIN LATERAL (SELECT d.first_day, (d.first_day::timestamp AT TIME ZONE 'Europe/Berlin') AS month_start,
        ((d.first_day + interval '1 month')::date::timestamp AT TIME ZONE 'Europe/Berlin') AS month_end) w
      WHERE p.tenant_id = ${sub.tenantId} AND p.guarantee_decided_at IS NULL AND ${invoiceAt}::timestamptz >= w.month_end
      ORDER BY p.location_id`);
    for (const row of rows as Array<{ locationId: string; onTime: boolean; customers: number }>) {
      const outcome = !eligible ? "ineligible" : !row.onTime ? "late" : row.customers < settings.minCustomers ? "credit" : "reached";
      await tx.update(billingLocationPlans).set({ guaranteeDecidedAt: at, guaranteeCustomers: row.customers, guaranteeOutcome: outcome, guaranteeInvoiceId: outcome === "credit" ? invoice.id : null })
        .where(and(eq(billingLocationPlans.tenantId, sub.tenantId), eq(billingLocationPlans.locationId, row.locationId)));
      decided += 1;
    }
  }
  await tx.insert(billingWebhookEvents).values({ ...recorded, tenantId: sub.tenantId });
  return { status: decided ? "applied" as const : "ignored" as const, tenantId: sub.tenantId };
}

/**
 * Issues every start-guarantee credit that is decided but not yet in Stripe (one shop, or all for the daily sweep). Each one
 * runs under its location row's lock with the key (invoice, location), sent both as the idempotency key and as metadata: a
 * line „Monat 2 kostenlos – Startgarantie“ of the location's monthly price on the month-2 invoice while it is a draft, or,
 * once Stripe finalized it, a credit note on that invoice with the same line and amount. A credit Stripe already holds under
 * that key (issued, but its id never stored, even after the 24-hour idempotency window) is recorded instead of issued again.
 * A failure leaves the credit owed (shown on /operator) and the next webhook retry or the daily sweep issues it.
 */
export async function creditOwedGuarantees(tenantId?: string) {
  const owed = await db.select({ tenantId: billingLocationPlans.tenantId, locationId: billingLocationPlans.locationId }).from(billingLocationPlans)
    .where(and(eq(billingLocationPlans.guaranteeOutcome, "credit"), isNull(billingLocationPlans.guaranteeCreditRef), tenantId ? eq(billingLocationPlans.tenantId, tenantId) : undefined));
  let credited = 0;
  for (const owedRow of owed) {
    credited += await db.transaction(async tx => {
      const [row] = await tx.select().from(billingLocationPlans).where(and(eq(billingLocationPlans.tenantId, owedRow.tenantId), eq(billingLocationPlans.locationId, owedRow.locationId), isNull(billingLocationPlans.guaranteeCreditRef))).for("update");
      if (!row?.guaranteeInvoiceId) return 0;
      const invoice = stripeInvoice.parse(await client("GET", `/invoices/${row.guaranteeInvoiceId}`));
      const key = `guarantee-${invoice.id}-${row.locationId}`;
      const tagged = (list: { id: string; metadata?: Record<string, string> | null }[] | undefined) => list?.find(item => item.metadata?.guarantee_key === key)?.id;
      // shortcut: reads the invoice's first page of lines and credit notes; a month-2 invoice has one line per location plus its credits, far below a page.
      const existing = tagged(invoice.lines?.data)
        ?? (invoice.status === "draft" ? undefined : tagged(taggedList.parse(await client("GET", "/credit_notes", { invoice: invoice.id, limit: "100" })).data));
      if (existing) {
        await tx.update(billingLocationPlans).set({ guaranteeCreditRef: existing }).where(and(eq(billingLocationPlans.tenantId, row.tenantId), eq(billingLocationPlans.locationId, row.locationId)));
        return 1;
      }
      const taxRate = vatMode() === "standard" ? process.env.STRIPE_TAX_RATE_ID! : null;
      // shortcut: a credit note on a paid invoice goes to the customer's Stripe balance (Stripe's default), used by the next invoice; verify in Stripe test mode before live.
      const created = z.object({ id: z.string().regex(/^(ii|cn)_[A-Za-z0-9]+$/) }).parse(invoice.status === "draft"
        ? await client("POST", "/invoiceitems", { customer: invoice.customer, invoice: invoice.id, amount: String(-row.priceMinor), currency: "eur", description: GUARANTEE_LINE, "metadata[guarantee_key]": key, ...(taxRate ? { "tax_rates[0]": taxRate } : {}) }, key)
        : await client("POST", "/credit_notes", { invoice: invoice.id, "lines[0][type]": "custom_line_item", "lines[0][description]": GUARANTEE_LINE, "lines[0][quantity]": "1", "lines[0][unit_amount]": String(row.priceMinor), "metadata[guarantee_key]": key, ...(taxRate ? { "lines[0][tax_rates][0]": taxRate } : {}) }, key));
      await tx.update(billingLocationPlans).set({ guaranteeCreditRef: created.id }).where(and(eq(billingLocationPlans.tenantId, row.tenantId), eq(billingLocationPlans.locationId, row.locationId)));
      console.log(`Start guarantee credited: tenant ${row.tenantId}, location ${row.locationId}, ${created.id.startsWith("cn_") ? "credit note" : "invoice line"}`);
      return 1;
    });
  }
  return credited;
}

/**
 * The worker's daily billing job: issues any start-guarantee credit still owed, and keeps one unit per location, so the Stripe
 * quantity follows the shop's location count from the next invoice on (no proration).
 */
export async function runBillingJob(env: Env = process.env) {
  if (!stripeEnabled(env)) return { quantities: 0, credited: 0 };
  const credited = await creditOwedGuarantees();
  let quantities = 0;
  const running = await db.select({ tenantId: subscriptions.tenantId, subscriptionId: subscriptions.providerSubscriptionId, locations: subscriptions.activeLocationCount })
    .from(subscriptions).where(and(eq(subscriptions.provider, "stripe"), eq(subscriptions.status, "active"), isNotNull(subscriptions.providerSubscriptionId)));
  for (const shop of running) {
    const item = stripeSubscription.parse(await client("GET", `/subscriptions/${shop.subscriptionId}`)).items.data[0];
    if (item.quantity === shop.locations) continue;
    await client("POST", `/subscription_items/${item.id}`, { quantity: String(shop.locations), proration_behavior: "none" });
    quantities += 1;
  }
  return { quantities, credited };
}
