import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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

export const programs = pgTable("programs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  locationId: uuid("location_id").notNull(),
  slug: varchar("slug", { length: 120 }).notNull().unique(),
  name: varchar("name", { length: 180 }).notNull(),
  type: varchar("type", { length: 8 }).notNull(),
  status: varchar("status", { length: 10 }).notNull().default("active"),
  pointsPerEuro: integer("points_per_euro").notNull().default(1),
  rulesText: text("rules_text").notNull(),
  effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [
  unique("programs_tenant_id_id_uq").on(t.tenantId, t.id),
  uniqueIndex("programs_one_active_per_location_uq").on(t.locationId).where(sql`${t.status} = 'active'`),
  foreignKey({ columns: [t.tenantId, t.locationId], foreignColumns: [locations.tenantId, locations.id] }),
  check("program_type_valid", sql`${t.type} in ('stamp','points')`),
  check("program_status_valid", sql`${t.status} in ('active','archived')`),
  check("program_points_positive", sql`${t.pointsPerEuro} > 0`),
]);

export const rewards = pgTable("rewards", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  programId: uuid("program_id").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}, (t) => [
  unique("rewards_tenant_id_id_uq").on(t.tenantId, t.id),
  foreignKey({ columns: [t.tenantId, t.programId], foreignColumns: [programs.tenantId, programs.id] }),
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
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  unique("memberships_tenant_id_id_uq").on(t.tenantId, t.id),
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
  actorUserId: text("actor_user_id").notNull(),
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
  check("ledger_source_valid", sql`${t.source} in ('staff_online','staff_correction','synthetic_seed','legacy_unclassified')`),
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
  foreignKey({ columns: [t.tenantId], foreignColumns: [tenants.id] }),
]);

export const walletPasses = pgTable("wallet_passes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  membershipId: uuid("membership_id").notNull(),
  provider: varchar("provider", { length: 8 }).notNull(),
  providerObjectId: varchar("provider_object_id", { length: 240 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("pending"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("wallet_pass_member_provider_uq").on(t.membershipId, t.provider),
  unique("wallet_pass_provider_object_uq").on(t.provider, t.providerObjectId),
  foreignKey({ columns: [t.tenantId, t.membershipId], foreignColumns: [memberships.tenantId, memberships.id] }),
  check("wallet_pass_provider_valid", sql`${t.provider} in ('apple','google')`),
]);

export const appleDevices = pgTable("apple_devices", {
  deviceLibraryIdentifier: varchar("device_library_identifier", { length: 200 }).primaryKey(),
  pushToken: varchar("push_token", { length: 300 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
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
