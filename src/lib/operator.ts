import { and, asc, desc, eq, isNotNull, max, sql } from "drizzle-orm";
import { db } from "@/db";
import { billingLocationPlans, ledgerEntries, locations, memberships, plateActivationCodes, plateActivationFailures, programmeCancellationEvents, programs, secureTags, subscriptions, tenants } from "@/db/schema";
import { freeMonthsEndingSoon } from "./free-month-reminder";
import { DomainError } from "./loyalty";
import { shopsAwaitingOwner } from "./owner-invites";
import { assertPlateOperator } from "./plates";
import { PROGRAMME_END_ACTOR } from "./programme-end";
import { walletMessageStats } from "./wallet-messages";
import { enqueueWalletProgramRefresh } from "./wallet/enqueue";
import { googleClassOverview } from "./wallet/google-classes";
import { walletTemplateOverview } from "./wallet/template-bindings";

/**
 * The operator's read model: shops and plates, counts and dates only. No customer, card or contact data is selected,
 * so none can reach the page. Every read runs the same operator check as the plate writes.
 */
export async function operatorOverview(actorUserId: string, env: Record<string, string | undefined> = process.env) {
  return db.transaction(async tx => {
    await assertPlateOperator(tx, actorUserId, env);
    const cards = tx.select({ programId: memberships.programId, cards: sql<number>`count(*)::int`.as("cards") }).from(memberships).groupBy(memberships.programId).as("c");
    // shortcut: aggregates the whole ledger per programme on every page load, fine at pilot size; add a cached or indexed last-award column when shops exceed a few hundred.
    const awards = tx.select({ programId: memberships.programId, last: max(ledgerEntries.createdAt).as("last") }).from(ledgerEntries)
      .innerJoin(memberships, and(eq(memberships.id, ledgerEntries.membershipId), eq(memberships.tenantId, ledgerEntries.tenantId)))
      .where(and(eq(ledgerEntries.kind, "award"), sql`${ledgerEntries.source} in ('staff_online','staff_offline','nfc_tap')`))
      .groupBy(memberships.programId).as("a");
    const rows = await tx.select({
      tenantId: tenants.id, tenant: tenants.name, weeklyReport: tenants.weeklyReportEnabled,
      locationId: locations.id, location: locations.name, city: locations.city, latitude: locations.latitude, longitude: locations.longitude,
      programId: programs.id, programme: programs.name, status: programs.status, tapMode: programs.tapMode,
      endDate: programs.cancellationEndDate, requestedAt: programs.cancellationRequestedAt, confirmedAt: programs.cancellationConfirmedAt,
      cards: sql<number>`coalesce(${cards.cards}, 0)`, lastAward: awards.last,
    }).from(programs)
      .innerJoin(tenants, eq(tenants.id, programs.tenantId))
      .innerJoin(locations, and(eq(locations.id, programs.locationId), eq(locations.tenantId, programs.tenantId)))
      .leftJoin(cards, eq(cards.programId, programs.id)).leftJoin(awards, eq(awards.programId, programs.id))
      .orderBy(asc(tenants.name), asc(locations.name), asc(programs.name));
    const plates = await tx.select({
      plateLabel: secureTags.plateLabel, status: secureTags.status, everTapped: sql<boolean>`${secureTags.lastCounter} > 0`, alertedAt: plateActivationCodes.alertedAt,
      code: sql<"none" | "open" | "locked" | "used">`case when ${plateActivationCodes.tagId} is null then 'none' when ${plateActivationCodes.usedAt} is not null then 'used' when exists (select 1 from ${plateActivationFailures} where ${plateActivationFailures.tagId} = ${secureTags.id} and ${plateActivationFailures.lockedAt} is not null) then 'locked' else 'open' end`,
      programId: secureTags.programId, merchant: tenants.name, location: locations.name, programme: programs.name,
    }).from(secureTags)
      .leftJoin(programs, eq(programs.id, secureTags.programId)).leftJoin(tenants, eq(tenants.id, secureTags.tenantId))
      .leftJoin(locations, eq(locations.id, secureTags.locationId)).leftJoin(plateActivationCodes, eq(plateActivationCodes.tagId, secureTags.id))
      .where(isNotNull(secureTags.plateLabel)).orderBy(asc(secureTags.plateLabel));
    // Age is computed here so the page renders the same on server and client.
    const now = Date.now();
    const messages = await walletMessageStats(tx);
    // Who acted, not which account: requests and withdrawals come only from the owner route, the end job is the system actor.
    const events = await tx.select({ programId: programmeCancellationEvents.programId, action: programmeCancellationEvents.action, actorUserId: programmeCancellationEvents.actorUserId, oldEndDate: programmeCancellationEvents.oldEndDate, newEndDate: programmeCancellationEvents.newEndDate, at: programmeCancellationEvents.createdAt })
      .from(programmeCancellationEvents).orderBy(asc(programmeCancellationEvents.createdAt));
    const history = Map.groupBy(events.map(({ actorUserId, ...event }) => ({ ...event, by: actorUserId === PROGRAMME_END_ACTOR ? "System" : event.action === "request" || event.action === "withdraw" ? "Inhaber" : "Operator" })), event => event.programId);
    const templates = await walletTemplateOverview(tx, env);
    const googleClasses = await googleClassOverview(tx);
    const awaiting = await shopsAwaitingOwner(tx);
    // Billing per shop (the plan the operator chose, the Stripe state) and every start-guarantee decision per location (the operator's notice).
    const billing = await tx.select({ tenantId: tenants.id, tenant: tenants.name, status: subscriptions.status, planCode: subscriptions.planCode, currency: subscriptions.currency,
      started: sql<boolean>`${subscriptions.providerSubscriptionId} is not null or ${subscriptions.freeUntil} is not null`,
      cancelling: subscriptions.cancelAtPeriodEnd,
      // Prefill for the go-live form (the operator completes street and postcode): the active owner's name and login email, and the shop's first location's city.
      ownerName: sql<string | null>`(SELECT u.name FROM staff_roles o JOIN "user" u ON u.id = o.user_id WHERE o.tenant_id = ${subscriptions.tenantId} AND o.role = 'owner' AND o.active LIMIT 1)`,
      ownerEmail: sql<string | null>`(SELECT u.email FROM staff_roles o JOIN "user" u ON u.id = o.user_id WHERE o.tenant_id = ${subscriptions.tenantId} AND o.role = 'owner' AND o.active LIMIT 1)`,
      city: sql<string | null>`(SELECT l.city FROM locations l WHERE l.tenant_id = ${subscriptions.tenantId} ORDER BY l.created_at, l.id LIMIT 1)`,
      // The owner-facing date is the last free day, the day before the first billing date (Legal).
      lastFreeDay: sql<string | null>`to_char((${subscriptions.freeUntil} - interval '1 day') AT TIME ZONE 'Europe/Berlin', 'DD.MM.YYYY')` })
      .from(subscriptions).innerJoin(tenants, eq(tenants.id, subscriptions.tenantId)).orderBy(asc(tenants.name));
    const guarantees = await tx.select({ locationId: billingLocationPlans.locationId, tenant: tenants.name, location: locations.name, customers: billingLocationPlans.guaranteeCustomers,
      outcome: billingLocationPlans.guaranteeOutcome, credited: sql<boolean>`${billingLocationPlans.guaranteeCreditRef} is not null`, decidedAt: billingLocationPlans.guaranteeDecidedAt })
      .from(billingLocationPlans).innerJoin(tenants, eq(tenants.id, billingLocationPlans.tenantId))
      .innerJoin(locations, and(eq(locations.id, billingLocationPlans.locationId), eq(locations.tenantId, billingLocationPlans.tenantId)))
      .where(isNotNull(billingLocationPlans.guaranteeOutcome)).orderBy(desc(billingLocationPlans.guaranteeDecidedAt));
    // ENG-310 (Art. 30 (2) record): every shop whose owner accepted the online contract. Start = the first acceptance; end =
    // the confirmed cancellation's last day, once no active programme runs without one (a cancellation covers the whole shop).
    const { rows: contracts } = await tx.execute<{ tenantId: string; tenant: string; ownerEmail: string | null; acceptedAt: string; endDate: string | null; addresses: string[] }>(sql`
      SELECT t.id AS "tenantId", t.name AS tenant, u.email AS "ownerEmail", to_json(a.accepted_at) #>> '{}' AS "acceptedAt",
        CASE WHEN NOT EXISTS (SELECT 1 FROM programs p WHERE p.tenant_id = t.id AND p.status = 'active' AND p.cancellation_confirmed_at IS NULL)
          THEN (SELECT max(p.cancellation_end_date) FROM programs p WHERE p.tenant_id = t.id AND p.cancellation_confirmed_at IS NOT NULL)::text END AS "endDate",
        coalesce((SELECT array_agg(concat_ws(', ', l.name, nullif(l.street, ''), concat_ws(' ', l.postal_code, l.city)) ORDER BY l.created_at, l.id)
          FROM locations l WHERE l.tenant_id = t.id), '{}') AS addresses
      FROM (SELECT DISTINCT ON (tenant_id) tenant_id, user_id, accepted_at FROM owner_acceptances WHERE tenant_id IS NOT NULL ORDER BY tenant_id, accepted_at) a
      JOIN tenants t ON t.id = a.tenant_id LEFT JOIN "user" u ON u.id = a.user_id
      -- An erased shop keeps its tenant row and acceptance (ERASURE_KEEP) but is no live contract.
      WHERE NOT EXISTS (SELECT 1 FROM shop_erasures e WHERE e.erased_tenant_id = t.id)
      ORDER BY t.name, t.id`);
    // ENG-123: free months ending within 7 days, and whether the reminder went out (the fallback while the email lane is off).
    const freeMonths = await freeMonthsEndingSoon();
    return { awaiting, billing, guarantees, freeMonths, contracts, rows: rows.map(({ requestedAt, confirmedAt, ...row }) => ({ ...row, walletMessages: messages.get(row.programId) ?? null, walletTemplate: templates.get(`${row.tenantId}/${row.locationId}`) ?? null, googleClass: googleClasses.get(row.programId) ?? null, cancellationHistory: history.get(row.programId) ?? [], confirmed: confirmedAt !== null, requestedDays: requestedAt ? Math.floor((now - requestedAt.getTime()) / 86_400_000) : null })), plates };
  });
}

