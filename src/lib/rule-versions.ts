import { and, desc, eq, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { programRuleVersions, programs } from "@/db/schema";
import { DomainError } from "./loyalty";

type Reader = Pick<typeof db, "select">;
type Program = typeof programs.$inferSelect;
type Version = typeof programRuleVersions.$inferSelect;

/** ENG-100 D1 for rule versions, as reward-versions.ts has it for rewards: `v` is superseded when a higher version was
 *  created before `v` took effect. */
const notSuperseded = (v: string) =>
  `NOT EXISTS (SELECT 1 FROM program_rule_versions s WHERE s.tenant_id = ${v}.tenant_id AND s.program_id = ${v}.program_id AND s.version > ${v}.version AND s.created_at < ${v}.effective_at)`;

const versionRows = (reader: Reader, program: Pick<Program, "id" | "tenantId" | "locationId">, at: Date | SQL) => reader.select({
  version: programRuleVersions, due: sql<boolean>`${programRuleVersions.effectiveAt} <= (${at})::timestamptz`, kept: sql<boolean>`${sql.raw(notSuperseded("program_rule_versions"))}`,
  effectiveOn: sql<string>`to_char(${programRuleVersions.effectiveAt} AT TIME ZONE (SELECT l.timezone FROM locations l WHERE l.id = ${program.locationId} AND l.tenant_id = ${program.tenantId}), 'YYYY-MM-DD')`,
}).from(programRuleVersions).where(and(eq(programRuleVersions.tenantId, program.tenantId), eq(programRuleVersions.programId, program.id))).orderBy(desc(programRuleVersions.version));

/** In force (before the programme starts: the first version), pending (at most one) with its calendar day in the
 *  location's timezone, and the next version number. */
function split(rows: Awaited<ReturnType<typeof versionRows>>) {
  const kept = rows.filter(row => row.kept);
  const pending = kept[0]?.due === false ? kept[0] : undefined;
  return { inForce: (kept.find(row => row.due) ?? rows[rows.length - 1]).version, pending: pending?.version, effectiveOn: pending?.effectiveOn, next: rows[0].version.version + 1 };
}

/** The programme's rule versions at `at`, for a save: see split. */
export async function ruleVersions(reader: Reader, program: Pick<Program, "id" | "tenantId" | "locationId">, at: Date | SQL = sql`now()`) {
  const rows = await versionRows(reader, program, at);
  if (!rows.length) throw new DomainError("NOT_FOUND", "Programme rule not found");
  return split(rows);
}

/** The waiting version is an expiry change: a dated switch-on or shortening takes effect at the row's since (D4). */
export const expiryWaits = (program: Pick<Program, "pointsExpirySince">, pending: Version) => program.pointsExpirySince?.getTime() === pending.effectiveAt.getTime();

const earning = (v: Version) => ({ earningMode: v.earningMode, pointsPerCurrencyUnit: v.pointsPerCurrencyUnit, rulesText: v.rulesText });
export type RulePending = ReturnType<typeof earning> & { effectiveOn: string; old: ReturnType<typeof earning> };

/**
 * ENG-100 D5, the one accessor for everything that tells a customer or the counter what applies: the programmes row is
 * the newest saved (the owner's baseline), so name, type, earning mode, rate and rules text come from the rule version in
 * force at `at` (bookings pass clock_timestamp()). `pending` is a waiting rule change, `pendingExpiry` a waiting expiry.
 * The expiry in force is the row's months and since: a dated switch-on or shortening moves since four weeks on and lots
 * earned before since never expire (D4, Product), so no lot gets an expiry date or reminder before the date.
 */
export async function programInForce<P extends Program>(reader: Reader, program: P, at: Date | SQL = sql`now()`) {
  const rows = await versionRows(reader, program, at);
  // Every programme gets its first version when it starts; a bare row (synthetic fixtures) is its own rule.
  if (!rows.length) return { ...program, ruleVersionId: undefined, newestRuleVersionId: undefined, pending: null, pendingExpiry: null };
  const { inForce, pending, effectiveOn } = split(rows);
  const changed = pending && JSON.stringify(earning(pending)) !== JSON.stringify(earning(inForce));
  return {
    ...program, name: inForce.name, type: inForce.type, ...earning(inForce),
    ruleVersionId: inForce.id,
    /** What a join page showed: the newest version, pending or in force (D7). */
    newestRuleVersionId: (pending ?? inForce).id,
    pending: changed ? { effectiveOn: effectiveOn!, ...earning(pending), old: earning(inForce) } satisfies RulePending : null,
    // `before`: the months in force until then (null: points never expire), recorded on the version in force (saveExpiry).
    pendingExpiry: pending && expiryWaits(program, pending) ? { effectiveOn: effectiveOn!, months: program.pointsExpiryMonths!, before: inForce.pointsExpiryMonths } : null,
  };
}
