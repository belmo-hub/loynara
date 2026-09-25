import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { billingHandoffs, billingInvoices, billingLocationPlans, billingWebhookEvents, locations, memberships, programs, staffRoles, subscriptions } from "@/db/schema";
import { DomainError } from "./loyalty";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const GRACE_MS = 7 * 86_400_000;
const SIGNATURE_WINDOW_MS = 5 * 60_000;

type BillingProvider = {
  name: "local_fixture";
  checkoutUrl(handoffId: string): string;
  sign(raw: string, at: Date): string;
  verify(raw: string, signature: string, at: Date): void;
};

function fixtureOrigin() {
  // Exact URLs reject pg query-string host/user overrides, including ones
  // that would redirect a seemingly local connection to another database.
  const testDatabase = process.env.NODE_ENV === "test" && process.env.DATABASE_URL === "postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal_test";
  const localDatabase = process.env.DATABASE_URL === "postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal";
  if (process.env.BILLING_FIXTURE_MODE !== "true" || process.env.NODE_ENV === "production" ||
      !(testDatabase || localDatabase) ||
      process.env.LIVE_BILLING_ENABLED === "true" ||
      (!testDatabase && (process.env.PUBLIC_BASE_URL !== "http://localhost:3000" || process.env.BETTER_AUTH_URL !== "http://localhost:3000")) ||
      (process.env.BILLING_FIXTURE_SECRET?.length ?? 0) < 32) {
    throw new DomainError("BILLING_DISABLED", "Local billing fixture is unavailable");
  }
  return "http://localhost:3000";
}

const fixtureProvider: BillingProvider = {
  name: "local_fixture",
  checkoutUrl(handoffId) { return `${fixtureOrigin()}/merchant/billing/fixture/${handoffId}`; },
  sign(raw, at) {
    fixtureOrigin();
    const time = Math.floor(at.getTime() / 1000);
    const value = createHmac("sha256", process.env.BILLING_FIXTURE_SECRET!).update(`${time}.${raw}`).digest("hex");
    return `t=${time},v1=${value}`;
  },
  verify(raw, signature, at) {
    fixtureOrigin();
    const match = /^t=(\d{10,11}),v1=([a-f0-9]{64})$/.exec(signature);
    if (!match) throw new DomainError("INVALID_SIGNATURE", "Invalid fixture webhook signature");
    const signedAt = Number(match[1]) * 1000;
    if (!Number.isSafeInteger(signedAt) || Math.abs(at.getTime() - signedAt) > SIGNATURE_WINDOW_MS) throw new DomainError("INVALID_SIGNATURE", "Expired fixture webhook signature");
    const expected = createHmac("sha256", process.env.BILLING_FIXTURE_SECRET!).update(`${match[1]}.${raw}`).digest();
    const received = Buffer.from(match[2], "hex");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new DomainError("INVALID_SIGNATURE", "Invalid fixture webhook signature");
  },
};

export function signFixtureWebhook(raw: string, at = new Date()) { return fixtureProvider.sign(raw, at); }
export function billingFixtureAvailable() { try { fixtureOrigin(); return true; } catch { return false; } }

async function ownerTenant(actorUserId: string, tx: Transaction | typeof db = db) {
  const [role] = await tx.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Active owner access required");
  return role.tenantId;
}

async function reconcileSubscription(tx: Transaction, tenantId: string, at: Date) {
  const [current] = await tx.select().from(subscriptions).where(eq(subscriptions.tenantId, tenantId)).for("update");
  if (!current) throw new DomainError("NOT_FOUND", "Subscription not found");
  let status = current.status;
  if (current.cancelAtPeriodEnd && current.currentPeriodEnd && at >= current.currentPeriodEnd && ["active_fixture", "grace_fixture"].includes(status)) status = "cancelled";
  else if (status === "grace_fixture" && current.graceUntil && at >= current.graceUntil) status = "suspended_fixture";
  if (status === current.status) return current;
  const [updated] = await tx.update(subscriptions).set({ status, updatedAt: at }).where(eq(subscriptions.tenantId, tenantId)).returning();
  return updated;
}

