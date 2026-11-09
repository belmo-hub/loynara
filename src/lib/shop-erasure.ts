import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { shopErasures } from "@/db/schema";
import { demoEnvironment } from "./demo-environment";
import { mailgunConfig } from "./email-configuration";
import { DomainError } from "./loyalty";
import { assertPlateOperator } from "./plates";
import { erasureDelayDays, EXPORT_DAYS_AFTER_END } from "./programme-end-date";
import { revokeCardWalletPasses } from "./wallet/enqueue";
import { overwriteGoogleClasses } from "./wallet/google-classes";
import { refreshWalletForMembership } from "./wallet/refresh";

type Env = Record<string, string | undefined>;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Executor = Pick<Transaction, "execute">;

/**
 * ENG-166 (DS-05, AVV § 8 (2); Legal's ruling of 1 Nov 2026): erases one ended shop's data, everything Loynara processed
 * for it, once the owner's export window is over, and at the latest by end date + 30 days + SHOP_ERASURE_DELAY_DAYS.
 * The tables come from the database itself (every table with a tenant_id, every table hanging off one, every *_tenant_id
 * column), so a table added later is erased without anyone listing it. Logins whose only role was in this shop go with it.
 * Physical plates are operator hardware: they are unlinked, not deleted. Loynara's own records survive (ERASURE_KEEP).
 * A login holds one role today (unique staff_roles_user_id_uq); the check for a role in another shop stays as a guard.
 */

/**
 * Loynara's own records (Legal: billing 8 years, the contract 6 years), never deleted by the erasure: the billing records
 * with their Stripe references, and the tenant row they hang off, reduced to its legal name and ids. No location row
 * survives (CTO: a sole trader's shop name and city can be personal data); the per-location plan facts are copied into the
 * erasure record first, and billing_location_plans goes with the locations.
 */
export const ERASURE_KEEP: readonly string[] = ["billing_invoices", "billing_handoffs", "billing_webhook_events", "subscriptions", "tenants"];
/** A kept row keeps only what the kept records need: its other fields are cleared. */
const ERASURE_REDUCE: Record<string, SQL> = {
  // ENG-164: the sender details name a person (the representative) and identify the business; an erased shop keeps none.
  tenants: sql`weekly_report_enabled = false, representative = NULL, legal_form = NULL, register_court = NULL, register_number = NULL, vat_id = NULL`,
};

const ident = (name: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new DomainError("ERASURE_SCHEMA", `Unexpected table or column name ${name}`);
  return sql.raw(`"${name}"`);
};
const jsonList = (values: string[]) => sql`(SELECT jsonb_array_elements_text(${JSON.stringify(values)}::jsonb))`;
const operatorIds = (env: Env) => (env.PLATE_OPERATOR_USER_IDS ?? "").split(",").map(id => id.trim()).filter(Boolean);

type Step = { label: string; count: SQL; erase: SQL };

