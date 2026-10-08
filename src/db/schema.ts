import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 180 }).notNull(),
  slug: varchar("slug", { length: 100 }).notNull().unique(),
  currency: varchar("currency", { length: 3 }).notNull().default("EUR"),
  locale: varchar("locale", { length: 5 }).notNull().default("de"),
  createdAt: createdAt(),
});

export const locations = pgTable("locations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  name: varchar("name", { length: 180 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  country: varchar("country", { length: 2 }).notNull(),
  timezone: varchar("timezone", { length: 80 }).notNull(),
  contactEmail: varchar("contact_email", { length: 320 }),
  brandColor: varchar("brand_color", { length: 7 }).notNull().default("#264C45"),
  logoData: text("logo_data"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  createdAt: createdAt(),
}, (t) => [
  unique("locations_tenant_id_id_uq").on(t.tenantId, t.id),
  check("location_coordinates_valid", sql`(${t.latitude} is null and ${t.longitude} is null) or (${t.latitude} between -90 and 90 and ${t.longitude} between -180 and 180)`),
]);

export const staffRoles = pgTable("staff_roles", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  userId: text("user_id").notNull(),
  role: varchar("role", { length: 12 }).notNull(),
  locationId: uuid("location_id"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.userId] }),
  unique("staff_roles_user_id_uq").on(t.userId),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("staff_role_valid", sql`${t.role} in ('owner','manager','cashier')`),
]);

export const staffInvites = pgTable("staff_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  invitedEmail: varchar("invited_email", { length: 320 }).notNull(),
  role: varchar("role", { length: 12 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  invitedByUserId: text("invited_by_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("staff_invite_role_valid", sql`${t.role} in ('manager','cashier')`),
]);

export const staffAuditEvents = pgTable("staff_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  action: varchar("action", { length: 24 }).notNull(),
  actorUserId: text("actor_user_id").notNull(),
  subjectUserId: text("subject_user_id"),
  inviteId: uuid("invite_id"),
  locationId: uuid("location_id"),
  role: varchar("role", { length: 12 }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("staff_audit_tenant_time_idx").on(t.tenantId, t.createdAt),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("staff_audit_action_valid", sql`${t.action} in ('invite_created','invite_accepted','access_revoked')`),
  check("staff_audit_role_valid", sql`${t.role} in ('manager','cashier')`),
]);

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  type: varchar("type", { length: 8 }).notNull(),
  status: varchar("status", { length: 10 }).notNull().default("active"),
  earningMode: varchar("earning_mode", { length: 8 }).notNull().default("manual"),
  tapMode: varchar("tap_mode", { length: 20 }).notNull().default("disabled"),
  tapCooldownSeconds: integer("tap_cooldown_seconds"),
  // Retain the legacy physical column name; rates are per EUR or MAD major unit.
  pointsPerCurrencyUnit: integer("points_per_euro").notNull().default(1),
  rulesText: text("rules_text").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  unique("programs_tenant_id_id_uq").on(t.tenantId, t.id),
  uniqueIndex("programs_one_active_per_location_uq").on(t.locationId).where(sql`${t.status} = 'active'`),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("program_type_valid", sql`${t.type} in ('stamp','points')`),
  check("program_status_valid", sql`${t.status} in ('active','archived')`),
  check("program_earning_mode_valid", sql`${t.earningMode} in ('manual','purchase')`),
  check("program_tap_mode_valid", sql`${t.tapMode} in ('disabled','automatic_fixed','staff_confirmed')`),
  check("program_tap_cooldown_valid", sql`${t.tapCooldownSeconds} is null or ${t.tapCooldownSeconds} between 1 and 86400`),
  check("program_points_positive", sql`${t.pointsPerCurrencyUnit} between 1 and 1000`),
]);

export const programRuleVersions = pgTable("program_rule_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  version: integer("version").notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  type: varchar("type", { length: 8 }).notNull(),
  rulesText: text("rules_text").notNull(),
  earningMode: varchar("earning_mode", { length: 8 }).notNull(),
  pointsPerCurrencyUnit: integer("points_per_currency_unit").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  unique("program_rule_versions_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("program_rule_versions_number_uq").on(t.programId, t.version),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  check("program_rule_version_type_valid", sql`${t.type} in ('stamp','points')`),
  check("program_rule_version_earning_mode_valid", sql`${t.earningMode} in ('manual','purchase')`),
  check("program_rule_version_points_valid", sql`${t.pointsPerCurrencyUnit} between 1 and 1000`),
]);

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  active: boolean("active").notNull().default(true),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  unique("rewards_tenant_id_id_uq").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  check("reward_sort_order_nonnegative", sql`${t.sortOrder} >= 0`),
]);

