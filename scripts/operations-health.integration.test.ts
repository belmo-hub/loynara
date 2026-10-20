import { assertTestDatabaseUrl, assertOwnedTestDatabase } from "./test-database-guard";
import { randomUUID } from "node:crypto";
import { afterAll, expect, it } from "vitest";
import { pool } from "../src/db";
import { operationsAlerts, readOperationsCounts } from "./operations-health";
assertTestDatabaseUrl();
afterAll(() => pool.end());
it("detects stalled leases, recent delivery failures, spikes and near-limit service use from real rows", async () => {
  await assertOwnedTestDatabase(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query('TRUNCATE deletion_receipts, tenants, operational_counters, service_usage CASCADE');
    const tenant = randomUUID();
    await client.query("INSERT INTO tenants(id,name,slug) VALUES ($1::uuid,'Synthetic operations fixture',$1::text)", [tenant]);
    const jobs = await client.query(`INSERT INTO outbox_jobs(tenant_id,kind,payload,status,next_attempt_at)
      SELECT $1,'email.verify','{}',status,now()-age FROM (VALUES
        ('failed',interval '0 seconds'),('blocked',interval '0 seconds'),
        ('pending',interval '16 minutes'),('retry',interval '14 minutes'),
        ('processing',interval '3 minutes'),('processing',interval '1 minute'),
        ('complete',interval '2 days'),('complete',interval '0 seconds')) v(status,age) RETURNING id`, [tenant]);
    await client.query(`INSERT INTO email_deliveries(job_id,provider,recipient_hash,status,updated_at) VALUES
      ($1,'mailgun_eu','synthetic','permanent_failure',now()),
      ($2,'mailgun_eu','synthetic','temporary_failure',now()-interval '25 hours'),
      ($3,'mailgun_eu','synthetic','sending',now()-interval '16 minutes'),
      ($4,'mailgun_eu','synthetic','sending',now()-interval '14 minutes'),
      ($5,'mailgun_eu','synthetic','sending',now()-interval '25 hours')`, jobs.rows.slice(0,5).map(row => row.id));
    await client.query(`INSERT INTO operational_counters(event,minute,count) VALUES
      ('request_error',date_trunc('minute',now()),1),
      ('rate_limit',date_trunc('minute',now())-interval '4 minutes',100),
      ('rate_limit',date_trunc('minute',now())-interval '5 minutes',999),
      ('push_failure',date_trunc('minute',now()),2),('wallet_failure',date_trunc('minute',now()),3)`);
    await client.query(`INSERT INTO service_usage VALUES
      ('email',date_trunc('month',now() at time zone 'UTC')::date,800),
      ('wallet',date_trunc('month',now() at time zone 'UTC')::date,3999),
      ('push',date_trunc('month',now() at time zone 'UTC')::date-interval '1 month',9999)`);
    const counts = await readOperationsCounts(client, { NODE_ENV: "test" });
    expect(counts).toEqual({ failed: 1, blocked: 1, overdue: 1, expiredLeases: 1, emailFailures: 3, errors: 1, rateLimited: 100, pushFailures: 2, walletFailures: 3, budgetWarnings: 1, overdueCards: 0, overdueTenants: 0, holdReviews: 0, remoteIncomplete: 0, unclassifiedTenants: 0 });
    expect(operationsAlerts(counts)).toHaveLength(10);
  } finally { await client.query("ROLLBACK"); client.release(); }
});