/** The erasure, in an order the foreign keys allow: rows that reference a shop row go before it. */
async function erasureSteps(tx: Executor, tenantId: string, keep: readonly string[], env: Env): Promise<Step[]> {
  const columns = (await tx.execute(sql`SELECT table_name AS "table", column_name AS "column" FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name = 'tenant_id' OR column_name LIKE '%\\_tenant\\_id') AND table_name <> 'shop_erasures'`)).rows as Array<{ table: string; column: string }>;
  const fks = (await tx.execute(sql`SELECT c.relname AS child, p.relname AS parent,
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(f.conkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = f.conrelid AND a.attnum = k.num) AS "childColumns",
      (SELECT array_agg(a.attname::text ORDER BY k.ord) FROM unnest(f.confkey) WITH ORDINALITY k(num, ord) JOIN pg_attribute a ON a.attrelid = f.confrelid AND a.attnum = k.num) AS "parentColumns"
    FROM pg_constraint f JOIN pg_class c ON c.oid = f.conrelid JOIN pg_class p ON p.oid = f.confrelid
    WHERE f.contype = 'f' AND f.connamespace = 'public'::regnamespace`)).rows as Array<{ child: string; parent: string; childColumns: string[]; parentColumns: string[] }>;

  const owned = [...new Set(columns.filter(c => c.column === "tenant_id").map(c => c.table)), "tenants"];
  const where = (table: string) => table === "tenants" ? sql`id = ${tenantId}` : sql`tenant_id = ${tenantId}`;
  // A kept table keeps the rows it references; a parent that isn't kept would only fail at its delete.
  for (const table of keep) {
    const missing = fks.filter(f => f.child === table && owned.includes(f.parent) && !keep.includes(f.parent)).map(f => f.parent);
    if (missing.length) throw new DomainError("ERASURE_KEEP_INCOMPLETE", `${table} is kept, so ${[...new Set(missing)].join(", ")} must be kept too`);
  }
  const erased = owned.filter(table => !keep.includes(table));
  const steps: Step[] = [];

  // Rows without a tenant_id that hang off a shop row (email deliveries of its jobs, history of its own NFC tags).
  for (const f of fks) {
    if (owned.includes(f.child) || !erased.includes(f.parent) || keep.includes(f.child)) continue;
    const match = sql`(${sql.join(f.childColumns.map(ident), sql`, `)}) IN (SELECT ${sql.join(f.parentColumns.map(ident), sql`, `)} FROM ${ident(f.parent)} WHERE ${where(f.parent)}${f.parent === "secure_tags" ? sql` AND plate_label IS NULL` : sql``})`;
    steps.push({ label: `${f.child} (of ${f.parent})`, count: sql`SELECT count(*)::int AS n FROM ${ident(f.child)} WHERE ${match}`, erase: sql`DELETE FROM ${ident(f.child)} WHERE ${match}` });
  }
  // Rows that name the shop in another column, such as a plate's link history (old_tenant_id, new_tenant_id). A row that also
  // names another shop (a plate moved from this shop to that one) is that shop's history too: it stays, holding ids only.
  const named = new Map<string, string[]>();
  for (const c of columns) if (c.column !== "tenant_id" && !owned.includes(c.table) && !keep.includes(c.table)) named.set(c.table, [...(named.get(c.table) ?? []), c.column]);
  for (const [table, cols] of named) {
    const match = sql`(${sql.join(cols.map(col => sql`${ident(col)} = ${tenantId}`), sql` OR `)}) AND ${sql.join(cols.map(col => sql`(${ident(col)} IS NULL OR ${ident(col)} = ${tenantId})`), sql` AND `)}`;
    steps.push({ label: table, count: sql`SELECT count(*)::int AS n FROM ${ident(table)} WHERE ${match}`, erase: sql`DELETE FROM ${ident(table)} WHERE ${match}` });
  }
  // Plates go back to the operator's stock; a shop's own NFC tags (no plate label) are deleted with the shop.
  if (erased.includes("secure_tags")) steps.push({
    label: "secure_tags (plates unlinked)",
    count: sql`SELECT count(*)::int AS n FROM secure_tags WHERE tenant_id = ${tenantId} AND plate_label IS NOT NULL`,
    erase: sql`UPDATE secure_tags SET tenant_id = NULL, location_id = NULL, program_id = NULL, status = CASE WHEN status IN ('revoked', 'replaced') THEN 'revoked' ELSE 'unlinked' END WHERE tenant_id = ${tenantId} AND plate_label IS NOT NULL`,
  });
  // A card recovery request is keyed by email, not by shop: it goes when no other shop's card has that address.
  if (erased.includes("membership_contacts")) {
    const only = sql`lower(email) IN (SELECT lower(email) FROM membership_contacts WHERE tenant_id = ${tenantId})
      AND NOT EXISTS (SELECT 1 FROM membership_contacts m WHERE m.tenant_id <> ${tenantId} AND lower(m.email) = lower(card_recovery_challenges.email))`;
    steps.push({ label: "card_recovery_challenges (only this shop's addresses)", count: sql`SELECT count(*)::int AS n FROM card_recovery_challenges WHERE ${only}`, erase: sql`DELETE FROM card_recovery_challenges WHERE ${only}` });
  }

  // The shop's own tables, children before parents (Kahn's order over the foreign keys between them).
  const remaining = new Set(erased);
  const later: Step[] = [];
  while (remaining.size) {
    const ready = [...remaining].filter(table => !fks.some(f => f.parent === table && f.child !== table && remaining.has(f.child))).sort();
    if (!ready.length) throw new DomainError("ERASURE_SCHEMA", `Foreign keys form a cycle among ${[...remaining].join(", ")}`);
    for (const table of ready) {
      remaining.delete(table);
      const scope = table === "secure_tags" ? sql`${where(table)} AND plate_label IS NULL` : where(table);
      later.push({ label: table, count: sql`SELECT count(*)::int AS n FROM ${ident(table)} WHERE ${scope}`, erase: sql`DELETE FROM ${ident(table)} WHERE ${scope}` });
    }
  }
  // Read now, deleted once nothing references them: Apple devices only this shop used (push tokens), and the logins whose
  // role was here (owner, staff) with their sessions. A login holds one role today (staff_roles_user_id_uq); the check for
  // a role elsewhere keeps an account safe should that ever change.
  if (erased.includes("apple_registrations")) {
    const ids = ((await tx.execute(sql`SELECT DISTINCT device_library_identifier AS id FROM apple_registrations WHERE tenant_id = ${tenantId}`)).rows as Array<{ id: string }>).map(row => row.id);
    const orphaned = sql`device_library_identifier IN ${jsonList(ids)} AND NOT EXISTS (SELECT 1 FROM apple_registrations r WHERE r.device_library_identifier = apple_devices.device_library_identifier AND r.tenant_id <> ${tenantId})`;
    later.push({ label: "apple_devices (only this shop's)", count: sql`SELECT count(*)::int AS n FROM apple_devices WHERE ${orphaned}`, erase: sql`DELETE FROM apple_devices WHERE ${orphaned}` });
  }
  if (erased.includes("staff_roles")) {
    const ids = ((await tx.execute(sql`SELECT DISTINCT r.user_id AS id FROM staff_roles r WHERE r.tenant_id = ${tenantId}
      AND NOT EXISTS (SELECT 1 FROM staff_roles o WHERE o.user_id = r.user_id AND o.tenant_id <> ${tenantId})`)).rows as Array<{ id: string }>)
      .map(row => row.id).filter(id => !operatorIds(env).includes(id));
    const only = sql`id IN ${jsonList(ids)} AND NOT EXISTS (SELECT 1 FROM staff_roles o WHERE o.user_id = "user".id)`;
    later.push({ label: "user (logins only this shop had, with sessions)", count: sql`SELECT count(*)::int AS n FROM "user" WHERE id IN ${jsonList(ids)}`, erase: sql`DELETE FROM "user" WHERE ${only}` });
  }
  for (const table of keep) if (ERASURE_REDUCE[table]) later.push({ label: `${table} (kept, reduced)`, count: sql`SELECT count(*)::int AS n FROM ${ident(table)} WHERE ${where(table)}`, erase: sql`UPDATE ${ident(table)} SET ${ERASURE_REDUCE[table]} WHERE ${where(table)}` });
  return [...steps, ...later];
}