export const rewardVersions = pgTable("reward_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  rewardId: uuid("reward_id").notNull(),
  version: integer("version").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  cost: integer("cost").notNull(),
  termsText: text("terms_text").notNull().default(""),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  unique("reward_versions_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("reward_versions_number_uq").on(t.rewardId, t.version),
  foreignKey({ columns: [t.tenantId, t.rewardId], foreignColumns: [rewards.tenantId, rewards.id] }),
  check("reward_cost_positive", sql`${t.cost} > 0`),
]);

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  scanCode: varchar("scan_code", { length: 64 }).notNull().unique(),
  cardToken: varchar("card_token", { length: 100 }).notNull().unique(),
  balance: integer("balance").notNull().default(0),
  // Short random locator for manual counter lookup, displayed as "K-7QX2MA" (lib/card-locator). Six characters from a
  // 31-symbol alphabet without I, L, O, 0 or 1. Assigned by a database trigger (0019) when an insert leaves it empty;
  // unique per tenant, immutable, not sequential. It finds a card for authenticated staff and is never a credential.
  cardLocator: varchar("card_locator", { length: 6 }).notNull().default(""),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("memberships_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("memberships_card_locator_uq").on(t.tenantId, t.cardLocator),
  check("membership_card_locator_valid", sql`${t.cardLocator} ~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$'`),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  check("membership_balance_nonnegative", sql`${t.balance} >= 0`),
]);

export const membershipContacts = pgTable("membership_contacts", {
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  email: varchar("email", { length: 320 }),
  emailVerified: boolean("email_verified").notNull().default(false),
  recoveryTokenHash: varchar("recovery_token_hash", { length: 128 }),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.membershipId] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
]);

export const contactVerificationChallenges = pgTable("contact_verification_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("contact_challenge_membership_idx").on(t.tenantId, t.membershipId, t.createdAt),
]);

export const cardRecoveryChallenges = pgTable("card_recovery_challenges", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: varchar("email", { length: 320 }).notNull(),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("card_recovery_email_idx").on(t.email, t.createdAt)]);

export const cardSecurityEvents = pgTable("card_security_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  action: varchar("action", { length: 32 }).notNull(),
  // Set for staff-initiated actions (0019); customer self-service rows leave these empty.
  actorUserId: text("actor_user_id"),
  reason: varchar("reason", { length: 240 }),
  // How the merchant satisfied themselves that the person belongs to the card. Never proof that Loynara verified anyone.
  verificationMethod: varchar("verification_method", { length: 24 }),
  // Client-chosen key so a retried staff request after an unclear network result is applied once.
  idempotencyKey: varchar("idempotency_key", { length: 100 }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("card_security_membership_idx").on(t.tenantId, t.membershipId, t.createdAt),
  uniqueIndex("card_security_idempotency_uq").on(t.tenantId, t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  check("card_security_verification_valid", sql`${t.verificationMethod} is null or ${t.verificationMethod} in ('card_link','stored_contact','other_check')`),
]);

export const consentEvents = pgTable("consent_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  channel: varchar("channel", { length: 12 }).notNull(),
  purpose: varchar("purpose", { length: 24 }).notNull(),
  granted: boolean("granted").notNull(),
  noticeVersion: varchar("notice_version", { length: 32 }).notNull(),
  source: varchar("source", { length: 32 }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("consent_membership_idx").on(t.tenantId, t.membershipId, t.createdAt),
]);

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  delta: integer("delta").notNull(),
  kind: varchar("kind", { length: 12 }).notNull(),
  source: varchar("source", { length: 24 }).notNull().default("staff_online"),
  actorUserId: text("actor_user_id"),
  requestId: uuid("request_id").notNull(),
  idempotencyKey: varchar("idempotency_key", { length: 100 }).notNull(),
  deviceAt: timestamp("device_at", { withTimezone: true }),
  reason: varchar("reason", { length: 240 }),
  reversalOfId: uuid("reversal_of_id"),
  createdAt: createdAt(),
}, (t) => [
  unique("ledger_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("ledger_idempotency_uq").on(t.tenantId, t.idempotencyKey),
  uniqueIndex("ledger_single_reversal_uq").on(t.reversalOfId).where(sql`${t.reversalOfId} is not null`),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.reversalOfId], foreignColumns: [t.tenantId, t.id] }),
  index("ledger_member_time_idx").on(t.membershipId, t.createdAt),
  check("ledger_delta_nonzero", sql`${t.delta} <> 0`),
  check("ledger_kind_valid", sql`${t.kind} in ('award','redeem','reversal')`),
  check("ledger_source_valid", sql`${t.source} in ('staff_online','staff_offline','staff_correction','synthetic_seed','legacy_unclassified','referral_bonus','nfc_tap')`),
  check("ledger_nfc_actor_valid", sql`(${t.source} = 'nfc_tap' and ${t.actorUserId} is null) or (${t.source} <> 'nfc_tap' and ${t.actorUserId} is not null)`),
]);

