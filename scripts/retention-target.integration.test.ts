import { Client } from "pg";
import { afterAll, expect, it, vi } from "vitest";
import { pool } from "../src/db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "./test-database-guard";
import { assertRetentionDatabaseIdentity, retentionIdentityQuery, runRetentionCycle, type RetentionDatabaseIdentity } from "./retention-job";
assertTestDatabaseUrl();
afterAll(()=>pool.end());
it("refuses two different owned synthetic databases before any closure, pruning or archival work",async()=>{
 await assertOwnedTestDatabase(pool);
 // The standard database exists in both local and CI disposable clusters; only its identity is read.
 const otherUrl=new URL(process.env.DATABASE_URL!);otherUrl.pathname="/postgres";
 const other=new Client({connectionString:otherUrl.toString(),connectionTimeoutMillis:2000,query_timeout:2000});
 await other.connect();
 try {
  const [runtime,maintenance]=await Promise.all([pool.query<RetentionDatabaseIdentity>(retentionIdentityQuery),other.query<RetentionDatabaseIdentity>(retentionIdentityQuery)]);
  expect(runtime.rows[0].database).toBe("looplocal_test");expect(maintenance.rows[0].database).toBe("postgres");
  const lock=vi.fn(async()=>true),inactivity=vi.fn(async()=>({closed:0,flagged:0,cleaned:0})),prune=vi.fn(async()=>({rows:0})),erase=vi.fn(async()=>{});
  await expect(runRetentionCycle({verifyTarget:async()=>assertRetentionDatabaseIdentity(runtime.rows[0],maintenance.rows[0]),lock,unlock:async()=>{},inactivity,prune,candidates:async()=>[],erase})).rejects.toThrow("target mismatch");
  for(const mutation of [lock,inactivity,prune,erase]) expect(mutation).not.toHaveBeenCalled();
 } finally {await other.end();}
});
