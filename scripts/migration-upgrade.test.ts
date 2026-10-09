import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Migration rehearsal on throwaway databases on the isolated test server (never the shared test DB itself):
 *  - FRESH: every migration on an empty database;
 *  - UPGRADE: the schema as the current release has it (through 0017) filled with synthetic history, then 0018-0020.
 * The upgraded schema must equal the fresh one, and no historical value may change.
 */
if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Migration rehearsal requires the isolated looplocal_test server");

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "drizzle");
const adminUrl = new URL(process.env.DATABASE_URL); adminUrl.pathname = "/postgres";
const nameOf = (label: string) => `looplocal_mig_${label}_${randomUUID().slice(0, 8)}`;
const urlFor = (name: string) => { const url = new URL(adminUrl); url.pathname = `/${name}`; return url.toString(); };
const created: string[] = [];
const workDir = mkdtempSync(path.join(tmpdir(), "loynara-mig-"));
let admin: Pool;

async function scratchDatabase(label: string) {
  const name = nameOf(label);
  await admin.query(`CREATE DATABASE ${name}`);
  created.push(name);
  const pool = new Pool({ connectionString: urlFor(name), max: 2 });
  await pool.query(readFileSync(path.join(migrationsDir, "auth.sql"), "utf8"));
  return pool;
}
const run = (pool: Pool, folder: string) => migrate(drizzle(pool), { migrationsFolder: folder });

/** A migrations folder holding only the migrations up to and including `lastIdx`. */
function folderThrough(lastIdx: number) {
  const target = path.join(workDir, `through-${lastIdx}`);
  mkdirSync(path.join(target, "meta"), { recursive: true });
  const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string }> };
  journal.entries = journal.entries.filter(entry => entry.idx <= lastIdx);
  writeFileSync(path.join(target, "meta", "_journal.json"), JSON.stringify(journal));
  for (const entry of journal.entries) cpSync(path.join(migrationsDir, `${entry.tag}.sql`), path.join(target, `${entry.tag}.sql`));
  return target;
}

beforeAll(async () => { admin = new Pool({ connectionString: adminUrl.toString(), max: 2 }); });
afterAll(async () => {
  for (const name of created) await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
  rmSync(workDir, { recursive: true, force: true });
});

// Columns that exist before 0019, so rows can be compared byte for byte afterwards.
const HISTORICAL: Record<string, string> = {
  tenants: "id, name, slug, currency, locale, created_at",
  locations: "id, tenant_id, name, city, country, timezone, brand_color, created_at",
  programs: "id, tenant_id, location_id, slug, name, type, status, earning_mode, points_per_euro, rules_text, effective_at, created_at",
  program_rule_versions: "id, tenant_id, program_id, version, name, type, rules_text, earning_mode, points_per_currency_unit, created_at",
  rewards: "id, tenant_id, program_id, active, sort_order, created_at",
  reward_versions: "id, tenant_id, reward_id, version, title, cost, terms_text, created_at",
  memberships: "id, tenant_id, program_id, scan_code, card_token, balance, closed_at, created_at",
  ledger_entries: "id, tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reason, reversal_of_id, created_at",
  redemptions: "id, tenant_id, membership_id, ledger_entry_id, reward_version_id, reward_title, cost, created_at",
  referral_settings: "program_id, tenant_id, enabled, referrer_bonus, referred_bonus",
  referral_codes: "id, tenant_id, program_id, membership_id, code, created_at",
  referrals: "id, tenant_id, program_id, referrer_membership_id, referred_membership_id, code_id, referrer_bonus, referred_bonus, status, qualifying_entry_id, referrer_bonus_entry_id, referred_bonus_entry_id, created_at",
  staff_roles: "tenant_id, user_id, role, location_id, active, created_at",
  staff_invites: "id, tenant_id, location_id, invited_email, role, token_hash, invited_by_user_id, expires_at, accepted_at, revoked_at",
  staff_audit_events: "id, tenant_id, action, actor_user_id, subject_user_id, invite_id, location_id, role, created_at",
  consent_events: "id, tenant_id, membership_id, channel, purpose, granted, notice_version, source, created_at",
  membership_contacts: "tenant_id, membership_id, email, email_verified, created_at",
  card_security_events: "id, tenant_id, membership_id, action, created_at",
  secure_tags: "id, public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, last_counter, status, created_at",
  tap_requests: "id, tag_id, counter, tenant_id, location_id, program_id, membership_id, status, ledger_entry_id, expires_at, created_at",
};