/**
 * „51.31270, 9.47970“ as Google Maps copies it from a right-click, or a full Maps link holding the pin (!3d…!4d…). A link's
 * @… is where the map was centred, not the shop, so it does not count; a short link would need fetching, so neither does that.
 */
export function parseCoordinates(text: string) {
  const [, lat, lng] = text.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/) ?? text.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/) ?? [];
  const latitude = Number(lat), longitude = Number(lng);
  if (!lat || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new DomainError("INVALID_POINT", "Bitte füge die Koordinaten aus Google Maps ein, zum Beispiel 51.31270, 9.47970.");
  return { latitude, longitude };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Sets one location's point for the Wallet near-shop suggestion. Dry run unless `execute`; a change reaches every pass of the location. */
export async function setLocationCoordinates(input: { actorUserId: string; env: Record<string, string | undefined>; tenantId: string; locationId: string; coordinates: string; execute: boolean }) {
  if (!UUID.test(input.tenantId) || !UUID.test(input.locationId)) throw new DomainError("NOT_FOUND", "Diesen Standort haben wir nicht gefunden.");
  const point = parseCoordinates(input.coordinates);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const where = and(eq(locations.id, input.locationId), eq(locations.tenantId, input.tenantId));
    const [location] = await tx.select({ latitude: locations.latitude, longitude: locations.longitude }).from(locations).where(where).for("update");
    if (!location) throw new DomainError("NOT_FOUND", "Diesen Standort haben wir nicht gefunden.");
    const changed = location.latitude !== point.latitude || location.longitude !== point.longitude;
    if (changed && input.execute) {
      await tx.update(locations).set({ ...point, placeLocationFetchedAt: null }).where(where); // the operator's own point: no 30-day limit
      const held = await tx.select({ id: programs.id }).from(programs).where(and(eq(programs.tenantId, input.tenantId), eq(programs.locationId, input.locationId)));
      for (const program of held) await enqueueWalletProgramRefresh(tx, input.tenantId, program.id);
    }
    return { ...point, changed };
  });
}
