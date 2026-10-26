import { execFileSync } from "node:child_process";
import { afterAll, expect, it } from "vitest";
import { pool } from "@/db";
import { assertDisposableDatabase, assertLocalTestDatabaseUrl } from "@/lib/disposable-test-database";

assertLocalTestDatabaseUrl();
afterAll(() => pool.end());

const seed = () => execFileSync("npx", ["tsx", "scripts/seed-booking-demo.ts"], { env: process.env, encoding: "utf8" });
const counts = async () => Object.fromEntries((await pool.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM booking_appointments GROUP BY status")).rows.map(r => [r.status, r.n]));

it("seeds one convincing salon week, idempotently, without overlaps", async () => {
  await assertDisposableDatabase(pool);
  await pool.query('TRUNCATE tenants,"user" CASCADE');
  expect(seed()).toMatch(/\/card\/card_\w+/);

  const one = async (sql: string) => (await pool.query<{ n: number }>(sql)).rows[0].n;
  expect(await one("SELECT count(*)::int AS n FROM booking_staff WHERE archived_at IS NULL")).toBe(2);
  expect(await one("SELECT count(*)::int AS n FROM booking_services WHERE archived_at IS NULL")).toBeGreaterThanOrEqual(4);
  expect(await one("SELECT count(*)::int AS n FROM booking_settings WHERE enabled")).toBe(1);
  expect(await one("SELECT count(*)::int AS n FROM booking_blocked_customers")).toBe(1);
  expect(await one("SELECT count(*)::int AS n FROM booking_appointments WHERE status = 'done' AND done_ledger_entry_id IS NULL")).toBe(0);
  expect(await one("SELECT count(*)::int AS n FROM booking_appointments WHERE status = 'cancelled_by_customer' AND late_cancel")).toBe(1);
  const before = await counts();
  expect(before).toMatchObject({ no_show: 2, cancelled_by_customer: 1, cancelled_by_shop: 1, requested: 2 });
  expect(before.done).toBeGreaterThanOrEqual(25);
  expect(before.confirmed).toBeGreaterThanOrEqual(12);

  expect(seed()).toMatch(/already seeded/);
  expect(await counts()).toEqual(before);

  expect(await one(`SELECT count(*)::int AS n FROM booking_appointments a JOIN booking_appointments b ON a.staff_id = b.staff_id AND a.id < b.id AND a.during && b.during
    WHERE a.status IN ('requested','confirmed') AND b.status IN ('requested','confirmed')`)).toBe(0);
}, 120_000);
