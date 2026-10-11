import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) });
// node-postgres already discards the failed idle client before emitting this
// event. Handle it without exposing connection details or replaying any query;
// active query/transaction failures still reject at their existing call sites.
pool.on("error", () => { console.error("Database idle connection failed"); });
export const db = drizzle({ client: pool, schema });
export { pool };