/** When the shop may be erased: after its export window, by its DS-05 deadline at the latest; and why not yet. */
async function shopState(tx: Executor, tenantId: string, now: Date, env: Env) {
  const delay = erasureDelayDays(env);
  if (delay === null) throw new DomainError("ERASURE_CONFIG", "SHOP_ERASURE_DELAY_DAYS must be a whole number from 7 to 3650");
  const { rows } = await tx.execute(sql`SELECT t.name,
      (SELECT count(*) FROM programs p WHERE p.tenant_id = t.id AND p.status = 'active')::int AS active,
      (SELECT max(p.cancellation_end_date) FROM programs p WHERE p.tenant_id = t.id AND p.status = 'ended')::text AS "endedOn",
      ((SELECT max(p.cancellation_end_date) FROM programs p WHERE p.tenant_id = t.id AND p.status = 'ended') + ${EXPORT_DAYS_AFTER_END}::int)::text AS "exportUntil",
      ((SELECT max(p.cancellation_end_date) FROM programs p WHERE p.tenant_id = t.id AND p.status = 'ended') + ${EXPORT_DAYS_AFTER_END + delay}::int)::text AS "deadline",
      ((${now.toISOString()}::timestamptz AT TIME ZONE 'Europe/Berlin')::date)::text AS today,
      (EXISTS (SELECT 1 FROM subscriptions s WHERE s.tenant_id = t.id AND s.provider_subscription_id IS NOT NULL AND s.status NOT IN ('cancelled', 'manual_pending'))
        OR EXISTS (SELECT 1 FROM billing_handoffs h WHERE h.tenant_id = t.id AND h.status = 'pending')) AS billing,
      EXISTS (SELECT 1 FROM shop_erasures e WHERE e.erased_tenant_id = t.id) AS erased
    FROM tenants t WHERE t.id = ${tenantId}`);
  const shop = rows[0] as { name: string; active: number; endedOn: string | null; exportUntil: string | null; deadline: string | null; today: string; billing: boolean; erased: boolean } | undefined;
  if (!shop || shop.erased) throw new DomainError("NOT_FOUND", "Dieses Geschäft haben wir nicht gefunden.");
  const reasons: string[] = [];
  if (shop.active > 0 || !shop.endedOn) reasons.push("PROGRAMME_RUNNING");
  else if (shop.today <= shop.exportUntil!) reasons.push("EXPORT_WINDOW_OPEN");
  // Allow-list: only a shop with no Stripe subscription, or one Stripe has ended, and no open checkout, may be erased; an
  // erased shop must never keep paying (ENG-125).
  if (shop.billing) reasons.push("STRIPE_SUBSCRIPTION_RUNNING");
  return { name: shop.name, endedOn: shop.endedOn, exportUntil: shop.exportUntil, deadline: shop.deadline, overdue: !!shop.deadline && shop.today > shop.deadline, reasons };
}

