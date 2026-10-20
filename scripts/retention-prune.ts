import "dotenv/config";
import { Client } from "pg";
import { pool } from "../src/db";
import { reviewInactiveCards } from "../src/lib/inactivity";
import { retentionPolicyVersion } from "../src/lib/card-lifecycle";
import { assertRetentionDatabaseIdentity, retentionIdentityQuery, runRetentionChild, runRetentionCycle, type ErasureCandidate, type RetentionDatabaseIdentity } from "./retention-job";
import { sendWorkerHeartbeat, validHeartbeatUrl } from "./ops-heartbeat";

async function main() {
  if (process.argv.length>2 || process.env.ERASURE_POLICY_APPROVED!==retentionPolicyVersion) throw new Error("Retention policy activation is not configured");
  if (!process.env.PGHOST || !process.env.PGUSER || !process.env.PGDATABASE || !process.env.DATABASE_URL) throw new Error("Runtime and maintenance database connections are required");
  if(process.env.NODE_ENV==="production"&&!validHeartbeatUrl(process.env.RETENTION_HEARTBEAT_URL)) throw new Error("Retention heartbeat configuration required");
  const maintenance=new Client({connectionTimeoutMillis:5000,statement_timeout:30_000,query_timeout:35_000,application_name:"retention-job"});
  try {
    await maintenance.connect();
    const result=await runRetentionCycle({
      verifyTarget:async()=>{
        const identityQuery={text:retentionIdentityQuery,query_timeout:5000};
        const [runtimeIdentity,maintenanceIdentity]=await Promise.all([
          pool.query<RetentionDatabaseIdentity>(identityQuery),
          maintenance.query<RetentionDatabaseIdentity>(identityQuery),
        ]);
        assertRetentionDatabaseIdentity(runtimeIdentity.rows[0],maintenanceIdentity.rows[0]);
        await maintenance.query("SET ROLE loynara_maintenance");
      },
      lock:async()=>Boolean((await maintenance.query("SELECT pg_try_advisory_lock(hashtextextended('loynara-retention-job-v1',0)) AS owned")).rows[0].owned),
      unlock:async()=>{await maintenance.query("SELECT pg_advisory_unlock(hashtextextended('loynara-retention-job-v1',0))");},
      inactivity:deadlineAt=>reviewInactiveCards(50,deadlineAt),
      prune:async()=>(await maintenance.query<{counts:Record<string,number>}>("SELECT public.loynara_prune_expired(100) AS counts")).rows[0]?.counts,
      candidates:async()=>(await maintenance.query<ErasureCandidate>("SELECT * FROM public.loynara_retention_candidates(50)")).rows,
      erase:runRetentionChild,
    });
    if(result.skipped) { console.log("Retention run skipped: another run is active");return; }
    if(process.env.RETENTION_HEARTBEAT_URL&&!await sendWorkerHeartbeat(process.env.RETENTION_HEARTBEAT_URL)) throw new Error("Retention heartbeat failed");
    console.log(JSON.stringify(result));
  } finally { await maintenance.end().catch(()=>{});await pool.end(); }
}
main().catch(async()=>{console.error("Retention run failed; no success heartbeat sent");await pool.end().catch(()=>{});process.exitCode=1;});
