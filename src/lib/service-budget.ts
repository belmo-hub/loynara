import type { QueryConfig } from "pg";

export type ExternalService = "email" | "wallet" | "push";
type Environment = Readonly<Record<string, string | undefined>>;
const limits = { email: ["SERVICE_EMAIL_MONTHLY_LIMIT", 1000], wallet: ["SERVICE_WALLET_MONTHLY_LIMIT", 5000], push: ["SERVICE_PUSH_MONTHLY_LIMIT", 10000] } as const;
export class ServiceBudgetError extends Error {
  constructor() { super("Optional service temporarily unavailable"); this.name = "ServiceBudgetError"; }
}

export function serviceMonthlyLimit(service: ExternalService, env: Environment = process.env): number {
  const [key, fallback] = limits[service];
  const value = env[key];
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new ServiceBudgetError();
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit > 10_000_000) throw new ServiceBudgetError();
  return limit;
}

type ReservationQuery = QueryConfig & { query_timeout: number };
type Queries = { query: (config: ReservationQuery) => Promise<{ rows: { attempts: number }[] }> };
/** Reserve every attempted provider call, including uncertain outcomes. No refunds or fail-open path. */
export async function reserveServiceCall(service: ExternalService, env: Environment = process.env, queries?: Queries): Promise<void> {
  const limit = serviceMonthlyLimit(service, env);
  if (limit === 0) throw new ServiceBudgetError();
  try {
    const database = queries ?? (await import("../db")).pool;
    // Direct pool.query discards a timed-out connection. Never apply this client
    // timeout to checked-out transaction clients that could be released as healthy.
    const result = await database.query({ text: `
      INSERT INTO service_usage (service, month, attempts)
      VALUES ($1, date_trunc('month', now() at time zone 'UTC')::date, 1)
      ON CONFLICT (service, month) DO UPDATE SET attempts = service_usage.attempts + 1
      WHERE service_usage.attempts < $2
      RETURNING attempts`, values: [service, limit], query_timeout: 5000 });
    if (result.rows.length !== 1) throw new ServiceBudgetError();
  } catch { throw new ServiceBudgetError(); }
}

/** All adapters share the same durable reservation, including local fixture tests. */
export async function reserveExternalServiceCall(service: ExternalService, env: Environment = process.env): Promise<void> {
  await reserveServiceCall(service, env);
}