async function fingerprint(pool: Pool) {
  const result: Record<string, { rows: number; hash: string }> = {};
  for (const [table, columns] of Object.entries(HISTORICAL)) {
    const { rows } = await pool.query<{ n: string; h: string | null }>(`SELECT count(*)::text AS n, md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY row_to_json(x)::text), '')) AS h FROM (SELECT ${columns} FROM ${table}) x`);
    result[table] = { rows: Number(rows[0].n), hash: rows[0].h! };
  }
  return result;
}

async function structure(pool: Pool) {
  const q = async (sql: string) => (await pool.query<{ v: string }>(sql)).rows.map(row => row.v);
  return {
    columns: await q(`SELECT table_name || '.' || column_name || ':' || data_type || ':' || is_nullable || ':' || coalesce(column_default, '') AS v FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1`),
    constraints: await q(`SELECT conrelid::regclass::text || '.' || conname || ':' || pg_get_constraintdef(oid) AS v FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1`),
    indexes: await q(`SELECT indexdef AS v FROM pg_indexes WHERE schemaname = 'public' ORDER BY 1`),
    triggers: await q(`SELECT tgrelid::regclass::text || '.' || tgname AS v FROM pg_trigger WHERE NOT tgisinternal ORDER BY 1`),
    functions: await q(`SELECT proname AS v FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY 1`),
  };
}