/** Legal: the contract facts (who ended it, when, which day) go into the erasure record before the shop's tables go. */
async function contractRecord(tx: Executor, tenantId: string, env: Env) {
  // Locations by id only: their names go with the shop's data.
  const events = (await tx.execute(sql`SELECT p.location_id AS location, e.action, e.created_at AS at, e.old_end_date::text AS "oldEndDate", e.new_end_date::text AS "newEndDate",
      (SELECT r.role FROM staff_roles r WHERE r.tenant_id = e.tenant_id AND r.user_id = e.actor_user_id ORDER BY r.created_at LIMIT 1) AS role, e.actor_user_id AS actor
    FROM programme_cancellation_events e JOIN programs p ON p.tenant_id = e.tenant_id AND p.id = e.program_id
    WHERE e.tenant_id = ${tenantId} ORDER BY e.created_at, e.id`)).rows as Array<{ location: string; action: string; at: Date; oldEndDate: string | null; newEndDate: string | null; role: string | null; actor: string }>;
  // The plan facts (CTO ruling on #210): the shop's plan and Stripe ids, and each location's plan, price, start and guarantee outcome.
  const [subscription] = (await tx.execute(sql`SELECT plan_code AS "planCode", price_minor AS "priceMinor", currency, status, provider,
      provider_customer_id AS "providerCustomerId", provider_subscription_id AS "providerSubscriptionId", active_location_count AS "locationCount",
      started_at AS "startedAt", free_until AS "freeUntil", current_period_end AS "currentPeriodEnd"
    FROM subscriptions WHERE tenant_id = ${tenantId}`)).rows;
  const locationPlans = (await tx.execute(sql`SELECT location_id AS location, plan_code AS "planCode", price_minor AS "priceMinor", currency, member_limit AS "memberLimit",
      created_at AS "createdAt", guarantee_decided_at AS "guaranteeDecidedAt", guarantee_customers AS "guaranteeCustomers", guarantee_outcome AS "guaranteeOutcome",
      guarantee_invoice_id AS "guaranteeInvoiceId", guarantee_credit_ref AS "guaranteeCreditRef"
    FROM billing_location_plans WHERE tenant_id = ${tenantId} ORDER BY created_at, location_id`)).rows;
  // Only the operator stays identifiable; the shop's owner or staff member is named by role, the end job as the system.
  const by = (role: string | null, actor: string) => role ?? (operatorIds(env).includes(actor) ? `operator ${actor}` : actor.startsWith("system:") ? "system" : "other");
  const [owner] = (await tx.execute(sql`SELECT u.name, u.email FROM staff_roles r JOIN "user" u ON u.id = r.user_id
    WHERE r.tenant_id = ${tenantId} AND r.role = 'owner' ORDER BY r.active DESC, r.created_at LIMIT 1`)).rows as Array<{ name: string; email: string }>;
  return {
    contract: {
      cancellation: events.map(event => ({ location: event.location, action: event.action, at: new Date(event.at).toISOString(), oldEndDate: event.oldEndDate, newEndDate: event.newEndDate, by: by(event.role, event.actor) })),
      plan: subscription ?? null, locationPlans,
    },
    owner: owner ?? null,
  };
}

