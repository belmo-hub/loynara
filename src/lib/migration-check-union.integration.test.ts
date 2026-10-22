import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { nfcFixture } from "./nfc-test-db";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "./disposable-test-database";

// X-1: several migrations drop and re-add the same CHECK with the list they knew. After the whole wave is migrated, each
// list must hold every value any of them added, or a later migration silently stops one feature's rows from inserting.
assertLocalTestDatabaseUrl();
beforeEach(async () => { await assertDisposableDatabase(pool); await pool.query('TRUNCATE tenants, "user" CASCADE'); });
afterAll(async () => { await pool.end(); });

const LEDGER_SOURCES = ["staff_online", "staff_offline", "staff_correction", "synthetic_seed", "legacy_unclassified", "referral_bonus", "nfc_tap", "welcome_bonus",
  "happy_hour", // #85
  "winback_bonus", "birthday_bonus", // S1
  "expiry", "challenge_bonus"]; // S4
const LEDGER_KINDS = ["award", "redeem", "reversal", "expiry"];
const MESSAGE_KINDS = ["owner", "winback", "almost", "birthday", "expiry"]; // #88, S1 (almost, birthday), S4 (expiry)
const definition = async (name: string) => (await pool.query<{ def: string }>("SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1", [name])).rows[0]?.def ?? "";

describe("shared CHECK lists after the wave's migrations", () => {
  it("name every value from every migration", async () => {
    const source = await definition("ledger_source_valid"), kind = await definition("ledger_kind_valid"), actor = await definition("ledger_nfc_actor_valid"), message = await definition("wallet_message_kind_valid");
    for (const value of LEDGER_SOURCES) expect(source, value).toContain(`'${value}'`);
    for (const value of LEDGER_KINDS) expect(kind, value).toContain(`'${value}'`);
    expect(actor).toContain("'nfc_tap'"); expect(actor).toContain("'expiry'"); // the two sources that book without a person
    for (const value of MESSAGE_KINDS) expect(message, value).toContain(`'${value}'`);
  });

  it("accept an INSERT of each value", async () => {
    const f = await nfcFixture();
    for (const source of LEDGER_SOURCES) {
      const expiry = source === "expiry", personless = source === "nfc_tap" || expiry;
      await pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key)
        VALUES ($1, $2, $3, $4, $5, $6, $7, gen_random_uuid(), $8)`, [f.tenant.id, f.location.id, f.member.id, expiry ? -1 : 1, expiry ? "expiry" : "award", source, personless ? null : f.userId, `union-${source}-${randomUUID()}`]);
    }
    const [{ n }] = (await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM ledger_entries WHERE idempotency_key LIKE 'union-%'")).rows;
    expect(n).toBe(LEDGER_SOURCES.length);
    // A redeem and a reversal keep working next to the new kind.
    await pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key) VALUES ($1, $2, $3, -1, 'redeem', 'staff_online', $4, gen_random_uuid(), $5)`, [f.tenant.id, f.location.id, f.member.id, f.userId, `union-redeem-${randomUUID()}`]);
    for (const kind of MESSAGE_KINDS) {
      await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text) VALUES ($1, $2, $3, 'Synthetic text')", [f.tenant.id, f.program.id, kind]);
    }
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_messages")).rows[0].n).toBe(MESSAGE_KINDS.length);
    await expect(pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key) VALUES ($1, $2, $3, 1, 'award', 'not_a_source', $4, gen_random_uuid(), $5)", [f.tenant.id, f.location.id, f.member.id, f.userId, `union-bad-${randomUUID()}`])).rejects.toThrow(/ledger_source_valid/);
  });
});