export const secureTags = pgTable("secure_tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  publicRef: varchar("public_ref", { length: 32 }).notNull().unique(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  programId: uuid("program_id").notNull(),
  uid: varchar("uid", { length: 14 }).notNull(),
  keyRef: varchar("key_ref", { length: 160 }).notNull(),
  configVersion: integer("config_version").notNull(),
  lastCounter: integer("last_counter").notNull().default(0),
  status: varchar("status", { length: 12 }).notNull().default("provisioned"),
  replacesTagId: uuid("replaces_tag_id"),
  provisionedAt: timestamp("provisioned_at", { withTimezone: true }),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  // One live tag per chip. A revoked or replaced row keeps its history, and the same chip can be registered again.
  uniqueIndex("secure_tag_uid_live_uq").on(t.uid).where(sql`${t.status} in ('provisioned','active')`),
  check("secure_tag_status_valid", sql`${t.status} in ('provisioned','active','revoked','replaced')`),
  check("secure_tag_counter_valid", sql`${t.lastCounter} between 0 and 16777215`),
  check("secure_tag_version_valid", sql`${t.configVersion} > 0`),
]);

export const tapRequests = pgTable("tap_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tagId: uuid("tag_id").notNull().references(() => secureTags.id),
  counter: integer("counter").notNull(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  programId: uuid("program_id").notNull(),
  membershipId: uuid("membership_id"),
  status: varchar("status", { length: 20 }).notNull(),
  ledgerEntryId: uuid("ledger_entry_id"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  unique("tap_request_counter_uq").on(t.tagId, t.counter),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  check("tap_request_counter_valid", sql`${t.counter} between 1 and 16777215`),
  check("tap_request_status_valid", sql`${t.status} in ('awarded','cooldown','pending_staff','confirmed','expired','cancelled')`),
]);

/**
 * Web Push subscriptions of staff devices, used only to wake a cashier phone when an NFC tap waits for confirmation.
 * One row per browser endpoint. Bound to the login session that created it: signing out (or the session expiring and
 * being deleted) removes the row through the foreign key added in migration 0021 (the auth tables live outside this
 * schema, in drizzle/auth.sql). Every send re-checks that the user still has an active role at the location.
 */
export const staffPushSubscriptions = pgTable("staff_push_subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  userId: text("user_id").notNull(),
  sessionId: text("session_id").notNull(),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: varchar("p256dh", { length: 100 }).notNull(),
  auth: varchar("auth", { length: 40 }).notNull(),
  locale: varchar("locale", { length: 2 }).notNull().default("de"),
  failureCount: integer("failure_count").notNull().default(0),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  index("staff_push_location_idx").on(t.tenantId, t.locationId),
  check("staff_push_locale_valid", sql`${t.locale} in ('de','fr')`),
  check("staff_push_endpoint_https", sql`${t.endpoint} like 'https://%'`),
]);

// A lease is issued only while the cashier and card are online. It is scoped
// to one staff member, browser device, location and membership.
export const offlineAwardLeases = pgTable("offline_award_leases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  deviceHash: varchar("device_hash", { length: 64 }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("offline_lease_actor_expiry_idx").on(t.actorUserId, t.expiresAt),
]);

