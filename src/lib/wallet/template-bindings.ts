import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { locations, tenants, walletTemplateBindingEvents, walletTemplateBindings } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { assertPlateOperator } from "@/lib/plates";
import { passFastStatus, tenantTemplates } from "./passfast";

/**
 * Apple Wallet template per location (ENG-046). The operator sets it on /operator; PASSFAST_TENANT_TEMPLATES stays the
 * read-only fallback for a location without a row and the source of the one-time import. The pass's object id hashes the
 * template, so changing a binding stops updates to passes issued under the old one, exactly as a changed env binding did.
 */
type Env = Record<string, string | undefined>;
type Reader = Pick<typeof db, "select">;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scopeKey = (tenantId: string, locationId: string) => `${tenantId.toLowerCase()}/${locationId.toLowerCase()}`;
// One writer at a time: a template must stay unique across locations, which a row lock cannot guard.
const lockBindings = (tx: Pick<typeof db, "execute">) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('wallet-template-bindings'))`);

/**
 * The env every PassFast check of one location runs on: its table binding, if any, replaces PASSFAST_TENANT_TEMPLATES with
 * that one exact scope. passFastConfig then applies every rule as before (exact scope, readiness, production approval).
 */
export async function passFastEnv(tenantId: string | undefined, locationId: string | undefined, reader: Reader = db, env: Env = process.env): Promise<Env> {
  if (!tenantId || !locationId) return env;
  const [row] = await reader.select({ templateId: walletTemplateBindings.templateId }).from(walletTemplateBindings)
    .where(and(eq(walletTemplateBindings.tenantId, tenantId), eq(walletTemplateBindings.locationId, locationId)));
  return row ? { ...env, PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId, locationId, templateId: row.templateId }]) } : env;
}

/** Env bindings, or none when the variable is absent or invalid (startup refuses an invalid one anyway). */
function envBindings(env: Env) {
  try { return [...tenantTemplates(env.PASSFAST_TENANT_TEMPLATES).values()]; } catch { return []; }
}

/** The effective template of every bound location, for the operator page: table first, then env. */
export async function walletTemplateOverview(reader: Reader, env: Env) {
  const result = new Map<string, { templateId: string; source: "table" | "env" }>();
  for (const b of envBindings(env)) result.set(scopeKey(b.tenantId, b.locationId), { templateId: b.templateId, source: "env" });
  for (const b of await reader.select().from(walletTemplateBindings)) result.set(scopeKey(b.tenantId, b.locationId), { templateId: b.templateId, source: "table" });
  return result;
}

/**
 * Sets or changes one location's template. Dry run unless `execute`; the dry run shows from → to and whether PassFast would
 * be ready for the location with it. Refuses a template that the table or the env already gives another location.
 */
export async function setWalletTemplate(input: { actorUserId: string; env: Env; tenantId: string; locationId: string; templateId: string; execute: boolean }) {
  if (!UUID.test(input.tenantId) || !UUID.test(input.locationId)) throw new DomainError("NOT_FOUND", "Standort nicht gefunden");
  if (!UUID.test(input.templateId.trim())) throw new DomainError("INVALID_TEMPLATE", "Die Vorlagen-ID muss eine UUID aus PassFast sein");
  const templateId = input.templateId.trim().toLowerCase(), scope = scopeKey(input.tenantId, input.locationId);
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    await lockBindings(tx);
    const [shop] = await tx.select({ tenantId: locations.tenantId, locationId: locations.id, merchant: tenants.name, location: locations.name })
      .from(locations).innerJoin(tenants, eq(tenants.id, locations.tenantId))
      .where(and(eq(locations.id, input.locationId), eq(locations.tenantId, input.tenantId)));
    if (!shop) throw new DomainError("NOT_FOUND", "Standort nicht gefunden");
    const [current] = await tx.select().from(walletTemplateBindings)
      .where(and(eq(walletTemplateBindings.tenantId, shop.tenantId), eq(walletTemplateBindings.locationId, shop.locationId)));
    const env = envBindings(input.env);
    const [taken] = await tx.select({ tenantId: walletTemplateBindings.tenantId, locationId: walletTemplateBindings.locationId }).from(walletTemplateBindings).where(eq(walletTemplateBindings.templateId, templateId));
    if ((taken && scopeKey(taken.tenantId, taken.locationId) !== scope) || env.some(b => b.templateId === templateId && scopeKey(b.tenantId, b.locationId) !== scope))
      throw new DomainError("TEMPLATE_IN_USE", "Diese Vorlage gehört schon zu einem anderen Standort");
    const from = current?.templateId ?? env.find(b => scopeKey(b.tenantId, b.locationId) === scope)?.templateId ?? null;
    const ready = passFastStatus({ ...input.env, PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: shop.tenantId, locationId: shop.locationId, templateId }]) }, shop.tenantId, shop.locationId).ready;
    const preview = { merchant: shop.merchant, location: shop.location, from, fromSource: current ? "table" as const : from ? "env" as const : null, to: templateId, ready };
    if (current?.templateId === templateId) return { result: "unchanged" as const, ...preview };
    // Same template as the env fallback: copying it in changes nothing for passes.
    const action = !from ? "set" as const : from === templateId ? "import" as const : "change" as const;
    if (!input.execute) return { result: `would_${action}` as const, ...preview };
    if (current) await tx.update(walletTemplateBindings).set({ templateId, changedByUserId: input.actorUserId, changedAt: new Date() })
      .where(and(eq(walletTemplateBindings.tenantId, shop.tenantId), eq(walletTemplateBindings.locationId, shop.locationId)));
    else await tx.insert(walletTemplateBindings).values({ tenantId: shop.tenantId, locationId: shop.locationId, templateId, createdByUserId: input.actorUserId, changedByUserId: input.actorUserId });
    await tx.insert(walletTemplateBindingEvents).values({ tenantId: shop.tenantId, locationId: shop.locationId, action, oldTemplateId: action === "change" ? from : null, newTemplateId: templateId, actorUserId: input.actorUserId });
    return { result: action, ...preview };
  });
}

/**
 * One-time copy of PASSFAST_TENANT_TEMPLATES into the table (scripts/operator-wallet-templates.ts). Never overwrites a
 * table row: a location the operator already set keeps its template. Dry run unless `execute`. Running it twice is a no-op.
 */
export async function importEnvWalletTemplates(input: { actorUserId: string; env: Env; execute: boolean }) {
  let bindings;
  try { bindings = [...tenantTemplates(input.env.PASSFAST_TENANT_TEMPLATES).values()]; }
  catch { throw new DomainError("ENV_BINDINGS_INVALID", "PASSFAST_TENANT_TEMPLATES is absent or invalid"); }
  return db.transaction(async tx => {
    await assertPlateOperator(tx, input.actorUserId, input.env);
    await lockBindings(tx);
    const results = [];
    for (const b of bindings) {
      const [location] = await tx.select({ id: locations.id }).from(locations).where(and(eq(locations.id, b.locationId), eq(locations.tenantId, b.tenantId)));
      const [current] = await tx.select().from(walletTemplateBindings).where(and(eq(walletTemplateBindings.tenantId, b.tenantId), eq(walletTemplateBindings.locationId, b.locationId)));
      const [taken] = await tx.select({ templateId: walletTemplateBindings.templateId }).from(walletTemplateBindings).where(eq(walletTemplateBindings.templateId, b.templateId));
      const result = !location ? "unknown_location" as const : current ? (current.templateId === b.templateId ? "unchanged" as const : "table_differs" as const)
        : taken ? "template_in_use" as const : input.execute ? "import" as const : "would_import" as const;
      if (result === "import") {
        await tx.insert(walletTemplateBindings).values({ ...b, createdByUserId: input.actorUserId, changedByUserId: input.actorUserId });
        await tx.insert(walletTemplateBindingEvents).values({ tenantId: b.tenantId, locationId: b.locationId, action: "import", newTemplateId: b.templateId, actorUserId: input.actorUserId });
      }
      results.push({ ...b, result });
    }
    return results;
  });
}
