import { Pool } from "pg";
import { guardPoolErrors } from "@/db/pool-errors";

let readinessPool: Pool | undefined;
function database() {
  if (!readinessPool) {
    // Keep readiness independent of application pool exhaustion. The connection
    // timeout also bounds waiting for this pool's single busy connection.
    readinessPool = guardPoolErrors(new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 1000,
      statement_timeout: 1000,
      query_timeout: 1000,
      idleTimeoutMillis: 1000,
      allowExitOnIdle: true,
    }));
  }
  return readinessPool;
}

export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    await database().query("select 1");
    return Response.json({ status: "ok", database: "reachable" }, { headers });
  } catch {
    return Response.json({ status: "degraded", database: "unreachable" }, { status: 503, headers });
  }
}