export type ErasureProviders = {
  /** Deactivates the shop's Google Wallet objects; resolves with how many cards had one. */
  google?: (tenantId: string) => Promise<number>;
  /** Overwrites the shop's Google Wallet classes, which Google cannot delete; throws while one is not done. */
  googleClasses?: (tenantId: string) => Promise<number>;
  /** Removes one address from the operator's Mailgun suppression lists. */
  mailgun?: (address: string) => Promise<void>;
};
const withRetries = async <T>(work: () => Promise<T>, tries = 3): Promise<T> => {
  for (let attempt = 1; ; attempt++) {
    try { return await work(); } catch (error) { if (attempt >= tries) throw error; await new Promise(resolve => setTimeout(resolve, 250 * attempt)); }
  }
};
const unrevokedGoogle = async (executor: Executor, tenantId: string) =>
  ((await executor.execute(sql`SELECT count(*)::int AS n FROM wallet_passes WHERE tenant_id = ${tenantId} AND provider = 'google' AND status <> 'revoked'`)).rows[0] as { n: number }).n;

/** Google Wallet: every live object of the shop's cards is revoked through the normal pass lifecycle (deactivated at Google). */
async function revokeGoogleObjects(tenantId: string) {
  const cards = (await db.execute(sql`SELECT DISTINCT membership_id AS id FROM wallet_passes WHERE tenant_id = ${tenantId} AND provider = 'google' AND status <> 'revoked'`)).rows as Array<{ id: string }>;
  for (const { id } of cards) {
    await db.transaction(tx => revokeCardWalletPasses(tx, tenantId, id, "closed"));
    await refreshWalletForMembership(id, { expectedTenantId: tenantId });
  }
  return cards.length;
}

/** Mailgun (EU): bounces, unsubscribes and complaints are the copies Mailgun keeps of an address; a missing entry is fine. */
async function removeMailgunSuppressions(address: string) {
  const config = mailgunConfig(process.env);
  if (!config) return;
  for (const list of ["bounces", "unsubscribes", "complaints"]) {
    const response = await fetch(`https://api.eu.mailgun.net/v3/${config.domain}/${list}/${encodeURIComponent(address)}`, {
      method: "DELETE", signal: AbortSignal.timeout(10_000), headers: { Authorization: `Basic ${Buffer.from(`api:${config.apiKey}`).toString("base64")}` },
    });
    if (!response.ok && response.status !== 404) throw new DomainError("PROVIDER_ERROR", `Mailgun ${list} removal failed (${response.status})`);
  }
}

/**
 * Legal: the copies at providers the erasure can reach go first, with retries, outside the database transaction. Apple's
 * registrations and push tokens live in our database and go with it; logos are stored in the database too (no R2 object).
 */
async function providerCleanup(tenantId: string, providers: ErasureProviders) {
  const googleCards = await withRetries(() => (providers.google ?? revokeGoogleObjects)(tenantId));
  const left = await unrevokedGoogle(db, tenantId);
  if (left) throw new DomainError("EXTERNAL_PENDING", `${left} Google Wallet object(s) of the shop are not revoked yet; the erasure waits`);
  // After the objects, which still point at the class. Google may review the overwrite, so a rerun finishes it, not a retry here.
  const googleClasses = await (providers.googleClasses ?? overwriteGoogleClasses)(tenantId);
  const addresses = ((await db.execute(sql`SELECT DISTINCT lower(email) AS email FROM membership_contacts c WHERE c.tenant_id = ${tenantId} AND c.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM membership_contacts o WHERE o.tenant_id <> ${tenantId} AND lower(o.email) = lower(c.email))`)).rows as Array<{ email: string }>).map(row => row.email);
  const mailgun = providers.mailgun ?? (mailgunConfig(process.env) ? removeMailgunSuppressions : null);
  for (const address of mailgun ? addresses : []) await withRetries(() => mailgun!(address));
  return { googleCards, googleClasses, mailgunAddresses: mailgun ? addresses.length : "not configured" };
}