export const offlineAwardEvents = pgTable("offline_award_events", {
  id: uuid("id").primaryKey(),
  leaseId: uuid("lease_id").notNull().references(() => offlineAwardLeases.id),
  tenantId: uuid("tenant_id").notNull(),
  locationId: uuid("location_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  awardPayload: jsonb("award_payload").notNull().$type<{ quantity: number } | { purchaseAmountMinor: number; ruleVersionId: string }>(),
  eventAt: timestamp("event_at", { withTimezone: true }).notNull(),
  status: varchar("status", { length: 12 }).notNull(),
  reason: varchar("reason", { length: 48 }),
  ledgerEntryId: uuid("ledger_entry_id"),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.ledgerEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  index("offline_event_lease_idx").on(t.leaseId, t.processedAt),
  check("offline_event_status_valid", sql`${t.status} in ('accepted','rejected')`),
]);

export const purchaseAwards = pgTable("purchase_awards", {
  ledgerEntryId: uuid("ledger_entry_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  ruleVersionId: uuid("rule_version_id").notNull(),
  amountMinor: integer("amount_minor").notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  appliedRate: integer("applied_rate").notNull(),
  pointsAwarded: integer("points_awarded").notNull(),
  rounding: varchar("rounding", { length: 8 }).notNull().default("floor"),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.ledgerEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  foreignKey({ columns: [t.tenantId, t.ruleVersionId], foreignColumns: [programRuleVersions.tenantId, programRuleVersions.id] }),
  check("purchase_amount_positive", sql`${t.amountMinor} between 1 and 10000000`),
  check("purchase_rate_positive", sql`${t.appliedRate} between 1 and 1000`),
  check("purchase_points_positive", sql`${t.pointsAwarded} > 0`),
  check("purchase_currency_valid", sql`${t.currency} in ('EUR','MAD')`),
  check("purchase_rounding_valid", sql`${t.rounding} = 'floor'`),
]);

export const redemptions = pgTable("redemptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  ledgerEntryId: uuid("ledger_entry_id").notNull(),
  rewardVersionId: uuid("reward_version_id").notNull(),
  rewardTitle: varchar("reward_title", { length: 180 }).notNull(),
  cost: integer("cost").notNull(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.ledgerEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  foreignKey({ columns: [t.tenantId, t.rewardVersionId], foreignColumns: [rewardVersions.tenantId, rewardVersions.id] }),
  uniqueIndex("redemptions_ledger_uq").on(t.ledgerEntryId),
]);

export const outboxJobs = pgTable("outbox_jobs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  kind: varchar("kind", { length: 32 }).notNull(),
  payload: jsonb("payload").$type<Record<string, string>>().notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
  lastError: varchar("last_error", { length: 300 }),
  createdAt: createdAt(),
}, (t) => [
  index("outbox_due_idx").on(t.status, t.nextAttemptAt),
  // Coalescing lookup for lib/wallet/enqueue: at most one not-yet-claimed wallet refresh per card.
  uniqueIndex("outbox_wallet_pending_member_idx").on(t.tenantId, sql`(${t.payload} ->> 'membershipId')`).where(sql`${t.kind} = 'wallet.refresh' and ${t.status} = 'pending' and ${t.payload} ->> 'coalescingVersion' = '1'`),
  foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }),
]);

