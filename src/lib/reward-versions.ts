import { sql, type SQL } from "drizzle-orm";

/**
 * ENG-100 D1: reward version `v` (a table alias) is superseded when a higher version was created before `v` took effect.
 * In force at T = the highest version not superseded with effective_at <= T; pending = the same with effective_at > T.
 * Rows are append-only, so a take-back inserts a copy of the version in force, which supersedes the pending one.
 */
export const notSuperseded = (v: string) =>
  `NOT EXISTS (SELECT 1 FROM reward_versions s WHERE s.tenant_id = ${v}.tenant_id AND s.reward_id = ${v}.reward_id AND s.version > ${v}.version AND s.created_at < ${v}.effective_at)`;

/** ENG-100 D4: reward `r` is live at T while active and not past its scheduled end (an archive takes effect at ends_at). */
export function liveReward(r: string, at: string): string;
export function liveReward(r: string, at: SQL): SQL;
export function liveReward(r: string, at: string | SQL) {
  if (typeof at === "string") return `(${r}.active AND (${r}.ends_at IS NULL OR ${r}.ends_at > ${at}))`;
  return sql`(${sql.raw(`${r}.active AND (${r}.ends_at IS NULL OR ${r}.ends_at >`)} ${at}))`;
}

/**
 * A save's one instant, read after the programme lock (Reviewer, 29 Oct): created_at, effective_at and the date four weeks
 * on all come from it, so version order follows lock order rather than transaction start. As text, to keep microseconds.
 */
export async function savedAt(tx: { execute: (query: SQL) => Promise<{ rows: unknown[] }> }): Promise<SQL> {
  const [{ at }] = (await tx.execute(sql`SELECT clock_timestamp()::text AS at`)).rows as Array<{ at: string }>;
  return sql`${at}::timestamptz`;
}

/** Changes to customers' disadvantage take effect four weeks after saving (Q-87); never backdated. */
export const noticeEnd = (at: SQL) => sql`(${at} + interval '28 days')`;
