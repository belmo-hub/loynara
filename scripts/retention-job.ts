import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isIP } from "node:net";

export type ErasureCandidate = { scope: "member" | "tenant"; tenant_id: string; membership_id: string | null; cutoff: Date };
export type RetentionDatabaseIdentity = { database: string; serverAddress: string | null; serverPort: number | null };
export const retentionIdentityQuery = 'SELECT current_database() AS database,host(inet_server_addr()) AS "serverAddress",inet_server_port() AS "serverPort"';
/** Compare actual connected server identities, never two independently supplied labels. */
export function assertRetentionDatabaseIdentity(runtime: RetentionDatabaseIdentity | undefined, maintenance: RetentionDatabaseIdentity | undefined) {
  const valid = (value: RetentionDatabaseIdentity | undefined) => Boolean(value && typeof value.database === "string" && value.database.length > 0
    && typeof value.serverAddress === "string" && isIP(value.serverAddress) > 0
    && Number.isSafeInteger(value.serverPort) && value.serverPort! > 0 && value.serverPort! <= 65535);
  if (!valid(runtime) || !valid(maintenance) || runtime!.database !== maintenance!.database
    || runtime!.serverAddress !== maintenance!.serverAddress || runtime!.serverPort !== maintenance!.serverPort) throw new Error("Retention database target mismatch or unavailable identity");
}
export type RetentionWork = {
  verifyTarget(): Promise<void>;
  lock(): Promise<boolean>; unlock(): Promise<void>;
  inactivity(deadlineAt: number): Promise<{ closed: number; flagged: number; cleaned: number }>;
  prune(): Promise<Record<string, number>>; candidates(): Promise<ErasureCandidate[]>;
  /** Must archive a durable encrypted intent before executing the database purge. */
  erase(candidate: ErasureCandidate): Promise<void>;
};
const budgetFailure = () => new Error("Retention cycle budget exhausted with work not verified drained");
/** Five-minute cron: drain in bounded batches for at most four minutes; unfinished work is never a healthy run. */
export async function runRetentionCycle(work: RetentionWork, options: { now?: () => number; budgetMs?: number } = {}) {
  const now = options.now ?? Date.now, budgetMs = options.budgetMs ?? 240_000;
  if (!Number.isSafeInteger(budgetMs) || budgetMs < 62_000 || budgetMs > 240_000) throw new Error("Invalid retention cycle budget");
  const deadlineAt = now() + budgetMs;
  const remaining = (minimum: number) => { if (deadlineAt - now() < minimum) throw budgetFailure(); };
  await work.verifyTarget();
  if (!await work.lock()) return { skipped: true } as const;
  try {
    let closed = 0, flagged = 0, erased = 0, rounds = 0;
    while (true) {
      remaining(62_000); if (++rounds > 100) throw budgetFailure();
      const result = await work.inactivity(deadlineAt);
      if ([result.closed, result.flagged, result.cleaned].some(value => !Number.isSafeInteger(value) || value < 0 || value > 50)) throw new Error("Invalid inactivity measurement");
      closed += result.closed; flagged += result.flagged;
      if (result.closed < 50 && result.flagged < 50 && result.cleaned < 50) break;
    }
    rounds = 0;
    while (true) {
      remaining(35_000); if (++rounds > 100) throw budgetFailure();
      const counts = await work.prune();
      if (!counts || typeof counts !== "object" || Array.isArray(counts) || !Object.keys(counts).length
        || Object.values(counts).some(value => !Number.isSafeInteger(value) || value < 0 || value > 100)) throw new Error("Invalid retention pruning measurement");
      // Even a partial batch can unblock another category's foreign-key dependency.
      if (Object.values(counts).every(value => value === 0)) break;
    }
    rounds = 0;
    while (true) {
      remaining(35_000); if (++rounds > 100) throw budgetFailure();
      const candidates = await work.candidates();
      if (!Array.isArray(candidates) || candidates.length > 50) throw new Error("Invalid retention candidate measurement");
      if (!candidates.length) break;
      for (const candidate of candidates) {
        remaining(47_000);
        await work.erase(candidate); erased++;
      }
    }
    remaining(1);
    return { skipped: false, closed, flagged, erased } as const;
  } finally { await work.unlock(); }
}