export async function getBillingOverview(actorUserId: string, at = new Date()) {
  return db.transaction(async tx => {
    const tenantId = await ownerTenant(actorUserId, tx);
    const subscription = await reconcileSubscription(tx, tenantId, at);
    const plans = await tx.select({ locationId: billingLocationPlans.locationId, locationName: locations.name, planCode: billingLocationPlans.planCode, priceMinor: billingLocationPlans.priceMinor, currency: billingLocationPlans.currency, memberLimit: billingLocationPlans.memberLimit })
      .from(billingLocationPlans).innerJoin(locations, and(eq(locations.id, billingLocationPlans.locationId), eq(locations.tenantId, billingLocationPlans.tenantId)))
      .where(eq(billingLocationPlans.tenantId, tenantId)).orderBy(locations.createdAt, locations.id);
    const locationUsage = await Promise.all(plans.map(async plan => {
      const [usage] = await tx.select({ activeMembers: sql<number>`count(*)::int` }).from(memberships)
        .innerJoin(programs, and(eq(programs.id, memberships.programId), eq(programs.tenantId, memberships.tenantId)))
        .where(and(eq(memberships.tenantId, tenantId), eq(programs.locationId, plan.locationId), sql`${memberships.closedAt} is null`));
      return { ...plan, activeMembers: usage.activeMembers };
    }));
    const invoices = await tx.select({ id: billingInvoices.id, providerInvoiceId: billingInvoices.providerInvoiceId, status: billingInvoices.status, amountMinor: billingInvoices.amountMinor, currency: billingInvoices.currency, taxMinor: billingInvoices.taxMinor, periodEnd: billingInvoices.periodEnd, createdAt: billingInvoices.createdAt })
      .from(billingInvoices).where(eq(billingInvoices.tenantId, tenantId)).orderBy(desc(billingInvoices.createdAt)).limit(20);
    return {
      status: subscription.status, currency: subscription.currency, priceMinor: subscription.priceMinor,
      locationCount: locationUsage.length, monthlySubtotalMinor: locationUsage.reduce((sum, plan) => sum + plan.priceMinor, 0),
      locations: locationUsage, invoices, provider: subscription.provider, currentPeriodEnd: subscription.currentPeriodEnd,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, graceUntil: subscription.graceUntil,
      liveBilling: false as const, fixtureAvailable: billingFixtureAvailable(),
      countingRule: "Aktive Karten sind nicht geschlossene Mitgliedschaften je Standort. Der Monatsbetrag ist die Summe der gespeicherten Standortpreise; Steuer ist nicht berechnet und es wird nichts abgebucht. Fixture-Belege sind keine Steuerrechnungen.",
    };
  });
}

export async function createFixtureHandoff(actorUserId: string, at = new Date()) {
  const tenantId = await ownerTenant(actorUserId);
  fixtureOrigin();
  return db.transaction(async tx => {
    const subscription = await reconcileSubscription(tx, tenantId, at);
    if (!["manual_pending", "pending_checkout", "cancelled", "suspended_fixture"].includes(subscription.status)) throw new DomainError("BILLING_STATE", "A fixture checkout is unavailable in this state");
    const plans = await tx.select({ priceMinor: billingLocationPlans.priceMinor }).from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, tenantId));
    const amountMinor = plans.reduce((sum, plan) => sum + plan.priceMinor, 0);
    if (!plans.length || amountMinor <= 0) throw new DomainError("PLAN_UNAVAILABLE", "No location plan available");
    const [pending] = await tx.select().from(billingHandoffs).where(and(eq(billingHandoffs.tenantId, tenantId), eq(billingHandoffs.status, "pending"))).orderBy(desc(billingHandoffs.createdAt)).limit(1);
    if (pending) {
      if (pending.currency !== subscription.currency || pending.amountMinor !== amountMinor) throw new DomainError("BILLING_STATE", "A prior fixture checkout needs review after the location total changed");
      return { id: pending.id, provider: fixtureProvider.name, status: pending.status, amountMinor, currency: pending.currency, url: fixtureProvider.checkoutUrl(pending.id) };
    }
    const [handoff] = await tx.insert(billingHandoffs).values({ tenantId, provider: fixtureProvider.name, currency: subscription.currency, amountMinor, createdAt: at }).returning();
    await tx.update(subscriptions).set({ status: "pending_checkout", updatedAt: at }).where(eq(subscriptions.tenantId, tenantId));
    return { id: handoff.id, provider: fixtureProvider.name, status: handoff.status, amountMinor, currency: handoff.currency, url: fixtureProvider.checkoutUrl(handoff.id) };
  });
}

export async function getFixtureHandoff(actorUserId: string, handoffId: string) {
  const tenantId = await ownerTenant(actorUserId);
  fixtureOrigin();
  if (!z.uuid().safeParse(handoffId).success) throw new DomainError("NOT_FOUND", "Fixture handoff not found");
  const [handoff] = await db.select().from(billingHandoffs).where(and(eq(billingHandoffs.id, handoffId), eq(billingHandoffs.tenantId, tenantId))).limit(1);
  if (!handoff) throw new DomainError("NOT_FOUND", "Fixture handoff not found");
  return handoff;
}

export async function cancelSubscriptionAtPeriodEnd(actorUserId: string, at = new Date()) {
  return db.transaction(async tx => {
    const tenantId = await ownerTenant(actorUserId, tx);
    const current = await reconcileSubscription(tx, tenantId, at);
    if (!["active_fixture", "grace_fixture"].includes(current.status) || !current.currentPeriodEnd) throw new DomainError("BILLING_STATE", "No active fixture period to cancel");
    const [updated] = await tx.update(subscriptions).set({ cancelAtPeriodEnd: true, updatedAt: at }).where(eq(subscriptions.tenantId, tenantId)).returning();
    return { status: updated.status, cancelAtPeriodEnd: updated.cancelAtPeriodEnd, currentPeriodEnd: updated.currentPeriodEnd };
  });
}