/** The database part: the shop's rows, under the exemption that names only this shop. `count` reads instead (dry run). */
async function eraseRows(tx: Transaction, tenantId: string, keep: readonly string[], env: Env, count = false) {
  const steps = await erasureSteps(tx, tenantId, keep, env);
  const rows: Record<string, number> = {};
  if (count) { for (const step of steps) { const n = ((await tx.execute(step.count)).rows[0] as { n: number }).n; if (n) rows[step.label] = n; } return rows; }
  await tx.execute(sql`SELECT set_config('loynara.erasure', ${tenantId}, true)`);
  for (const step of steps) { const n = (await tx.execute(step.erase)).rowCount ?? 0; if (n) rows[step.label] = n; }
  return rows;
}

/**
 * Operator: shows (dry run) or carries out the erasure of one shop. The provider copies go first; then one transaction
 * deletes the rows and writes the erasure record, whose confirmation is sendable only once both have succeeded. The
 * append-only history tables refuse every delete unless the transaction-local loynara.erasure names the row's shop.
 */
export async function shopErasure(input: { actorUserId: string; env: Env; tenantId: string; execute: boolean; now?: Date; keep?: readonly string[]; providers?: ErasureProviders }) {
  if (!/^[0-9a-f-]{36}$/i.test(input.tenantId)) throw new DomainError("NOT_FOUND", "Dieses Geschäft haben wir nicht gefunden.");
  const now = input.now ?? new Date();
  const keep = input.keep ?? ERASURE_KEEP;
  const check = await db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const state = await shopState(tx, input.tenantId, now, input.env);
    return { state, rows: !input.execute || state.reasons.length ? await eraseRows(tx, input.tenantId, keep, input.env, true) : {} };
  });
  if (!input.execute || check.state.reasons.length) return { result: check.state.reasons.length ? "blocked" as const : "would_erase" as const, tenantId: input.tenantId, ...check.state, rows: check.rows };
  const external = await providerCleanup(input.tenantId, input.providers ?? {});
  return db.transaction(async tx => {
    // Locks the shop: any insert that references it waits, so nothing new can appear between the deletes.
    await tx.execute(sql`SELECT id FROM tenants WHERE id = ${input.tenantId} FOR UPDATE`);
    const state = await shopState(tx, input.tenantId, now, input.env);
    if (state.reasons.length) return { result: "blocked" as const, tenantId: input.tenantId, ...state, rows: {} };
    if (await unrevokedGoogle(tx, input.tenantId)) throw new DomainError("EXTERNAL_PENDING", "A Google Wallet object was added after the provider clean-up; run the erasure again");
    const { contract, owner } = await contractRecord(tx, input.tenantId, input.env);
    const rows = await eraseRows(tx, input.tenantId, keep, input.env);
    await tx.insert(shopErasures).values({
      erasedTenantId: input.tenantId, legalName: state.name, endDate: state.endedOn!, exportUntil: state.exportUntil!, actorUserId: input.actorUserId,
      contract, rowCounts: rows, external, confirmationName: owner?.name ?? null, confirmationEmail: owner?.email ?? null, erasedAt: now, confirmationSendableAt: now,
    });
    return { result: "erased" as const, tenantId: input.tenantId, ...state, rows, external };
  });
}

/**
 * The demo environment's end of a demo (design v3): every row of the shop goes, nothing kept, no contract record, no
 * provider clean-up (that environment has no Mailgun or Google). Plates go back to stock, the operator's login stays.
 */
