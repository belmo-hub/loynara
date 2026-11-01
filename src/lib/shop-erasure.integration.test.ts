import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { locations, secureTags, shopErasures, subscriptions } from "@/db/schema";
import { requestCardRecovery } from "./card-recovery";
import { createDraftCampaign } from "./campaigns";
import { consumeContactVerification, requestContactVerification } from "./contact-verification";
import { verificationTokenForChallenge } from "./contact-token";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";
import { createAdditionalLocation } from "./locations";
import { award, redeem } from "./loyalty";
import { registerUnlinkedPlate, setPlateLink } from "./plates";
import { createMerchant, enroll, getMerchantRewards } from "./product";
import { operatorProgramme } from "./programme-end";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { erasureDelayDays } from "./programme-end-date";
import { dueShopErasures, ERASURE_KEEP, reapplyErasures, recordErasureConfirmation, shopErasure, type ErasureProviders } from "./shop-erasure";
import { acceptStaffInvite, createStaffInvite } from "./staff";

assertLocalTestDatabaseUrl();
const envKeys = ["PLATE_OPERATOR_USER_IDS", "SMTP_HOST", "EXTERNAL_EMAIL_ENABLED", "SHOP_ERASURE_DELAY_DAYS"];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
let operatorId = "";
beforeEach(async () => {
  await assertDisposableDatabase(pool);
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices, card_recovery_challenges, secure_tags, plate_link_events, shop_erasures CASCADE');
  Object.assign(process.env, { SMTP_HOST: "localhost", EXTERNAL_EMAIL_ENABLED: "false" });
  delete process.env.SHOP_ERASURE_DELAY_DAYS;
  operatorId = await user("Synthetic operator");
  process.env.PLATE_OPERATOR_USER_IDS = operatorId;
});
afterEach(() => { for (const key of envKeys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
afterAll(async () => { await pool.end(); });

async function user(name: string) {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, name, `${id}@example.test`]);
  return id;
}
const key = () => randomUUID();
const location = (name: string) => ({ name, city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", programName: `Karte ${name}`, programType: "stamp" as const, rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 2 });

/** A shop with as much history as the product writes: two locations, staff, cards, stamps, a reward, referrals, contacts, consent, a campaign, a plate and a Wallet device. */
async function busyShop(label: string, plate: string) {
  const ownerId = await user(`Synthetic owner ${label}`);
  const shop = await createMerchant({ userId: ownerId, businessName: `Synthetic ${label}`, locationName: "Am Markt", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Kaffee", rewardCost: 2 });
  const second = await createAdditionalLocation(ownerId, location(`Bahnhof ${label}`));
  const cashierId = await user(`Synthetic cashier ${label}`);
  const cashierEmail = (await pool.query("SELECT email FROM \"user\" WHERE id = $1", [cashierId])).rows[0].email as string;
  const invite = await createStaffInvite({ actorUserId: ownerId, locationId: shop.locationId, email: cashierEmail, role: "cashier" });
  await acceptStaffInvite({ userId: cashierId, token: invite.token });
  await createStaffInvite({ actorUserId: ownerId, locationId: second.locationId, email: `${randomUUID()}@example.test`, role: "cashier" });
  const card = await enroll({ slug: shop.programSlug, acceptedTerms: true });
  await award({ userId: cashierId, locationId: shop.locationId, membershipId: card.id, quantity: 3, idempotencyKey: key(), requestId: key() });
  const [reward] = await getMerchantRewards({ actorUserId: ownerId, programSlug: shop.programSlug });
  await redeem({ userId: cashierId, locationId: shop.locationId, membershipId: card.id, rewardVersionId: reward.versionId, idempotencyKey: key(), requestId: key() });
  await configureReferrals({ actorUserId: ownerId, programSlug: shop.programSlug, enabled: true, referrerBonus: 1, referredBonus: 1 });
  const share = await getCardReferralShare(card.cardToken);
  const referred = await enroll({ slug: shop.programSlug, acceptedTerms: true, referralCode: new URL(share.shareUrl).searchParams.get("ref")! });
  await award({ userId: cashierId, locationId: shop.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: key(), requestId: key() });
  const email = `card-${label}@example.test`;
  await requestContactVerification(card.cardToken, email);
  const challenge = (await pool.query("SELECT id FROM contact_verification_challenges WHERE membership_id = $1", [card.id])).rows[0];
  await consumeContactVerification(verificationTokenForChallenge(challenge.id));
  await requestCardRecovery(email);
  // An Apple pass with a device event, and the card's consent to Wallet messages.
  const pass = (await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'apple', $3, 'active') RETURNING id", [shop.tenantId, card.id, `synthetic-${randomUUID()}`])).rows[0].id as string;
  await pool.query("INSERT INTO wallet_pass_events (pass_id, tenant_id, event, event_at) VALUES ($1, $2, 'device.registered', now())", [pass, shop.tenantId]);
  await pool.query("INSERT INTO wallet_message_consents (tenant_id, membership_id, text_version) VALUES ($1, $2, 'synthetic-v1')", [shop.tenantId, card.id]);
  await createDraftCampaign({ actorUserId: ownerId, programSlug: shop.programSlug, title: `Synthetic ${label}`, subject: "Nur synthetisch", body: "Kein Versand an echte Kunden", audienceDefinition: { kind: "new", withinDays: 7 } });
  await registerUnlinkedPlate({ actorUserId: operatorId, env: process.env, plateLabel: plate, uid: `04${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`, keyRef: `synthetic-${randomUUID()}`, configVersion: 1, publicRef: `t_${randomUUID().replaceAll("-", "").slice(0, 20)}`, initialCounter: 1 });
  await pool.query("UPDATE programs SET tap_mode = 'staff_confirmed', tap_cooldown_seconds = 60 WHERE id = $1", [shop.programId]);
  await setPlateLink({ actorUserId: operatorId, env: process.env, plateLabel: plate, programId: shop.programId, execute: true });
  // History the fixture's flows don't write: a card security event, a template binding and a purchase award on the first stamp.
  await pool.query("INSERT INTO card_security_events (tenant_id, membership_id, action, actor_user_id) VALUES ($1, $2, 'recovered', $3)", [shop.tenantId, card.id, cashierId]);
  await pool.query("INSERT INTO wallet_template_binding_events (tenant_id, location_id, action, new_template_id, actor_user_id) VALUES ($1, $2, 'set', $3, $4)", [shop.tenantId, shop.locationId, randomUUID(), operatorId]);
  await pool.query(`INSERT INTO purchase_awards (ledger_entry_id, tenant_id, rule_version_id, amount_minor, currency, applied_rate, points_awarded)
    SELECT l.id, l.tenant_id, v.id, 500, 'EUR', 1, 3 FROM ledger_entries l, program_rule_versions v WHERE l.membership_id = $1 AND l.delta > 0 AND v.tenant_id = l.tenant_id LIMIT 1`, [card.id]);
  // Rows without a tenant_id that hang off shop rows: a delivery of one of its email jobs, and its own NFC tag (no plate) with an activation code.
  const job = (await pool.query("SELECT id FROM outbox_jobs WHERE tenant_id = $1 LIMIT 1", [shop.tenantId])).rows[0].id as string;
  await pool.query("INSERT INTO email_deliveries (job_id, provider, recipient_hash, status, updated_at) VALUES ($1, 'mailpit', 'synthetic-hash', 'accepted', now())", [job]);
  const tag = (await pool.query(`INSERT INTO secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, last_counter, status)
    VALUES ($1, $2, $3, $4, $5, 'synthetic-key', 1, 0, 'active') RETURNING id`, [`t_${randomUUID().replaceAll("-", "").slice(0, 20)}`, shop.tenantId, shop.locationId, shop.programId, `04${randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`])).rows[0].id as string;
  await pool.query("INSERT INTO plate_activation_codes (tag_id, code_hash, issued_by_user_id, issued_at) VALUES ($1, 'synthetic-code-hash', $2, now())", [tag, operatorId]);
  // Loynara's billing records (kept), the owner's session (deleted with the login), and a Google pass (revoked first).
  const handoff = (await pool.query("INSERT INTO billing_handoffs (tenant_id, provider, status, currency, amount_minor, provider_ref) VALUES ($1, 'stripe', 'complete', 'EUR', 4900, $2) RETURNING id", [shop.tenantId, `cs_test_${randomUUID().slice(0, 8)}`])).rows[0].id as string;
  await pool.query("INSERT INTO billing_invoices (tenant_id, handoff_id, provider_invoice_id, status, currency, amount_minor, period_end) VALUES ($1, $2, $3, 'fixture_paid', 'EUR', 4900, now())", [shop.tenantId, handoff, `in_test_${randomUUID().slice(0, 8)}`]);
  await pool.query("INSERT INTO billing_webhook_events (event_id, tenant_id, event_type, payload_hash) VALUES ($1, $2, 'invoice.paid', 'synthetic')", [`evt_${randomUUID().replaceAll("-", "")}`, shop.tenantId]);
  await pool.query('INSERT INTO session (id, "expiresAt", token, "createdAt", "updatedAt", "userId") VALUES ($1, now() + interval \'1 day\', $2, now(), now(), $3)', [randomUUID(), randomUUID(), ownerId]);
  await pool.query("UPDATE locations SET contact_email = $1, latitude = 51.3, longitude = 9.5 WHERE tenant_id = $2", [`laden-${label}@example.test`, shop.tenantId]);
  await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'google', $3, 'created')", [shop.tenantId, card.id, `synthetic.loynara_${randomUUID()}`]);
  const device = `synthetic-device-${randomUUID()}`;
  await pool.query("INSERT INTO apple_devices (device_library_identifier, push_token, updated_at) VALUES ($1, 'synthetic-push-token', now())", [device]);
  await pool.query("INSERT INTO apple_registrations (device_library_identifier, tenant_id, membership_id, pass_type_identifier, serial_number) VALUES ($1, $2, $3, 'pass.synthetic.test', $4)", [device, shop.tenantId, card.id, randomUUID()]);
  return { ...shop, ownerId, cashierId, secondProgramId: second.programId, email, plate, device, cardId: card.id };
}

/** Ends every programme of the shop now (operator `end`); the export window then counts from today (Berlin). */
async function endShop(shop: { programId: string; secondProgramId: string }) {
  for (const programId of [shop.programId, shop.secondProgramId]) await operatorProgramme({ actorUserId: operatorId, env: process.env, programId, command: "end", execute: true });
}
const DAY = 86_400_000;
// Ended today: the export window runs through day 30, so erasure may run from day 31; DS-05 (7 days) sets day 37 as the deadline.
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY);
const berlin = (at: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(at);

/** Every row anywhere that names a shop: tables with tenant_id and every *_tenant_id column, found in the schema itself. */
async function rowsNaming(tenantId: string) {
  const { rows: columns } = await pool.query<{ table: string; column: string }>(`SELECT table_name AS table, column_name AS column FROM information_schema.columns
    WHERE table_schema = 'public' AND (column_name = 'tenant_id' OR column_name LIKE '%\\_tenant\\_id') AND table_name <> 'shop_erasures' ORDER BY 1, 2`);
  const counts: Record<string, number> = {};
  for (const { table, column } of columns) counts[`${table}.${column}`] = (await pool.query(`SELECT count(*)::int AS n FROM "${table}" WHERE "${column}" = $1`, [tenantId])).rows[0].n;
  counts["tenants.id"] = (await pool.query("SELECT count(*)::int AS n FROM tenants WHERE id = $1", [tenantId])).rows[0].n;
  return counts;
}
const nonEmpty = (counts: Record<string, number>) => Object.keys(counts).filter(name => counts[name] > 0).sort();
// Legal's ruling, pinned here rather than read from the module: billing records (8 years) and their tenant and location rows.
const LEGAL_KEEP = ["billing_invoices", "billing_handoffs", "billing_location_plans", "billing_webhook_events", "subscriptions", "tenants", "locations"];
const kept = (name: string) => LEGAL_KEEP.includes(name.split(".")[0]);
/** Providers as the erasure calls them: Google objects deactivated (the pass rows marked revoked), Mailgun addresses recorded. */
function fakeProviders() {
  const removed: string[] = [];
  const providers: ErasureProviders = {
    google: async tenantId => (await pool.query("UPDATE wallet_passes SET status = 'revoked', revoked_at = now(), revoke_reason = 'closed' WHERE tenant_id = $1 AND provider = 'google' AND status <> 'revoked'", [tenantId])).rowCount ?? 0,
    mailgun: async address => { removed.push(address); },
  };
  return { providers, removed };
}
const erase = (tenantId: string, now: Date, execute = true, extra: { keep?: readonly string[]; providers?: ErasureProviders } = {}) =>
  shopErasure({ actorUserId: operatorId, env: process.env, tenantId, execute, now, keep: extra.keep, providers: extra.providers ?? fakeProviders().providers });
const userExists = async (id: string) => (await pool.query('SELECT count(*)::int AS n FROM "user" WHERE id = $1', [id])).rows[0].n === 1;

describe("shop erasure (ENG-166, DS-05)", () => {
  it("erases every row of the shop in every table the schema has, keeps only Loynara's records, and leaves the other shop as it was", async () => {
    const gone = await busyShop("A", "P-901");
    const other = await busyShop("B", "P-902");
    await endShop(gone);
    // A plate still bound to the shop (the end unlinks active plates; this one was linked again by hand) goes back to stock.
    await pool.query("UPDATE secure_tags SET tenant_id = $1, location_id = $2, program_id = $3, status = 'active' WHERE plate_label = $4", [gone.tenantId, gone.locationId, gone.programId, gone.plate]);
    expect([...ERASURE_KEEP].sort()).toEqual([...LEGAL_KEEP].sort());
    const before = await rowsNaming(gone.tenantId);
    const otherBefore = await rowsNaming(other.tenantId);
    // The fixture reaches the history tables that refuse deletes, so the exemption is exercised for each of them.
    expect(nonEmpty(before)).toEqual(expect.arrayContaining(["ledger_entries.tenant_id", "program_rule_versions.tenant_id", "staff_audit_events.tenant_id", "card_security_events.tenant_id", "wallet_template_binding_events.tenant_id",
      "reward_versions.tenant_id", "redemptions.tenant_id", "wallet_message_consents.tenant_id", "programme_cancellation_events.tenant_id", "plate_link_events.old_tenant_id", "plate_link_events.new_tenant_id", "purchase_awards.tenant_id",
      "memberships.tenant_id", "membership_contacts.tenant_id", "referrals.tenant_id", "campaigns.tenant_id", "outbox_jobs.tenant_id", "apple_registrations.tenant_id", "wallet_passes.tenant_id",
      "subscriptions.tenant_id", "billing_invoices.tenant_id", "billing_handoffs.tenant_id", "billing_webhook_events.tenant_id", "billing_location_plans.tenant_id"]));

    const { providers, removed } = fakeProviders();
    const outcome = await erase(gone.tenantId, daysFromNow(31), true, { providers });
    expect(outcome).toMatchObject({ result: "erased", reasons: [], external: { googleCards: 1, mailgunAddresses: 1 } });
    // Only Loynara's own records still name the shop, exactly as many rows as before; everything else is gone.
    const after = await rowsNaming(gone.tenantId);
    expect(nonEmpty(after)).toEqual(nonEmpty(before).filter(kept));
    for (const name of nonEmpty(after)) expect(after[name]).toBe(before[name]);
    expect(await rowsNaming(other.tenantId)).toEqual(otherBefore);
    // Kept rows are reduced: the shop's contact address, logo and coordinates are cleared.
    for (const row of await db.select().from(locations).where(eq(locations.tenantId, gone.tenantId))) expect(row).toMatchObject({ contactEmail: null, logoData: null, latitude: null, longitude: null });
    // Logins: the owner's (with its session) and the cashier's are gone (a login holds one role, staff_roles_user_id_uq);
    // the operator and the other shop's logins stay.
    expect(await userExists(gone.ownerId)).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS n FROM session WHERE "userId" = $1', [gone.ownerId])).rows[0].n).toBe(0);
    expect(await userExists(gone.cashierId)).toBe(false);
    expect(await userExists(operatorId)).toBe(true);
    expect(await userExists(other.ownerId)).toBe(true);
    // Mailgun's copies: only the address no other shop's card uses.
    expect(removed).toEqual([gone.email.toLowerCase()]);
    // The erasure record: the contract facts copied first, counts, provider clean-up, the confirmation's address; no customer data.
    const [record] = await db.select().from(shopErasures).where(eq(shopErasures.erasedTenantId, gone.tenantId));
    const today = berlin(new Date());
    expect(record).toMatchObject({ legalName: "Synthetic A", endDate: today, exportUntil: berlin(daysFromNow(30)), actorUserId: operatorId, rowCounts: outcome.rows,
      external: { googleCards: 1, mailgunAddresses: 1 }, confirmationName: "Synthetic owner A", confirmationSentAt: null, confirmationSendableAt: expect.any(Date) });
    expect(record.confirmationEmail).toMatch(/@example\.test$/);
    expect(record.contract).toMatchObject({ cancellation: [expect.objectContaining({ action: "end", by: `operator ${operatorId}`, newEndDate: today }), expect.objectContaining({ action: "end" })] });
    expect(JSON.stringify(record)).not.toContain(gone.email.toLowerCase());
    expect(outcome.rows).toMatchObject({ memberships: 2, "secure_tags (plates unlinked)": 1, "apple_devices (only this shop's)": 1, "card_recovery_challenges (only this shop's addresses)": 1,
      "email_deliveries (of outbox_jobs)": 1, "plate_activation_codes (of secure_tags)": 1, secure_tags: 1, "user (logins only this shop had, with sessions)": 2 });
    // Plate back in stock; the other shop's device, recovery request, delivery and NFC code stay.
    expect((await db.select().from(secureTags).where(eq(secureTags.plateLabel, gone.plate)))[0]).toMatchObject({ tenantId: null, programId: null, status: "unlinked" });
    expect((await pool.query("SELECT count(*)::int AS n FROM apple_devices WHERE device_library_identifier = ANY($1)", [[gone.device, other.device]])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT email FROM card_recovery_challenges")).rows.map(row => row.email)).toEqual([other.email.toLowerCase()]);
    expect((await pool.query("SELECT count(*)::int AS n FROM email_deliveries")).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM plate_activation_codes")).rows[0].n).toBe(1);
    await expect(erase(gone.tenantId, daysFromNow(32))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("may run once the export window is over, lists the shop with its DS-05 deadline, and shows a dry run that deletes nothing", async () => {
    const shop = await busyShop("A", "P-903");
    await endShop(shop);
    const before = await rowsNaming(shop.tenantId);
    expect(await erase(shop.tenantId, daysFromNow(30))).toMatchObject({ result: "blocked", reasons: ["EXPORT_WINDOW_OPEN"], exportUntil: berlin(daysFromNow(30)), deadline: berlin(daysFromNow(37)) });
    const dry = await erase(shop.tenantId, daysFromNow(31), false);
    expect(dry).toMatchObject({ result: "would_erase", reasons: [], rows: { memberships: 2, ledger_entries: expect.any(Number), "user (logins only this shop had, with sessions)": 2 } });
    expect(await rowsNaming(shop.tenantId)).toEqual(before);
    expect((await dueShopErasures(daysFromNow(30))).due).toEqual([]);
    expect((await dueShopErasures(daysFromNow(31))).due).toEqual([expect.objectContaining({ tenantId: shop.tenantId, deadline: berlin(daysFromNow(37)), overdue: false, billing: false })]);
    expect((await dueShopErasures(daysFromNow(38))).due).toEqual([expect.objectContaining({ overdue: true })]);
  });

  it("refuses while a programme runs, while any Stripe subscription that hasn't ended or an open checkout exists, and for a non-operator", async () => {
    const shop = await busyShop("A", "P-904");
    expect(await erase(shop.tenantId, daysFromNow(400))).toMatchObject({ result: "blocked", reasons: ["PROGRAMME_RUNNING"] });
    await endShop(shop);
    for (const status of ["active", "past_due", "suspended", "pending_checkout"]) {
      await db.update(subscriptions).set({ provider: "stripe", status, providerSubscriptionId: "sub_test_erasure" }).where(eq(subscriptions.tenantId, shop.tenantId));
      expect(await erase(shop.tenantId, daysFromNow(400))).toMatchObject({ result: "blocked", reasons: ["STRIPE_SUBSCRIPTION_RUNNING"] });
    }
    // Listed all the same once past the export window, so the operator sees it must be ended in Stripe.
    expect((await dueShopErasures(daysFromNow(400))).due).toEqual([expect.objectContaining({ tenantId: shop.tenantId, billing: true, overdue: true })]);
    await db.update(subscriptions).set({ status: "cancelled" }).where(eq(subscriptions.tenantId, shop.tenantId));
    await pool.query("INSERT INTO billing_handoffs (tenant_id, provider, status, currency, amount_minor) VALUES ($1, 'stripe', 'pending', 'EUR', 4900)", [shop.tenantId]);
    expect(await erase(shop.tenantId, daysFromNow(400))).toMatchObject({ result: "blocked", reasons: ["STRIPE_SUBSCRIPTION_RUNNING"] });
    await pool.query("UPDATE billing_handoffs SET status = 'expired' WHERE tenant_id = $1", [shop.tenantId]);
    await expect(shopErasure({ actorUserId: shop.ownerId, env: process.env, tenantId: shop.tenantId, execute: true, now: daysFromNow(400) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await erase(shop.tenantId, daysFromNow(400))).toMatchObject({ result: "erased" });
  });

  it("does the provider clean-up first: a Google object it can't revoke stops the erasure before anything is deleted", async () => {
    const shop = await busyShop("A", "P-909");
    await endShop(shop);
    const before = await rowsNaming(shop.tenantId);
    let tries = 0;
    const providers: ErasureProviders = { google: async () => { tries += 1; return 0; }, mailgun: async () => {} };
    await expect(erase(shop.tenantId, daysFromNow(31), true, { providers })).rejects.toMatchObject({ code: "EXTERNAL_PENDING" });
    expect(await rowsNaming(shop.tenantId)).toEqual(before);
    expect(await db.select().from(shopErasures)).toEqual([]);
    // Mailgun failing three times stops it too; one failure is retried.
    let calls = 0;
    const flaky: ErasureProviders = { ...fakeProviders().providers, mailgun: async () => { calls += 1; if (calls === 1) throw new Error("synthetic 503"); } };
    expect(await erase(shop.tenantId, daysFromNow(31), true, { providers: flaky })).toMatchObject({ result: "erased" });
    expect(calls).toBe(2);
    expect(tries).toBe(1);
  });

  it("keeps the history tables append-only outside an erasure, and inside one for any other shop", async () => {
    const a = await busyShop("A", "P-905");
    const b = await busyShop("B", "P-906");
    await expect(pool.query("DELETE FROM ledger_entries WHERE tenant_id = $1", [b.tenantId])).rejects.toThrow(/append-only/);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('loynara.erasure', $1, true)", [a.tenantId]);
      await expect(client.query("DELETE FROM redemptions WHERE tenant_id = $1", [b.tenantId])).rejects.toThrow(/append-only/);
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SELECT set_config('loynara.erasure', $1, true)", [a.tenantId]);
      await expect(client.query("UPDATE ledger_entries SET delta = delta WHERE tenant_id = $1", [a.tenantId])).rejects.toThrow(/append-only/);
      await client.query("ROLLBACK");
      // The setting is transaction-local: the next transaction on the same connection is guarded again.
      await expect(client.query("DELETE FROM ledger_entries WHERE tenant_id = $1", [a.tenantId])).rejects.toThrow(/append-only/);
    } finally { client.release(); }
  });

  it("the erasure record is append-only; the confirmation's sending is stamped once", async () => {
    const shop = await busyShop("A", "P-910");
    await endShop(shop);
    await erase(shop.tenantId, daysFromNow(31));
    expect((await dueShopErasures(daysFromNow(31))).confirmations).toEqual([{ tenantId: shop.tenantId, name: "Synthetic A" }]);
    await expect(pool.query("UPDATE shop_erasures SET legal_name = 'x'")).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM shop_erasures")).rejects.toThrow(/append-only/);
    expect(await recordErasureConfirmation({ actorUserId: operatorId, env: process.env, tenantId: shop.tenantId })).toMatchObject({ tenantId: shop.tenantId });
    await expect(recordErasureConfirmation({ actorUserId: operatorId, env: process.env, tenantId: shop.tenantId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(pool.query("UPDATE shop_erasures SET confirmation_sent_at = now()")).rejects.toThrow(/append-only/);
    expect((await dueShopErasures(daysFromNow(31))).confirmations).toEqual([]);
  });

  it("after a restore, re-applies every erasure, also one the restored backup has no record of, and is idempotent", async () => {
    const restored = await busyShop("A", "P-911");
    await endShop(restored);
    const ownerId = restored.ownerId;
    // As exported from the live database before the restore: the shop was erased there after this backup was taken.
    const exported = [{ id: randomUUID(), erasedTenantId: restored.tenantId, legalName: "Synthetic A", endDate: berlin(new Date()), exportUntil: berlin(daysFromNow(30)), actorUserId: operatorId,
      contract: { cancellation: [] }, rowCounts: { memberships: 2 }, external: { googleCards: 0, mailgunAddresses: 0 }, confirmationName: null, confirmationEmail: null,
      erasedAt: daysFromNow(31), confirmationSendableAt: daysFromNow(31), confirmationSentAt: null }];
    const applied = await reapplyErasures(exported);
    expect(applied).toEqual([expect.objectContaining({ tenantId: restored.tenantId, rows: expect.objectContaining({ memberships: 2 }) })]);
    expect(nonEmpty(await rowsNaming(restored.tenantId)).every(kept)).toBe(true);
    expect(await userExists(ownerId)).toBe(false);
    expect(await db.select().from(shopErasures)).toHaveLength(1);
    expect(await reapplyErasures(exported)).toEqual([]);
  });

  it("keep-list: a kept table keeps the rows it references, and an incomplete list is refused before anything is deleted", async () => {
    const shop = await busyShop("A", "P-907");
    await endShop(shop);
    await expect(erase(shop.tenantId, daysFromNow(31), true, { keep: ["billing_invoices"] })).rejects.toMatchObject({ code: "ERASURE_KEEP_INCOMPLETE", message: expect.stringContaining("billing_handoffs") });
    expect((await rowsNaming(shop.tenantId))["memberships.tenant_id"]).toBe(2);
    expect(await db.select().from(shopErasures)).toEqual([]);
  });

  it("takes the DS-05 period from SHOP_ERASURE_DELAY_DAYS: 7 by default, longer when set, never shorter", async () => {
    expect(erasureDelayDays({})).toBe(7);
    expect(erasureDelayDays({ SHOP_ERASURE_DELAY_DAYS: "30" })).toBe(30);
    for (const value of ["6", "0", "-1", "7.5", "seven", "99999"]) expect(erasureDelayDays({ SHOP_ERASURE_DELAY_DAYS: value })).toBeNull();
    const shop = await busyShop("A", "P-908");
    await endShop(shop);
    process.env.SHOP_ERASURE_DELAY_DAYS = "14";
    expect(await erase(shop.tenantId, daysFromNow(31), false)).toMatchObject({ deadline: berlin(daysFromNow(44)) });
    process.env.SHOP_ERASURE_DELAY_DAYS = "3";
    await expect(erase(shop.tenantId, daysFromNow(31), false)).rejects.toMatchObject({ code: "ERASURE_CONFIG" });
  });
});
