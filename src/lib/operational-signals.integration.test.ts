import { assertTestDatabaseUrl, assertOwnedTestDatabase } from "../../scripts/test-database-guard";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { writeOperationalCounts } from "./operational-signals";
assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query("TRUNCATE operational_counters"); });
afterAll(() => pool.end());
it("aggregates concurrent signals without request or customer dimensions", async () => {
  await Promise.all(Array.from({ length: 20 }, () => writeOperationalCounts({ rate_limit: 5, request_error: 1 }, pool)));
  expect((await pool.query('SELECT event,sum(count)::int AS count FROM operational_counters GROUP BY event ORDER BY event')).rows).toEqual([{ event: "rate_limit", count: 100 }, { event: "request_error", count: 20 }]);
});
it("rejects unknown dimensions and malformed counts before persistence", async () => {
  for (const counts of [{ "customer@example.test": 1 }, { rate_limit: -1 }, { rate_limit: NaN }]) {
    await expect(writeOperationalCounts(counts, pool)).rejects.toThrow("Invalid operational counter");
  }
  expect((await pool.query("SELECT count(*)::int AS n FROM operational_counters")).rows[0].n).toBe(0);
});
it("saturates a storm counter and prunes only old aggregate buckets", async () => {
  await pool.query("INSERT INTO operational_counters VALUES ('request_error', now()-interval '8 days', 1)");
  await writeOperationalCounts({ request_error: 1_000_000 }, pool);
  await writeOperationalCounts({ request_error: 7 }, pool);
  expect((await pool.query('SELECT count FROM operational_counters')).rows).toEqual([{ count: 1_000_000 }]);
});
it("does not partially persist a batch when its maintenance fails", async () => {
  const client = await pool.connect();
  try {
    await client.query("INSERT INTO operational_counters VALUES ('request_error', now()-interval '8 days', 1)");
    await client.query("CREATE FUNCTION pg_temp.refuse_counter_prune() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic prune failure'; END $$");
    await client.query("CREATE TRIGGER synthetic_prune_failure BEFORE DELETE ON operational_counters FOR EACH ROW EXECUTE FUNCTION pg_temp.refuse_counter_prune()");
    await expect(writeOperationalCounts({ rate_limit: 4 }, client)).rejects.toThrow();
    expect((await client.query("SELECT count(*)::int AS n FROM operational_counters WHERE event='rate_limit'")).rows[0].n).toBe(0);
  } finally {
    await client.query("DROP TRIGGER IF EXISTS synthetic_prune_failure ON operational_counters");
    client.release();
  }
});