export const emailDeliveries = pgTable("email_deliveries", {
  jobId: uuid("job_id").primaryKey().references(() => outboxJobs.id),
  provider: varchar("provider", { length: 16 }).notNull(),
  recipientHash: varchar("recipient_hash", { length: 64 }).notNull(),
  providerMessageId: varchar("provider_message_id", { length: 255 }),
  status: varchar("status", { length: 24 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("email_deliveries_message_idx").on(t.providerMessageId)]);

export const emailProviderEvents = pgTable("email_provider_events", {
  id: varchar("id", { length: 128 }).primaryKey(),
  signatureTokenHash: varchar("signature_token_hash", { length: 64 }).notNull().unique(),
  jobId: uuid("job_id").references(() => outboxJobs.id),
  event: varchar("event", { length: 32 }).notNull(),
  createdAt: createdAt(),
});

export const emailSuppressions = pgTable("email_suppressions", {
  recipientHash: varchar("recipient_hash", { length: 64 }).primaryKey(),
  reason: varchar("reason", { length: 32 }).notNull(),
  createdAt: createdAt(),
});

export const campaigns = pgTable("campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  title: varchar("title", { length: 180 }).notNull(),
  subject: varchar("subject", { length: 120 }).notNull(),
  body: text("body").notNull(),
  audienceDefinition: jsonb("audience_definition").$type<Record<string, unknown>>().notNull(),
  status: varchar("status", { length: 16 }).notNull().default("draft"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
  scheduleRevision: integer("schedule_revision").notNull().default(0),
  audienceAsOf: timestamp("audience_as_of", { withTimezone: true }),
  audienceCount: integer("audience_count").notNull().default(0),
  queuedCount: integer("queued_count").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("campaigns_tenant_id_id_uq").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  index("campaigns_tenant_created_idx").on(t.tenantId, t.createdAt),
  check("campaign_status_valid", sql`${t.status} in ('draft','scheduled','paused','dispatching','complete','blocked','cancelled')`),
  check("campaign_schedule_revision_nonnegative", sql`${t.scheduleRevision} >= 0`),
  check("campaign_counts_nonnegative", sql`${t.audienceCount} >= 0 and ${t.queuedCount} >= 0 and ${t.queuedCount} <= ${t.audienceCount}`),
]);

export const campaignRecipients = pgTable("campaign_recipients", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  campaignId: uuid("campaign_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("queued"),
  suppressReason: varchar("suppress_reason", { length: 120 }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("campaign_recipients_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("campaign_recipient_member_uq").on(t.campaignId, t.membershipId),
  foreignKey({ columns: [t.tenantId, t.campaignId], foreignColumns: [campaigns.tenantId, campaigns.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  check("campaign_recipient_status_valid", sql`${t.status} in ('queued','complete','suppressed','failed')`),
]);

export const campaignAttempts = pgTable("campaign_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  recipientId: uuid("recipient_id").notNull(),
  outboxJobId: uuid("outbox_job_id").notNull().references(() => outboxJobs.id),
  attempt: integer("attempt").notNull(),
  status: varchar("status", { length: 12 }).notNull(),
  reason: varchar("reason", { length: 120 }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.recipientId], foreignColumns: [campaignRecipients.tenantId, campaignRecipients.id] }),
  unique("campaign_attempt_once_uq").on(t.outboxJobId, t.attempt),
  check("campaign_attempt_positive", sql`${t.attempt} > 0`),
  check("campaign_attempt_status_valid", sql`${t.status} in ('complete','suppressed','retry','failed','blocked')`),
]);

export const campaignDailyUsage = pgTable("campaign_daily_usage", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  day: date("day").notNull(),
  queued: integer("queued").notNull().default(0),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.day] }),
  check("campaign_daily_queued_valid", sql`${t.queued} between 0 and 100`),
]);

export const automationRules = pgTable("automation_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  createdByUserId: text("created_by_user_id").notNull(),
  triggerKind: varchar("trigger_kind", { length: 20 }).notNull(),
  enabled: boolean("enabled").notNull().default(false),
  channel: varchar("channel", { length: 8 }).notNull().default("email"),
  subject: varchar("subject", { length: 120 }).notNull(),
  body: text("body").notNull(),
  inactivityDays: integer("inactivity_days"),
  cooldownDays: integer("cooldown_days").notNull().default(7),
  dailyCap: integer("daily_cap").notNull().default(20),
  revision: integer("revision").notNull().default(1),
  nextScanAt: timestamp("next_scan_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("automation_rules_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("automation_rules_program_trigger_uq").on(t.programId, t.triggerKind),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  check("automation_rule_trigger_valid", sql`${t.triggerKind} in ('first_checkout','inactive')`),
  check("automation_rule_channel_valid", sql`${t.channel} = 'email'`),
  check("automation_rule_cooldown_valid", sql`${t.cooldownDays} between 7 and 365`),
  check("automation_rule_daily_cap_valid", sql`${t.dailyCap} between 1 and 20`),
  check("automation_rule_inactivity_valid", sql`(${t.triggerKind} = 'first_checkout' and ${t.inactivityDays} is null) or (${t.triggerKind} = 'inactive' and ${t.inactivityDays} between 7 and 365)`),
]);

