import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { guardPoolErrors } from "./pool-errors";
import * as schema from "./schema";

const pool = guardPoolErrors(new Pool({ connectionString: process.env.DATABASE_URL, max: Number(process.env.PG_POOL_MAX ?? 10) }));
export const db = drizzle({ client: pool, schema });
export { pool };