/** A believable pre-0018 merchant: two tenants, history incl. redemption, reversal, referral, closed card, staff. */
async function seedHistory(pool: Pool) {
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params);
  const id = () => randomUUID();
  const users = [id(), id(), id(), id()];
  for (const user of users) await q('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [user, "Synthetic", `${user}@example.test`]);
  const t = [id(), id()], l = [id(), id()], p = [id(), id()], rw = [id(), id()], rv = [id(), id()];
  for (const i of [0, 1]) {
    await q("INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)", [t[i], `Historic Café ${i}`, `historic-${i}-${t[i].slice(0, 6)}`]);
    await q("INSERT INTO locations (id, tenant_id, name, city, country, timezone) VALUES ($1, $2, 'Kassel', 'Kassel', 'DE', 'Europe/Berlin')", [l[i], t[i]]);
    await q("INSERT INTO programs (id, tenant_id, location_id, slug, name, type, rules_text) VALUES ($1, $2, $3, $4, 'Kaffeekarte', 'stamp', 'Ein Stempel pro Kaffee.')", [p[i], t[i], l[i], `prog-${i}-${p[i].slice(0, 6)}`]);
    await q("INSERT INTO program_rule_versions (tenant_id, program_id, version, name, type, rules_text, earning_mode, points_per_currency_unit) VALUES ($1, $2, 1, 'Kaffeekarte', 'stamp', 'Ein Stempel pro Kaffee.', 'manual', 1)", [t[i], p[i]]);
    await q("INSERT INTO rewards (id, tenant_id, program_id) VALUES ($1, $2, $3)", [rw[i], t[i], p[i]]);
    await q("INSERT INTO reward_versions (id, tenant_id, reward_id, version, title, cost) VALUES ($1, $2, $3, 1, 'Kaffee gratis', 3)", [rv[i], t[i], rw[i]]);
    await q("INSERT INTO staff_roles (tenant_id, user_id, role) VALUES ($1, $2, 'owner')", [t[i], users[i]]);
  }
  await q("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $3)", [t[0], users[2], l[0]]);
  await q("INSERT INTO staff_roles (tenant_id, user_id, role, location_id, active) VALUES ($1, $2, 'manager', $3, false)", [t[0], users[3], l[0]]); // a revoked member
  await q("INSERT INTO staff_invites (tenant_id, location_id, invited_email, role, token_hash, invited_by_user_id, expires_at) VALUES ($1, $2, 'later@example.test', 'cashier', $3, $4, now() + interval '1 day')", [t[0], l[0], "a".repeat(64), users[0]]);

  const card = async (tenant: number, balance: number, closed = false) => {
    const m = id();
    await q("INSERT INTO memberships (id, tenant_id, program_id, scan_code, card_token, balance, closed_at) VALUES ($1, $2, $3, $4, $5, $6, $7)", [m, t[tenant], p[tenant], closed ? `retired_sc_${m}` : `sc_${m}`, closed ? `retired_card_${m}` : `card_${m}`, balance, closed ? new Date() : null]);
    return m;
  };
  const entry = async (tenant: number, membership: string, delta: number, kind: string, extra: { source?: string; reversalOf?: string; reason?: string } = {}) => {
    const e = id();
    await q("INSERT INTO ledger_entries (id, tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reason, reversal_of_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [e, t[tenant], l[tenant], membership, delta, kind, extra.source ?? "staff_online", users[tenant], id(), id(), extra.reason ?? null, extra.reversalOf ?? null]);
    return e;
  };
  const a = await card(0, 2), b = await card(0, 3), closed = await card(0, 0, true), other = await card(1, 1);
  await entry(0, a, 2, "award");
  const wrong = await entry(0, b, 5, "award");
  await entry(0, b, -5, "reversal", { source: "staff_correction", reversalOf: wrong, reason: "Doppelt gebucht" });
  await entry(0, b, 3, "award");
  await entry(0, closed, 3, "award");
  const spent = await entry(0, closed, -3, "redeem"); // history of a card that was closed afterwards
  await q("INSERT INTO redemptions (tenant_id, membership_id, ledger_entry_id, reward_version_id, reward_title, cost) VALUES ($1, $2, $3, $4, 'Kaffee gratis', 3)", [t[0], closed, spent, rv[0]]);
  await entry(1, other, 1, "award");
  await q("INSERT INTO referral_settings (program_id, tenant_id, enabled, referrer_bonus, referred_bonus) VALUES ($1, $2, true, 2, 1)", [p[0], t[0]]);
  const code = id();
  await q("INSERT INTO referral_codes (id, tenant_id, program_id, membership_id, code) VALUES ($1, $2, $3, $4, $5)", [code, t[0], p[0], a, `ref_${"x".repeat(24)}`]);
  await q("INSERT INTO referrals (tenant_id, program_id, referrer_membership_id, referred_membership_id, code_id, referrer_bonus, referred_bonus, status) VALUES ($1, $2, $3, $4, $5, 2, 1, 'pending')", [t[0], p[0], a, b, code]);
  await q("INSERT INTO consent_events (tenant_id, membership_id, channel, purpose, granted, notice_version, source) VALUES ($1, $2, 'email', 'marketing', true, '2026-09', 'enrollment')", [t[0], a]);
  await q("INSERT INTO membership_contacts (tenant_id, membership_id, email, email_verified) VALUES ($1, $2, 'kunde@example.test', true)", [t[0], a]);
  await q("INSERT INTO card_security_events (tenant_id, membership_id, action) VALUES ($1, $2, 'card_credential_rotated')", [t[0], a]);
  await q("INSERT INTO staff_audit_events (tenant_id, action, actor_user_id, location_id, role) VALUES ($1, 'invite_created', $2, $3, 'cashier')", [t[0], users[0], l[0]]);
  // NFC history written by the NFC-capable release: a live tag, a revoked tag and a tap that was awarded.
  const liveTag = id();
  await q("INSERT INTO secure_tags (id, public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, last_counter, status) VALUES ($1, $2, $3, $4, $5, '04A1B2C3D4E5F6', 'synthetic-key', 1, 7, 'active')", [liveTag, `ref-live-${liveTag.slice(0, 8)}`, t[0], l[0], p[0]]);
  await q("INSERT INTO secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status, revoked_at) VALUES ($1, $2, $3, $4, '04FFEEDDCCBBAA', 'synthetic-key', 1, 'revoked', now())", [`ref-old-${liveTag.slice(0, 8)}`, t[0], l[0], p[0]]);
  await q("INSERT INTO tap_requests (tag_id, counter, tenant_id, location_id, program_id, membership_id, status, expires_at) VALUES ($1, 7, $2, $3, $4, $5, 'awarded', now() + interval '5 minutes')", [liveTag, t[0], l[0], p[0], a]);
  // Volume: one busy tenant, to exercise the backfill and its uniqueness.
  await q("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token, balance) SELECT $1, $2, 'sc_bulk' || g || md5(random()::text), 'card_bulk' || g || md5(random()::text), 0 FROM generate_series(1, 400) g", [t[1], p[1]]);
  return { tenants: t, cards: { a, b, closed, other } };
}

describe("migration journal", () => {
  it("is contiguous from 0000, timestamps strictly increase, and 0018-0021 are the newest", () => {
    const journal = JSON.parse(readFileSync(path.join(migrationsDir, "meta", "_journal.json"), "utf8")) as { entries: Array<{ idx: number; tag: string; when: number }> };
    journal.entries.forEach((entry, index) => { expect(entry.idx).toBe(index); expect(entry.tag.startsWith(String(index).padStart(4, "0"))).toBe(true); });
    for (let i = 1; i < journal.entries.length; i++) expect(journal.entries[i].when, journal.entries[i].tag).toBeGreaterThan(journal.entries[i - 1].when);
    expect(journal.entries.at(-4)?.tag).toBe("0018_nfc_tag_lifecycle");
    expect(journal.entries.at(-3)?.tag).toBe("0019_card_locators");
    expect(journal.entries.at(-2)?.tag).toBe("0020_wallet_pass_lifecycle");
    expect(journal.entries.at(-1)?.tag).toBe("0021_staff_push_subscriptions");
    const sqlFiles = readdirSync(migrationsDir).filter(file => /^\d{4}_.*\.sql$/.test(file)).sort();
    expect(sqlFiles).toEqual(journal.entries.map(entry => `${entry.tag}.sql`));
  });
});

describe("fresh install and upgrade from the 0017 release schema", () => {
  it("upgrades synthetic history without losing or changing a value, and ends with the same schema as a fresh install", async () => {
    const upgrade = await scratchDatabase("upgrade");
    const fresh = await scratchDatabase("fresh");
    try {
      await run(upgrade, folderThrough(17));
      // Really the release state: the old tag-UID uniqueness is still in place and the 0018 index is not.
      expect((await upgrade.query("SELECT 1 FROM pg_constraint WHERE conname = 'secure_tags_uid_unique'")).rowCount).toBe(1);
      expect((await upgrade.query("SELECT 1 FROM pg_indexes WHERE indexname = 'secure_tag_uid_live_uq'")).rowCount).toBe(0);
      expect((await upgrade.query("SELECT 1 FROM pg_attribute WHERE attrelid = 'memberships'::regclass AND attname = 'card_locator'")).rowCount).toBe(0);
      const seeded = await seedHistory(upgrade);
      const before = await fingerprint(upgrade);
      const balancesBefore = (await upgrade.query("SELECT id, balance FROM memberships ORDER BY id")).rows;
      expect(before.memberships.rows).toBe(404);
      expect(before.ledger_entries.rows).toBe(7);

      await run(upgrade, migrationsDir); // 0018 + 0019 + 0020 + 0021
      const after = await fingerprint(upgrade);
      expect(after).toEqual(before); // no lost rows, no changed values, ledger untouched
      expect((await upgrade.query("SELECT id, balance FROM memberships ORDER BY id")).rows).toEqual(balancesBefore);
      // Every balance with history still equals the sum of its ledger.
      const drift = await upgrade.query("SELECT m.id FROM memberships m JOIN ledger_entries e ON e.membership_id = m.id GROUP BY m.id, m.balance HAVING m.balance <> sum(e.delta)");
      expect(drift.rows).toHaveLength(0);

      // 0018: a revoked chip can be registered again (its UID may repeat), a live one still cannot; 'cancelled' taps are now valid.
      expect((await upgrade.query("SELECT 1 FROM pg_constraint WHERE conname = 'secure_tags_uid_unique'")).rowCount).toBe(0);
      const tagInsert = (uid: string, ref: string) => upgrade.query("INSERT INTO secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status) SELECT $2, tenant_id, location_id, program_id, $1, 'synthetic-key', 1, 'provisioned' FROM secure_tags LIMIT 1", [uid, ref]);
      await tagInsert("04FFEEDDCCBBAA", "ref-again-0001");
      await expect(tagInsert("04A1B2C3D4E5F6", "ref-dup-0001")).rejects.toThrow(/secure_tag_uid_live_uq/);
      await upgrade.query("UPDATE tap_requests SET status = 'cancelled'");

      // Every card, closed ones included, has a valid locator, unique within its tenant.
      const locators = await upgrade.query<{ tenant_id: string; card_locator: string }>("SELECT tenant_id, card_locator FROM memberships");
      expect(locators.rows).toHaveLength(404);
      expect(locators.rows.every(row => /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/.test(row.card_locator))).toBe(true);
      expect(new Set(locators.rows.map(row => `${row.tenant_id}:${row.card_locator}`)).size).toBe(404);
      expect((await upgrade.query("SELECT card_locator FROM memberships WHERE id = $1", [seeded.cards.closed])).rows[0].card_locator).toMatch(/^[A-Z2-9]{6}$/);

      // Protections survive, and the new ones are live.
      await expect(upgrade.query("UPDATE ledger_entries SET delta = 99")).rejects.toThrow(/append-only/);
      await expect(upgrade.query("DELETE FROM ledger_entries")).rejects.toThrow(/append-only/);
      await expect(upgrade.query("UPDATE program_rule_versions SET name = 'x'")).rejects.toThrow();
      await expect(upgrade.query("UPDATE staff_audit_events SET role = 'cashier'")).rejects.toThrow();
      await expect(upgrade.query("UPDATE memberships SET card_locator = 'ZZZZZZ' WHERE id = $1", [seeded.cards.a])).rejects.toThrow(/immutable/);
      await expect(upgrade.query("UPDATE card_security_events SET action = 'x'")).rejects.toThrow(/append-only/);
      // Old application code (no locator, no new columns) can still enrol a card on the migrated schema.
      const legacyInsert = await upgrade.query("INSERT INTO memberships (tenant_id, program_id, scan_code, card_token) SELECT tenant_id, program_id, 'sc_legacy' || md5(random()::text), 'card_legacy' || md5(random()::text) FROM memberships LIMIT 1 RETURNING card_locator");
      expect(legacyInsert.rows[0].card_locator).toMatch(/^[A-Z2-9]{6}$/);

      await run(fresh, migrationsDir);
      expect(await structure(upgrade)).toEqual(await structure(fresh));
      // Running the migrator again changes nothing.
      const applied = (await upgrade.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n;
      await run(upgrade, migrationsDir);
      expect((await upgrade.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(applied);
      expect(applied).toBe(22);
    } finally { await upgrade.end(); await fresh.end(); }
  }, 180_000);

  it("leaves a fresh database empty of data and with the expected locator machinery", async () => {
    const fresh = await scratchDatabase("fresh2");
    try {
      await run(fresh, migrationsDir);
      expect((await fresh.query("SELECT count(*)::int AS n FROM memberships")).rows[0].n).toBe(0);
      const triggers = (await fresh.query<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE NOT tgisinternal")).rows.map(row => row.tgname);
      for (const name of ["ledger_append_only", "program_rule_versions_append_only", "purchase_awards_append_only", "staff_audit_append_only", "memberships_assign_card_locator", "memberships_card_locator_immutable", "card_security_events_append_only"]) expect(triggers, name).toContain(name);
      const indexes = (await fresh.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename IN ('memberships', 'card_security_events')")).rows.map(row => row.indexname);
      expect(indexes).toEqual(expect.arrayContaining(["memberships_card_locator_uq", "card_security_idempotency_uq"]));
    } finally { await fresh.end(); }
  }, 120_000);

  it("rolls 0019 back to the exact 0018 schema with all data intact, and re-applies cleanly", async () => {
    const pool = await scratchDatabase("rollback");
    const reference = await scratchDatabase("ref18");
    try {
      await run(reference, folderThrough(18));
      const schema18 = await structure(reference);
      await run(pool, folderThrough(18));
      await seedHistory(pool);
      const before = await fingerprint(pool);

      await run(pool, folderThrough(19)); // 0019
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
      await pool.query(readFileSync(path.join(root, "docs", "rollback", "0019-card-locators-down.sql"), "utf8"));
      expect(await structure(pool)).toEqual(schema18);
      expect(await fingerprint(pool)).toEqual(before);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(19);

      // Forward again: new locators are drawn, history is unchanged.
      await run(pool, folderThrough(19));
      expect(await fingerprint(pool)).toEqual(before);
      expect((await pool.query("SELECT count(DISTINCT (tenant_id, card_locator))::int AS n FROM memberships")).rows[0].n).toBe(404);
    } finally { await pool.end(); await reference.end(); }
  }, 180_000);

  it("upgrades populated exact production 0019 with zero Wallet state from 20 to 21 without loyalty or K-number drift", async () => {
    const target = await scratchDatabase("production19");
    const fresh = await scratchDatabase("combined_fresh");
    try {
      await run(target, folderThrough(19));
      await seedHistory(target);
      const before = await fingerprint(target);
      const members = (await target.query("SELECT to_jsonb(m) AS v FROM memberships m ORDER BY id")).rows;
      const journal = (await target.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
      expect(journal).toHaveLength(20);
      for (const table of ["wallet_passes", "apple_devices", "apple_registrations"]) {
        expect((await target.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
      }
      await run(target, migrationsDir);
      expect(await fingerprint(target)).toEqual(before);
      expect((await target.query("SELECT to_jsonb(m) AS v FROM memberships m ORDER BY id")).rows).toEqual(members);
      const after = (await target.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
      expect(after).toHaveLength(22);
      expect(after.slice(0, 20)).toEqual(journal);
      expect((await target.query("SELECT m.id FROM memberships m JOIN ledger_entries e ON e.membership_id=m.id GROUP BY m.id,m.balance HAVING m.balance <> sum(e.delta)")).rows).toHaveLength(0);
      expect((await target.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(0);
      expect((await target.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(0);
      await run(fresh, migrationsDir);
      expect(await structure(target)).toEqual(await structure(fresh));
      await expect(target.query("UPDATE ledger_entries SET delta=99")).rejects.toThrow(/append-only/);
      await expect(target.query("UPDATE memberships SET card_locator='ZZZZZZ'")).rejects.toThrow(/immutable/);
      await run(target, migrationsDir);
      expect((await target.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(22);
    } finally { await target.end(); await fresh.end(); }
  }, 180_000);

  it("rehearses empty 0019 to 0020 and proves DDL waits for old readers without a partial journal commit", async () => {
    const target = await scratchDatabase("empty19");
    try {
      await run(target, folderThrough(19));
      expect((await target.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
      const schema19 = await structure(target);
      const blocker = await target.connect();
      try {
        await blocker.query("BEGIN");
        await blocker.query("SELECT 1 FROM wallet_passes");
        await target.query("SET lock_timeout = '100ms'");
        await expect(run(target, migrationsDir)).rejects.toThrow();
      } finally { await blocker.query("ROLLBACK"); blocker.release(); }
      expect(await structure(target)).toEqual(schema19);
      expect((await target.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
      await target.query("SET lock_timeout = '0'");
      await run(target, migrationsDir);
      expect((await target.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(22);
      // Old web still inserts unmarked Wallet jobs during the staged providers-off overlap. New unique coalescing must
      // not reject those old inserts and thereby roll back an award.
      const seeded = await seedHistory(target);
      for (let i = 0; i < 2; i++) await target.query("INSERT INTO outbox_jobs (tenant_id, kind, payload) VALUES ($1, 'wallet.refresh', jsonb_build_object('membershipId', $2::text))", [seeded.tenants[0], seeded.cards.a]);
      expect((await target.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind='wallet.refresh'")).rows[0].n).toBe(2);
    } finally { await target.end(); }
  }, 180_000);

  it("refuses legacy Apple state atomically instead of destroying device registrations", async () => {
    const pool = await scratchDatabase("apple_guard");
    try {
      await run(pool, folderThrough(19));
      const seeded = await seedHistory(pool);
      await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2::uuid, 'apple', $2::text, 'registered')", [seeded.tenants[0], seeded.cards.a]);
      await pool.query("INSERT INTO apple_devices (device_library_identifier, push_token) VALUES ('legacy-device', $1)", ["a".repeat(64)]);
      await pool.query("INSERT INTO apple_registrations (device_library_identifier, tenant_id, membership_id, pass_type_identifier, serial_number) VALUES ('legacy-device', $1, $2::uuid, 'pass.local.loop', $2::text)", [seeded.tenants[0], seeded.cards.a]);
      const before = await structure(pool);
      const history = await fingerprint(pool);
      await expect(run(pool, migrationsDir)).rejects.toThrow();
      expect(await structure(pool)).toEqual(before);
      expect(await fingerprint(pool)).toEqual(history);
      expect((await pool.query("SELECT count(*)::int AS n FROM apple_registrations")).rows[0].n).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
    } finally { await pool.end(); }
  }, 180_000);

  it("upgrades legacy Google passes from exact 0019, queues revocation, preserves history and rolls back", async () => {
    const pool = await scratchDatabase("wallet20");
    const reference = await scratchDatabase("ref19");
    try {
      await run(reference, folderThrough(19));
      const schema19 = await structure(reference);
      await run(pool, folderThrough(19));
      const seeded = await seedHistory(pool);
      await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'google', $3, 'created'), ($1, $4, 'google', $5, 'revocation_pending'), ($1, $6, 'google', $7, 'pending')",
        [seeded.tenants[0], seeded.cards.a, `123.member_${seeded.cards.a}`, seeded.cards.closed, `123.member_${seeded.cards.closed}`, seeded.cards.b, `123.member_${seeded.cards.b}`]);
      const before = await fingerprint(pool);
      const membersBefore = (await pool.query("SELECT row_to_json(m) AS v FROM memberships m ORDER BY id")).rows;
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
      await run(pool, migrationsDir);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(22);
      expect(await fingerprint(pool)).toEqual(before);
      expect((await pool.query("SELECT row_to_json(m) AS v FROM memberships m ORDER BY id")).rows).toEqual(membersBefore);
      const rows = (await pool.query("SELECT membership_id, provider, status, revoke_reason, revoked_at IS NOT NULL AS revoked FROM wallet_passes ORDER BY membership_id, provider")).rows;
      expect(rows).toEqual(expect.arrayContaining([
        { membership_id: seeded.cards.a, provider: "google", status: "revocation_pending", revoke_reason: "superseded", revoked: true },
        { membership_id: seeded.cards.closed, provider: "google", status: "revocation_pending", revoke_reason: "closed", revoked: true },
      ]));
      expect((await pool.query("SELECT count(DISTINCT payload->>'membershipId')::int AS n FROM outbox_jobs WHERE kind='wallet.refresh' AND status='pending'")).rows[0].n).toBe(3);
      const insertActive = () => pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status, credential_hash) VALUES ($1, $2, 'google', $3, 'created', $4)", [seeded.tenants[0], seeded.cards.a, `123.loynara_${randomUUID()}`, "f".repeat(64)]);
      await insertActive();
      await expect(insertActive()).rejects.toThrow(/wallet_pass_active_member_provider_uq/);
      await expect(pool.query("UPDATE wallet_passes SET revoke_reason = 'stolen', revoked_at = now() WHERE revoked_at IS NULL")).rejects.toThrow(/wallet_pass_revoke_valid/);
      await expect(pool.query("UPDATE wallet_passes SET revoke_reason = NULL WHERE revoked_at IS NOT NULL")).rejects.toThrow(/wallet_pass_revoke_valid/);
      // 0021 sits on top of 0020 now: its paired rollback comes first, then 0020's.
      await pool.query("BEGIN");
      await pool.query(readFileSync(path.join(root, "docs", "rollback", "0021-staff-push-subscriptions-down.sql"), "utf8"));
      await pool.query("COMMIT");
      await pool.query("BEGIN");
      await pool.query(readFileSync(path.join(root, "docs", "rollback", "0020-wallet-pass-lifecycle-down.sql"), "utf8"));
      await pool.query("COMMIT");
      expect(await structure(pool)).toEqual(schema19);
      expect(await fingerprint(pool)).toEqual(before);
      expect((await pool.query("SELECT row_to_json(m) AS v FROM memberships m ORDER BY id")).rows).toEqual(membersBefore);
      expect((await pool.query("SELECT count(*)::int AS n FROM wallet_passes")).rows[0].n).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(20);
      await run(pool, migrationsDir);
      expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(22);
    } finally { await pool.end(); await reference.end(); }
  }, 180_000);

  for (const invalidJournal of ["newer migration", "corrupt final timestamp", "missing entry"] as const) {
    it(`refuses the manual 0020 downgrade before any changes when the journal has a ${invalidJournal}`, async () => {
      const target = await scratchDatabase("rollback_guard");
      try {
        await run(target, migrationsDir);
        const seeded = await seedHistory(target);
        const passId = randomUUID();
        await target.query("INSERT INTO wallet_passes (id,tenant_id,membership_id,provider,provider_object_id,status,revoked_at,revoke_reason,synced_at) VALUES ($1::uuid,$2,$3,'apple',$1::text,'revoked',now(),'closed',now())", [passId, seeded.tenants[0], seeded.cards.a]);
        await target.query("INSERT INTO apple_devices (device_library_identifier,push_token) VALUES ('rollback-guard-device',repeat('a',64))");
        await target.query("INSERT INTO apple_registrations (device_library_identifier,tenant_id,membership_id,pass_type_identifier,serial_number) VALUES ('rollback-guard-device',$1,$2,'pass.local.loop',$3)", [seeded.tenants[0], seeded.cards.a, passId]);
        if (invalidJournal === "newer migration") await target.query("INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ('synthetic-newer-migration',1791296519074)");
        else if (invalidJournal === "corrupt final timestamp") await target.query("UPDATE drizzle.__drizzle_migrations SET created_at = 1791296519074 WHERE id = (SELECT max(id) FROM drizzle.__drizzle_migrations)");
        else await target.query("DELETE FROM drizzle.__drizzle_migrations WHERE id = (SELECT min(id) FROM drizzle.__drizzle_migrations)");
        const schemaBefore = await structure(target);
        const historyBefore = await fingerprint(target);
        const walletBefore = (await target.query("SELECT row_to_json(p) AS v FROM wallet_passes p ORDER BY id")).rows;
        const registrationsBefore = (await target.query("SELECT row_to_json(r) AS v FROM apple_registrations r")).rows;
        const devicesBefore = (await target.query("SELECT row_to_json(d) AS v FROM apple_devices d")).rows;
        const journalBefore = (await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows;
        const client = await target.connect();
        try {
          await client.query("BEGIN");
          await expect(client.query(readFileSync(path.join(root, "docs", "rollback", "0020-wallet-pass-lifecycle-down.sql"), "utf8")).then(() => undefined)).rejects.toThrow(/0020 rollback refused/);
        } finally { await client.query("ROLLBACK"); client.release(); }
        expect(await structure(target)).toEqual(schemaBefore);
        expect(await fingerprint(target)).toEqual(historyBefore);
        expect((await target.query("SELECT row_to_json(p) AS v FROM wallet_passes p ORDER BY id")).rows).toEqual(walletBefore);
        expect((await target.query("SELECT row_to_json(r) AS v FROM apple_registrations r")).rows).toEqual(registrationsBefore);
        expect((await target.query("SELECT row_to_json(d) AS v FROM apple_devices d")).rows).toEqual(devicesBefore);
        expect((await target.query("SELECT * FROM drizzle.__drizzle_migrations ORDER BY id")).rows).toEqual(journalBefore);
      } finally { await target.end(); }
    }, 180_000);
  }
});

describe("0021 staff push subscriptions", () => {
  it("adds only the subscription table to a populated 0020 database, and a subscription disappears with its session or user", async () => {
    const target = await scratchDatabase("production20");
    const fresh = await scratchDatabase("push_fresh");
    try {
      await run(target, folderThrough(20));
      await seedHistory(target);
      const before = await fingerprint(target);
      await run(target, migrationsDir);
      expect(await fingerprint(target)).toEqual(before);
      expect((await target.query("SELECT count(*)::int AS n FROM staff_push_subscriptions")).rows[0].n).toBe(0);
      await run(fresh, migrationsDir);
      expect(await structure(target)).toEqual(await structure(fresh));

      const [location] = (await target.query("SELECT tenant_id, id FROM locations LIMIT 1")).rows as Array<{ tenant_id: string; id: string }>;
      await target.query(`INSERT INTO "user" (id, name, email, "emailVerified") VALUES ('push-user', 'Synthetic', 'push@example.test', false)`);
      for (const session of ["push-session-a", "push-session-b"]) await target.query(`INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1, now() + interval '1 day', $1, now(), 'push-user')`, [session]);
      const subscribe = (endpoint: string, session: string) => target.query("INSERT INTO staff_push_subscriptions (tenant_id, location_id, user_id, session_id, endpoint, p256dh, auth) VALUES ($1, $2, 'push-user', $3, $4, 'k', 'a')", [location.tenant_id, location.id, session, endpoint]);
      await subscribe("https://fcm.googleapis.com/fcm/send/a", "push-session-a");
      await subscribe("https://fcm.googleapis.com/fcm/send/b", "push-session-b");
      await expect(subscribe("http://insecure.example.test/x", "push-session-a")).rejects.toThrow(/staff_push_endpoint_https/);
      await expect(subscribe("https://fcm.googleapis.com/fcm/send/a", "push-session-b")).rejects.toThrow(/endpoint_unique/);
      await target.query(`DELETE FROM "session" WHERE id = 'push-session-a'`);
      expect((await target.query("SELECT endpoint FROM staff_push_subscriptions")).rows).toEqual([{ endpoint: "https://fcm.googleapis.com/fcm/send/b" }]);
      await target.query(`DELETE FROM "user" WHERE id = 'push-user'`);
      expect((await target.query("SELECT count(*)::int AS n FROM staff_push_subscriptions")).rows[0].n).toBe(0);

      // The paired rollback returns exactly the 0020 schema and refuses to run twice.
      const schema20 = await scratchDatabase("push_schema20");
      try { await run(schema20, folderThrough(20)); await target.query("BEGIN");
        await target.query(readFileSync(path.join(root, "docs", "rollback", "0021-staff-push-subscriptions-down.sql"), "utf8"));
        await target.query("COMMIT");
        expect(await structure(target)).toEqual(await structure(schema20));
        expect(await fingerprint(target)).toEqual(before);
        await expect(target.query(readFileSync(path.join(root, "docs", "rollback", "0021-staff-push-subscriptions-down.sql"), "utf8"))).rejects.toThrow(/0021 rollback refused/);
      } finally { await schema20.end(); }
    } finally { await target.end(); await fresh.end(); }
  }, 180_000);
});
