import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { programs, walletGoogleClasses } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { walletProgramBrand } from "./data";
import { googleClass, googleConfig, GoogleWalletClient, GoogleWalletError } from "./google";
import { googleDirectConfig, googleDirectStatus, googleLocationClasses, type GoogleLocationClass } from "./google-direct";

type Env = Record<string, string | undefined>;
type Reader = Pick<typeof db, "select">;
const scopeKey = (row: { tenantId: string; locationId: string; programId: string }) => `${row.tenantId}/${row.locationId}/${row.programId}`.toLowerCase();
const REVIEW: Record<string, "pending" | "under_review" | "approved" | "rejected"> = { DRAFT: "pending", UNDER_REVIEW: "under_review", APPROVED: "approved", REJECTED: "rejected" };

/**
 * The env every Google check of one programme runs on: its table row, if any, replaces GOOGLE_WALLET_LOCATION_CLASSES with
 * that one exact scope, so googleDirectStatus applies every rule as before (owned issuer, class prefix, production approval).
 * Only an approved class issues; maintenance of passes already out needs just the binding.
 */
export async function googleDirectEnv(tenantId: string, locationId: string, programId: string, reader: Reader = db, env: Env = process.env): Promise<Env> {
  const [row] = await reader.select({ classId: walletGoogleClasses.classId, status: walletGoogleClasses.status }).from(walletGoogleClasses)
    .where(and(eq(walletGoogleClasses.tenantId, tenantId), eq(walletGoogleClasses.locationId, locationId), eq(walletGoogleClasses.programId, programId)));
  if (!row) return env;
  const binding: GoogleLocationClass = { tenantId, locationId, programId, classId: row.classId, issuanceEnabled: row.status === "approved", testAccountsApproved: false };
  return { ...env, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
}

/** What the operator page shows per programme. */
export async function googleClassOverview(reader: Reader) {
  const rows = await reader.select({ programId: walletGoogleClasses.programId, status: walletGoogleClasses.status, lastError: walletGoogleClasses.lastError }).from(walletGoogleClasses);
  return new Map(rows.map(({ programId, ...state }) => [programId, state]));
}

/**
 * Erasure step (Legal): every class of the shop, in the table or the env, is overwritten at Google before the shop's rows go.
 * Throws until all are done, so the erasure waits, no record is written and the confirmation is held; running the erasure
 * again retries. The rows hold what happened meanwhile, for the operator page. A shop without a class changes nothing.
 */
export async function overwriteGoogleClasses(tenantId: string, env: Env = process.env, fetcher: typeof fetch = fetch) {
  const rows = await db.select({ classId: walletGoogleClasses.classId }).from(walletGoogleClasses).where(eq(walletGoogleClasses.tenantId, tenantId));
  let bound: GoogleLocationClass[] = [];
  try { bound = googleLocationClasses(env).filter(row => row.tenantId === tenantId.toLowerCase()); } catch { /* Google off or misconfigured: only the table counts */ }
  const classIds = [...new Set([...rows.map(row => row.classId), ...bound.map(row => row.classId)])];
  if (!classIds.length) return 0;
  const record = (classId: string, state: { status: "under_review"; lastError: null } | { lastError: string }) => db.update(walletGoogleClasses).set({ ...state, updatedAt: new Date() }).where(eq(walletGoogleClasses.classId, classId));
  if (!googleDirectStatus(env).ready) throw new DomainError("EXTERNAL_PENDING", `${classIds.length} Google Wallet class(es) of the shop cannot be overwritten while Google is unavailable; the erasure waits`);
  const config = googleConfig(env);
  const client = new GoogleWalletClient(config, fetcher);
  let waiting = 0;
  for (const classId of classIds) {
    // Waiting for Google is no failure: the row just says it is under review.
    try { if (await client.neutralizeClass(classId, config.logoUrl) === "done") continue; await record(classId, { status: "under_review", lastError: null }); }
    catch (error) { await record(classId, { lastError: `erasure ${error instanceof GoogleWalletError ? error.step : "overwrite"}`.slice(0, 60) }); }
    waiting++;
  }
  if (waiting) throw new DomainError("EXTERNAL_PENDING", `${waiting} Google Wallet class(es) of the shop are not overwritten yet; the erasure waits, run it again`);
  return classIds.length;
}

/**
 * Worker step: every active programme gets its class, without anyone's hand and without a restart. It runs outside every
 * customer request, so a Google failure can never block a card or Apple; the row records it and the next run tries again.
 * Published issuers only: in Demo Mode the one approved synthetic class stays an explicit env binding. A scope the env
 * already binds stays with the env, because object ids hash the class id. A row whose fields did not change costs no call,
 * unless Google is still reviewing it.
 */
export async function syncGoogleClasses(env: Env = process.env, fetcher: typeof fetch = fetch) {
  const status = googleDirectStatus(env);
  if (!status.ready || status.publishingStatus !== "published") return { synced: 0, failed: 0 };
  const envBound = new Set(googleLocationClasses(env).map(scopeKey));
  // shortcut: every active programme's class fields are rebuilt each run, logo processing included (64-entry cache); fine for pilot numbers, move to change-driven jobs when the shop count grows.
  const active = await db.select({ tenantId: programs.tenantId, locationId: programs.locationId, programId: programs.id }).from(programs).where(eq(programs.status, "active"));
  let synced = 0, failed = 0;
  for (const scope of active) {
    if (envBound.has(scopeKey(scope))) continue;
    await db.insert(walletGoogleClasses).values({ ...scope, classId: `${env.GOOGLE_WALLET_ISSUER_ID}.program_${scope.programId}` }).onConflictDoNothing();
    const where = and(eq(walletGoogleClasses.tenantId, scope.tenantId), eq(walletGoogleClasses.locationId, scope.locationId), eq(walletGoogleClasses.programId, scope.programId));
    const [row] = await db.select().from(walletGoogleClasses).where(where);
    try {
      const config = googleDirectConfig(await googleDirectEnv(scope.tenantId, scope.locationId, scope.programId, db, env), scope.tenantId, scope.locationId, scope.programId, "maintenance");
      const brand = await walletProgramBrand(scope.tenantId, scope.programId);
      const hash = createHash("sha256").update(JSON.stringify(googleClass(brand, config))).digest("hex");
      if (row.syncedHash === hash && (row.status === "approved" || row.status === "rejected")) {
        // Nothing to send, and this run got this far: an older failure note no longer holds.
        if (row.lastError) await db.update(walletGoogleClasses).set({ lastError: null, updatedAt: new Date() }).where(where);
        continue;
      }
      const review = await new GoogleWalletClient(config, fetcher).provisionClass(brand, config);
      await db.update(walletGoogleClasses).set({ status: REVIEW[review] ?? "under_review", syncedHash: hash, lastError: null, updatedAt: new Date() }).where(where);
      synced++;
    } catch (error) {
      failed++;
      // Only the step, never a provider response.
      await db.update(walletGoogleClasses).set({ lastError: error instanceof GoogleWalletError ? error.step.slice(0, 60) : "sync", updatedAt: new Date() }).where(where);
      console.error(`Google Wallet class ${scope.programId} not synced (${error instanceof GoogleWalletError ? error.message : error instanceof Error ? error.name : "error"})`);
    }
  }
  return { synced, failed };
}
