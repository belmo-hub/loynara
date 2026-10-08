import { drizzle } from "drizzle-orm/node-postgres";
import type { Pool, PoolClient } from "pg";
import { db, pool } from "@/db";
import * as schema from "@/db/schema";

export const WALLET_HTTP_MS = 15_000;
export const WALLET_DOWNLOAD_MS = 65_000;
export class WalletOperationTimeout extends Error {
  constructor() { super("Wallet operation timed out"); this.name = "WalletOperationTimeout"; }
}
export type WalletDatabase = Omit<typeof db, "$client">;

/** A request owns one bounded pool borrower. Destroying it aborts SQL/rolls back any unfinished transaction.
 * Never return session-level Wallet timeouts to a general application borrower, or launch work on a late acquisition.
 */
export async function withWalletDatabase<T>(work: (database: WalletDatabase, client: PoolClient, deadline: number) => Promise<T>, milliseconds = WALLET_HTTP_MS, connections: Pick<Pool, "connect"> = pool): Promise<T> {
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) throw new WalletOperationTimeout();
  const deadline = Date.now() + milliseconds;
  let client: PoolClient | undefined, expired = false, released = false;
  const destroy = () => { if (client && !released) { released = true; client.release(true); } };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { expired = true; destroy(); reject(new WalletOperationTimeout()); }, milliseconds);
  });
  const operation = (async () => {
    const acquired = await connections.connect();
    if (expired || Date.now() >= deadline) { acquired.release(true); throw new WalletOperationTimeout(); }
    client = acquired;
    await client.query("SET statement_timeout = '10s'");
    await client.query("SET lock_timeout = '5s'");
    if (expired || Date.now() >= deadline) throw new WalletOperationTimeout();
    return work(drizzle({ client, schema }), client, deadline);
  })();
  try { return await Promise.race([operation, timeout]); }
  finally { if (timer) clearTimeout(timer); destroy(); }
}