export async function eraseDemoShop(tenantId: string, env: Env = process.env) {
  if (!demoEnvironment(env)) throw new DomainError("FORBIDDEN", "Demo-Geschäfte werden nur in der Demo-Umgebung gelöscht.");
  return db.transaction(async tx => {
    const { rows } = await tx.execute(sql`SELECT id FROM tenants WHERE id = ${tenantId} FOR UPDATE`);
    return rows.length ? eraseRows(tx, tenantId, [], env) : {};
  });
}

/** Operator: the text-form confirmation went out (AVV § 8 (2)); stamped once on the erasure record. */
export async function recordErasureConfirmation(input: { actorUserId: string; env: Env; tenantId: string; now?: Date }) {
  const at = input.now ?? new Date();
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    const { rows } = await tx.execute(sql`UPDATE shop_erasures SET confirmation_sent_at = ${at.toISOString()}::timestamptz
      WHERE erased_tenant_id = ${input.tenantId} AND confirmation_sent_at IS NULL RETURNING erased_tenant_id`);
    if (!rows.length) throw new DomainError("NOT_FOUND", "Für dieses Geschäft steht keine Bestätigung aus.");
    return { tenantId: input.tenantId, confirmationSentAt: at.toISOString() };
  });
}

/** Shops whose export window is over (erasable, or blocked by a running subscription), with the DS-05 deadline; and erasures whose confirmation is due. */
export async function dueShopErasures(now = new Date(), env: Env = process.env) {
  const { rows } = await db.execute(sql`SELECT t.id FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM programs p WHERE p.tenant_id = t.id AND p.status = 'active')
    AND EXISTS (SELECT 1 FROM programs p WHERE p.tenant_id = t.id AND p.status = 'ended') AND NOT EXISTS (SELECT 1 FROM shop_erasures e WHERE e.erased_tenant_id = t.id) ORDER BY t.id`);
  const due: Array<{ tenantId: string; name: string; deadline: string | null; overdue: boolean; billing: boolean }> = [];
  for (const { id } of rows as Array<{ id: string }>) {
    const state = await shopState(db, id, now, env);
    if (!state.reasons.includes("PROGRAMME_RUNNING") && !state.reasons.includes("EXPORT_WINDOW_OPEN")) due.push({ tenantId: id, name: state.name, deadline: state.deadline, overdue: state.overdue, billing: state.reasons.includes("STRIPE_SUBSCRIPTION_RUNNING") });
  }
  const confirmations = (await db.execute(sql`SELECT erased_tenant_id AS "tenantId", legal_name AS name FROM shop_erasures WHERE confirmation_sent_at IS NULL ORDER BY erased_at`)).rows as Array<{ tenantId: string; name: string }>;
  return { due, confirmations };
}

export type ErasureRecord = typeof shopErasures.$inferSelect;

/**
 * After a restore (Legal: before the service is released), re-applies every erasure: a backup taken before an erasure
 * brings the shop's rows back. The records come from the restored database plus a list exported from the live one before
 * the restore, since a backup older than an erasure holds no record of it; a missing record is written back.
 */
export async function reapplyErasures(exported: ErasureRecord[], env: Env = process.env) {
  const restored = await db.select().from(shopErasures);
  const records = [...restored, ...exported.filter(record => !restored.some(row => row.erasedTenantId === record.erasedTenantId))];
  const applied: Array<{ tenantId: string; rows: Record<string, number> }> = [];
  for (const record of records) {
    const rows = await db.transaction(async tx => {
      const { rows: found } = await tx.execute(sql`SELECT id FROM tenants WHERE id = ${record.erasedTenantId} FOR UPDATE`);
      const erased = found.length ? await eraseRows(tx, record.erasedTenantId, ERASURE_KEEP, env) : {};
      await tx.insert(shopErasures).values({ ...record, erasedAt: new Date(record.erasedAt), confirmationSendableAt: new Date(record.confirmationSendableAt),
        confirmationSentAt: record.confirmationSentAt ? new Date(record.confirmationSentAt) : null }).onConflictDoNothing();
      return erased;
    });
    const changed = Object.entries(rows).filter(([label]) => !label.endsWith("(kept, reduced)"));
    if (changed.length) applied.push({ tenantId: record.erasedTenantId, rows: Object.fromEntries(changed) });
  }
  return applied;
}
