import { assertTestDatabaseUrl, assertOwnedTestDatabase } from "../../scripts/test-database-guard";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { reserveServiceCall, ServiceBudgetError } from "./service-budget";

assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query("TRUNCATE service_usage"); });
afterAll(() => pool.end());

describe("shared optional-service ceilings", () => {
  it("reserves at most the configured number of concurrent attempts across connections", async () => {
    const env = { SERVICE_EMAIL_MONTHLY_LIMIT: "3" };
    const outcomes = await Promise.allSettled(Array.from({ length: 20 }, () => reserveServiceCall("email", env)));
    expect(outcomes.filter(row => row.status === "fulfilled")).toHaveLength(3);
    expect(outcomes.filter(row => row.status === "rejected")).toHaveLength(17);
    expect((await pool.query("SELECT attempts FROM service_usage")).rows).toEqual([{ attempts: 3 }]);
  });
  it("keeps services and UTC calendar months independent", async () => {
    await pool.query("INSERT INTO service_usage(service, month, attempts) VALUES ('wallet', date_trunc('month', now() at time zone 'UTC')::date - interval '1 month', 9999)");
    await reserveServiceCall("wallet", { SERVICE_WALLET_MONTHLY_LIMIT: "1" });
    await expect(reserveServiceCall("wallet", { SERVICE_WALLET_MONTHLY_LIMIT: "1" })).rejects.toBeInstanceOf(ServiceBudgetError);
    await reserveServiceCall("push", { SERVICE_PUSH_MONTHLY_LIMIT: "1" });
    expect((await pool.query("SELECT count(*)::int AS n FROM service_usage")).rows[0].n).toBe(3);
  });
  it.each(["0", "", "-1", "1.5", "NaN", "10000001"])("refuses a disabled or malformed limit %s without a reservation", async limit => {
    await expect(reserveServiceCall("email", { SERVICE_EMAIL_MONTHLY_LIMIT: limit })).rejects.toBeInstanceOf(ServiceBudgetError);
    expect((await pool.query("SELECT count(*)::int AS n FROM service_usage")).rows[0].n).toBe(0);
  });
  it("counts uncertain attempts and refuses after an operator lowers a ceiling", async () => {
    await reserveServiceCall("email", { SERVICE_EMAIL_MONTHLY_LIMIT: "2" });
    await expect(reserveServiceCall("email", { SERVICE_EMAIL_MONTHLY_LIMIT: "1" })).rejects.toBeInstanceOf(ServiceBudgetError);
    expect((await pool.query("SELECT attempts FROM service_usage")).rows[0].attempts).toBe(1);
  });
  it("fails closed when its database cannot reserve, without leaking the driver exception", async () => {
    const broken = { query: async () => { throw new Error("synthetic-private-dsn"); } };
    await expect(reserveServiceCall("email", { SERVICE_EMAIL_MONTHLY_LIMIT: "2" }, broken)).rejects.toThrow("Optional service temporarily unavailable");
  });
});