const baseEvent = z.object({ id: z.string().regex(/^evt_[A-Za-z0-9-]{8,116}$/), tenantId: z.uuid(), handoffId: z.uuid(), occurredAt: z.iso.datetime() });
const webhookEvent = z.discriminatedUnion("type", [
  baseEvent.extend({ type: z.literal("checkout.completed"), invoiceId: z.string().regex(/^inv_[A-Za-z0-9-]{8,116}$/), amountMinor: z.number().int().positive(), currency: z.enum(["EUR", "MAD"]), periodEnd: z.iso.datetime() }).strict(),
  baseEvent.extend({ type: z.literal("payment.failed") }).strict(),
]);

export async function applyFixtureWebhook(raw: string, signature: string, at = new Date()) {
  if (Buffer.byteLength(raw) > 2048) throw new DomainError("TOO_LARGE", "Fixture event is too large");
  fixtureProvider.verify(raw, signature, at);
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new DomainError("INVALID_JSON", "Invalid fixture event"); }
  const event = webhookEvent.parse(parsed);
  const occurredAt = new Date(event.occurredAt);
  if (Math.abs(occurredAt.getTime() - at.getTime()) > SIGNATURE_WINDOW_MS) throw new DomainError("INVALID_EVENT_TIME", "Fixture event is outside the signed time window");
  const payloadHash = createHash("sha256").update(raw).digest("hex");
  return db.transaction(async tx => {
    // Provider event IDs are global. Serialize simultaneous reuse before
    // either merchant can write a fixture invoice or an outcome row.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${event.id}::text, 13))`);
    const [handoff] = await tx.select().from(billingHandoffs).where(eq(billingHandoffs.id, event.handoffId)).for("update");
    if (!handoff || handoff.tenantId !== event.tenantId || handoff.provider !== fixtureProvider.name) throw new DomainError("NOT_FOUND", "Fixture handoff not found");
    const [prior] = await tx.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.eventId, event.id));
    if (prior) {
      if (prior.payloadHash !== payloadHash || prior.tenantId !== event.tenantId) throw new DomainError("KEY_REUSED", "Fixture event ID reused with different content");
      return { status: "duplicate" as const };
    }
    const subscription = await reconcileSubscription(tx, event.tenantId, at);
    if (event.type === "checkout.completed") {
      if (event.currency !== handoff.currency || event.amountMinor !== handoff.amountMinor) throw new DomainError("AMOUNT_MISMATCH", "Fixture amount or currency differs from handoff");
      if (handoff.status !== "pending") throw new DomainError("BILLING_STATE", "Fixture handoff already completed");
      const periodEnd = new Date(event.periodEnd);
      if (periodEnd <= occurredAt) throw new DomainError("INVALID_PERIOD", "Fixture period must end after checkout");
      await tx.insert(billingInvoices).values({ tenantId: event.tenantId, handoffId: handoff.id, providerInvoiceId: event.invoiceId, status: "fixture_paid", currency: event.currency, amountMinor: event.amountMinor, taxMinor: null, periodEnd, createdAt: at });
      await tx.update(billingHandoffs).set({ status: "complete", completedAt: at }).where(eq(billingHandoffs.id, handoff.id));
      await tx.update(subscriptions).set({ status: "active_fixture", provider: fixtureProvider.name, currentPeriodEnd: periodEnd, cancelAtPeriodEnd: false, graceUntil: null, updatedAt: at }).where(eq(subscriptions.tenantId, event.tenantId));
    } else {
      if (handoff.status !== "complete" || !["active_fixture", "grace_fixture"].includes(subscription.status)) throw new DomainError("BILLING_STATE", "No active fixture period for failure");
      const proposedGraceUntil = new Date(occurredAt.getTime() + GRACE_MS);
      const graceUntil = subscription.graceUntil && subscription.graceUntil < proposedGraceUntil ? subscription.graceUntil : proposedGraceUntil;
      await tx.update(subscriptions).set({ status: "grace_fixture", graceUntil, updatedAt: at }).where(eq(subscriptions.tenantId, event.tenantId));
    }
    await tx.insert(billingWebhookEvents).values({ eventId: event.id, tenantId: event.tenantId, eventType: event.type, payloadHash });
    return { status: "applied" as const };
  });
}

export async function completeFixtureHandoff(actorUserId: string, handoffId: string, at = new Date()) {
  const handoff = await getFixtureHandoff(actorUserId, handoffId);
  if (handoff.status !== "pending") throw new DomainError("BILLING_STATE", "Fixture handoff already completed");
  const event = { id: `evt_${randomUUID()}`, type: "checkout.completed", tenantId: handoff.tenantId, handoffId: handoff.id,
    invoiceId: `inv_${randomUUID()}`, amountMinor: handoff.amountMinor, currency: handoff.currency,
    periodEnd: new Date(at.getTime() + 30 * 86_400_000).toISOString(), occurredAt: at.toISOString() };
  const raw = JSON.stringify(event);
  return applyFixtureWebhook(raw, signFixtureWebhook(raw, at), at);
}