export const automationRuns = pgTable("automation_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  ruleId: uuid("rule_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  ruleRevision: integer("rule_revision").notNull(),
  triggerKey: varchar("trigger_key", { length: 40 }).notNull(),
  sourceEntryId: uuid("source_entry_id"),
  status: varchar("status", { length: 12 }).notNull().default("queued"),
  reason: varchar("reason", { length: 120 }),
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("automation_runs_tenant_id_id_uq").on(t.tenantId, t.id),
  unique("automation_run_once_uq").on(t.ruleId, t.membershipId, t.triggerKey),
  foreignKey({ columns: [t.tenantId, t.ruleId], foreignColumns: [automationRules.tenantId, automationRules.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.sourceEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  index("automation_run_member_time_idx").on(t.tenantId, t.membershipId, t.createdAt),
  check("automation_run_status_valid", sql`${t.status} in ('queued','complete','suppressed','failed')`),
  check("automation_run_attempts_valid", sql`${t.attempts} >= 0`),
]);

/**
 * One Wallet pass (Apple) or object (Google) issued for one card CREDENTIAL GENERATION. A display copy only: the
 * membership row and ledger stay authoritative. A staff reissue or a closure revokes every row of the card; a pass added
 * afterwards is a new row with a new Apple serial / Google object, so an old pass can never receive the new QR code.
 * credentialHash = sha256(scan code at issuance); a row whose hash no longer matches the card is treated as revoked.
 * Apple serial = id. status: pending | downloaded | registered | created | revocation_pending | revoked.
 */
export const walletPasses = pgTable("wallet_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  provider: varchar("provider", { length: 8 }).notNull(),
  providerObjectId: varchar("provider_object_id", { length: 240 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  credentialHash: varchar("credential_hash", { length: 64 }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokeReason: varchar("revoke_reason", { length: 16 }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("wallet_pass_active_member_provider_uq").on(t.membershipId, t.provider).where(sql`${t.revokedAt} is null`),
  unique("wallet_pass_provider_object_uq").on(t.provider, t.providerObjectId),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("wallet_pass_member_idx").on(t.tenantId, t.membershipId),
  check("wallet_pass_provider_valid", sql`${t.provider} in ('apple','google')`),
  check("wallet_pass_revoke_valid", sql`(${t.revokedAt} is null and ${t.revokeReason} is null) or (${t.revokedAt} is not null and ${t.revokeReason} is not null and ${t.revokeReason} in ('reissued','closed','superseded'))`),
]);

export const appleDevices = pgTable("apple_devices", {
  deviceLibraryIdentifier: varchar("device_library_identifier", { length: 200 }).primaryKey(),
  pushToken: varchar("push_token", { length: 300 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const referralSettings = pgTable("referral_settings", {
  programId: uuid("program_id").primaryKey(),
  tenantId: uuid("tenant_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  referrerBonus: integer("referrer_bonus").notNull().default(0),
  referredBonus: integer("referred_bonus").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  check("referral_settings_bonus_valid", sql`${t.referrerBonus} between 0 and 1000 and ${t.referredBonus} between 0 and 1000 and (not ${t.enabled} or ${t.referrerBonus} + ${t.referredBonus} > 0)`),
]);

export const referralCodes = pgTable("referral_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  membershipId: uuid("membership_id").notNull().unique(),
  code: varchar("code", { length: 40 }).notNull().unique(),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
]);

export const referrals = pgTable("referrals", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  referrerMembershipId: uuid("referrer_membership_id").notNull(),
  referredMembershipId: uuid("referred_membership_id").notNull().unique(),
  codeId: uuid("code_id").notNull().references(() => referralCodes.id),
  referrerBonus: integer("referrer_bonus").notNull(),
  referredBonus: integer("referred_bonus").notNull(),
  status: varchar("status", { length: 12 }).notNull().default("pending"),
  qualifyingEntryId: uuid("qualifying_entry_id"),
  referrerBonusEntryId: uuid("referrer_bonus_entry_id"),
  referredBonusEntryId: uuid("referred_bonus_entry_id"),
  reviewReason: varchar("review_reason", { length: 64 }),
  reviewNote: varchar("review_note", { length: 240 }),
  reviewedByUserId: text("reviewed_by_user_id"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  qualifiedAt: timestamp("qualified_at", { withTimezone: true }),
  reversedAt: timestamp("reversed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
  foreignKey({ columns: [t.tenantId, t.referrerMembershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.referredMembershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  foreignKey({ columns: [t.tenantId, t.qualifyingEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  foreignKey({ columns: [t.tenantId, t.referrerBonusEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  foreignKey({ columns: [t.tenantId, t.referredBonusEntryId], foreignColumns: [ledgerEntries.tenantId, ledgerEntries.id] }),
  index("referrals_program_status_idx").on(t.programId, t.status, t.createdAt),
  check("referral_members_differ", sql`${t.referrerMembershipId} <> ${t.referredMembershipId}`),
  check("referral_bonus_snapshot_valid", sql`${t.referrerBonus} between 0 and 1000 and ${t.referredBonus} between 0 and 1000 and ${t.referrerBonus} + ${t.referredBonus} > 0`),
  check("referral_status_valid", sql`${t.status} in ('pending','qualified','review','rejected','reversed')`),
]);

export const appleRegistrations = pgTable("apple_registrations", {
  deviceLibraryIdentifier: varchar("device_library_identifier", { length: 200 }).notNull().references(() => appleDevices.deviceLibraryIdentifier),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  passTypeIdentifier: varchar("pass_type_identifier", { length: 200 }).notNull(),
  serialNumber: varchar("serial_number", { length: 200 }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.deviceLibraryIdentifier, t.passTypeIdentifier, t.serialNumber] }),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  index("apple_registration_member_idx").on(t.membershipId),
]);

export const subscriptions = pgTable("subscriptions", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  status: varchar("status", { length: 24 }).notNull().default("manual_pending"),
  currency: varchar("currency", { length: 3 }).notNull(),
  priceMinor: integer("price_minor").notNull(),
  activeLocationCount: integer("active_location_count").notNull().default(1),
  provider: varchar("provider", { length: 24 }),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  graceUntil: timestamp("grace_until", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("subscription_status_valid", sql`${t.status} in ('manual_pending','pending_checkout','active_fixture','grace_fixture','suspended_fixture','cancelled')`),
  check("subscription_price_positive", sql`${t.priceMinor} > 0 and ${t.activeLocationCount} > 0`),
]);

export const billingLocationPlans = pgTable("billing_location_plans", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  planCode: varchar("plan_code", { length: 32 }).notNull().default("local_standard"),
  currency: varchar("currency", { length: 3 }).notNull(),
  priceMinor: integer("price_minor").notNull(),
  memberLimit: integer("member_limit").notNull().default(10000),
  createdAt: createdAt(),
}, (t) => [
  primaryKey({ columns: [t.tenantId, t.locationId] }),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("billing_plan_values_valid", sql`${t.priceMinor} > 0 and ${t.memberLimit} > 0 and ${t.planCode} = 'local_standard'`),
]);

export const billingHandoffs = pgTable("billing_handoffs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: varchar("provider", { length: 24 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("pending"),
  currency: varchar("currency", { length: 3 }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
  createdAt: createdAt(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [
  index("billing_handoff_tenant_idx").on(t.tenantId, t.createdAt),
  check("billing_handoff_values_valid", sql`${t.provider} = 'local_fixture' and ${t.status} in ('pending','complete') and ${t.amountMinor} > 0`),
]);

export const billingInvoices = pgTable("billing_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  handoffId: uuid("handoff_id").notNull().references(() => billingHandoffs.id),
  providerInvoiceId: varchar("provider_invoice_id", { length: 120 }).notNull().unique(),
  status: varchar("status", { length: 24 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(),
  amountMinor: integer("amount_minor").notNull(),
  taxMinor: integer("tax_minor"),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  index("billing_invoice_tenant_idx").on(t.tenantId, t.createdAt),
  check("billing_invoice_values_valid", sql`${t.status} = 'fixture_paid' and ${t.amountMinor} > 0 and ${t.taxMinor} is null`),
]);

export const billingWebhookEvents = pgTable("billing_webhook_events", {
  eventId: varchar("event_id", { length: 120 }).primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  eventType: varchar("event_type", { length: 32 }).notNull(),
  payloadHash: varchar("payload_hash", { length: 64 }).notNull(),
  processedAt: createdAt(),
});

export const demoRequests = pgTable("demo_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: varchar("name", { length: 120 }).notNull(),
  business: varchar("business", { length: 180 }).notNull(),
  city: varchar("city", { length: 120 }).notNull(),
  email: varchar("email", { length: 320 }).notNull(),
  createdAt: createdAt(),
});

export const rateLimits = pgTable("rate_limits", {
  keyHash: varchar("key_hash", { length: 64 }).primaryKey(),
  hits: integer("hits").notNull(),
  resetAt: timestamp("reset_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("rate_limits_reset_idx").on(t.resetAt),
  check("rate_limits_hits_positive", sql`${t.hits} > 0`),
]);
