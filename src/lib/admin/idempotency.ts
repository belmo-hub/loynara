import { and, eq, sql } from "drizzle-orm";
import { adminIdempotencyKeys } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import type { Transaction } from "./types";
import type { AdminAction } from "./audit";
export async function withAdminIdempotency<T>(tx: Transaction, input: { adminUserId: string; key: string; action: AdminAction }, run: () => Promise<T>): Promise<T> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.adminUserId}:${input.key}`}, 0))`);
  const [existing] = await tx.select().from(adminIdempotencyKeys).where(and(eq(adminIdempotencyKeys.adminUserId, input.adminUserId), eq(adminIdempotencyKeys.key, input.key)));
  if (existing) {
    if (existing.action !== input.action) throw new DomainError("INVALID_REQUEST", "Idempotency key belongs to another action");
    return existing.result as T;
  }
  const result = (await run()) ?? null;
  await tx.insert(adminIdempotencyKeys).values({ ...input, result: result === null ? sql`'null'::jsonb` : result });
  return result as T;
}
