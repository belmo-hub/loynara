import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

/** Bound acquisition, SQL and commit together; expired work loses its transaction and connection. */
export function boundedWorkerDatabase(pool: Pick<Pool, "connect">, options: { timeoutMs?: number; deadline?: number; signal?: AbortSignal } = {}): Pick<Pool, "query"> {
  return {
    query<R extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<R>> {
      const duration = Math.min(options.timeoutMs ?? 5000, (options.deadline ?? Infinity) - Date.now());
      if (duration <= 0 || options.signal?.aborted) return Promise.reject(new Error("Worker database deadline exceeded"));
      return new Promise((resolve, reject) => {
        let client: PoolClient | undefined;
        let expired = false, released = false;
        const release = (destroy: boolean) => {
          if (!client || released) return;
          released = true;
          client.release(destroy);
        };
        const expire = () => {
          expired = true;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", expire);
          release(true);
          reject(new Error("Worker database deadline exceeded"));
        };
        const timer = setTimeout(expire, duration);
        options.signal?.addEventListener("abort", expire, { once: true });
        Promise.resolve().then(() => pool.connect()).then(async acquired => {
          client = acquired;
          if (expired) { release(true); return; }
          await client.query("BEGIN");
          await client.query(`SET LOCAL statement_timeout = '${Math.max(1, Math.floor(duration))}ms'`);
          await client.query(`SET LOCAL lock_timeout = '${Math.max(1, Math.floor(duration))}ms'`);
          if (expired) return;
          const result = await client.query<R>(text, values);
          if (expired) return;
          await client.query("COMMIT");
          if (expired) return;
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", expire);
          release(false);
          resolve(result);
        }).catch(() => {
          clearTimeout(timer);
          options.signal?.removeEventListener("abort", expire);
          release(true);
          reject(new Error("Worker database operation failed"));
        });
      });
    },
  } as Pick<Pool, "query">;
}