/** TERM allows Python to kill its tracked tool groups; KILL is the bounded fallback. */
export async function runRetentionChild(candidate: ErasureCandidate, start: typeof spawn = spawn): Promise<void> {
  const failure = () => new Error("Erasure archive or purge refused; operator review required");
  const allowed = ["PATH", "HOME", "TMPDIR", "LANG", "PGHOST", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPASSFILE", "PGSSLMODE", "PGSSLROOTCERT", "PGSSLCERT", "PGSSLKEY", "PRODUCTION_ENVIRONMENT",
    "ERASURE_POLICY_APPROVED", "ERASURE_S3_ENDPOINT", "ERASURE_S3_BUCKET", "ERASURE_S3_PREFIX", "ERASURE_NAMESPACE_ID", "ERASURE_AWS_ACCESS_KEY_ID", "ERASURE_AWS_SECRET_ACCESS_KEY", "ERASURE_AGE_RECIPIENT", "ERASURE_CLOSURE_S3_BUCKET", "ERASURE_ALLOW_LOCAL_ISOLATED", "ERASURE_EXPECTED_DATA_DIRECTORY"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV, ...Object.fromEntries(allowed.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]!])) };
  let payload: string;
  try { payload = JSON.stringify({ scope: candidate.scope, tenant_id: candidate.tenant_id, member_id: candidate.membership_id, cutoff_at: new Date(candidate.cutoff).toISOString() }); } catch { throw failure(); }
  await new Promise<void>((resolve, reject) => {
    let settled = false, timedOut = false;
    let soft: ReturnType<typeof setTimeout> | undefined, hard: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      if (settled) return; settled = true; clearTimeout(soft); clearTimeout(hard);
      if (error) reject(error); else resolve();
    };
    let child: ChildProcess | undefined;
    const terminate = () => {
      if (timedOut) return; timedOut = true;
      child?.kill("SIGTERM");
      hard = setTimeout(() => { child?.kill("SIGKILL"); finish(failure()); }, 2_000);
    };
    try {
      child = start("python3", [fileURLToPath(new URL("./erasure_manifest.py", import.meta.url)), "purge"], { env, stdio: ["pipe", "ignore", "ignore"] });
      child.once("error", () => finish(failure()));
      child.once("close", code => finish(code === 0 && !timedOut ? undefined : failure()));
      soft = setTimeout(terminate, 45_000);
      child.stdin!.on("error", () => {});
      child.stdin!.end(payload);
    } catch { if (child) terminate(); else finish(failure()); }
  });
}

/** Worker-hosted five-minute schedule: each cycle runs `retention-prune.ts` in its own process, so it never blocks the
 * job loop, never overlaps itself, and is TERM/KILLed past its lifetime (the cycle's own budget is 240 s). */
export function startRetentionSchedule(options: { start?: typeof spawn; entryPoint?: string; execArgv?: string[]; intervalMs?: number; lifetimeMs?: number; killGraceMs?: number } = {}): () => Promise<void> {
  const start = options.start ?? spawn, intervalMs = options.intervalMs ?? 300_000, lifetimeMs = options.lifetimeMs ?? 270_000, killGraceMs = options.killGraceMs ?? 5_000;
  let stopped = false, next: ReturnType<typeof setTimeout> | undefined, child: ChildProcess | undefined, active: Promise<void> | undefined;
  const tick = () => {
    if (stopped) return;
    const startedAt = Date.now();
    active = new Promise<void>(resolve => {
      let soft: ReturnType<typeof setTimeout> | undefined, hard: ReturnType<typeof setTimeout> | undefined, finished = false;
      const done = () => {
        if (finished) return; finished = true; clearTimeout(soft); clearTimeout(hard); child = undefined;
        resolve();
        if (!stopped) next = setTimeout(tick, Math.max(0, intervalMs - (Date.now() - startedAt)));
      };
      try {
        child = start(process.execPath, [...(options.execArgv ?? [...process.execArgv, "--import", "tsx"]), options.entryPoint ?? fileURLToPath(new URL("./retention-prune.ts", import.meta.url))],
          { env: process.env, stdio: ["ignore", "inherit", "inherit"] });
        child.once("error", () => { console.error("Retention run could not start"); done(); });
        child.once("close", done);
        soft = setTimeout(() => { child?.kill("SIGTERM"); hard = setTimeout(() => child?.kill("SIGKILL"), killGraceMs); }, lifetimeMs);
      } catch { console.error("Retention run could not start"); done(); }
    });
  };
  tick();
  return async () => {
    stopped = true;
    clearTimeout(next);
    child?.kill("SIGTERM");
    const kill = setTimeout(() => child?.kill("SIGKILL"), killGraceMs);
    await active;
    clearTimeout(kill);
  };
}
