import { Pool } from "pg";
import { guardPoolErrors } from "@/db/pool-errors";

const events = ["request_error", "rate_limit", "push_failure", "wallet_failure"] as const;
export type OperationalEvent = typeof events[number];
type Counts = Partial<Record<OperationalEvent, number>>;
type Queries = { query: (text: string, values?: unknown[]) => Promise<unknown> };
let signalPool: Pool | undefined;
function database() {
  if (!signalPool) {
    signalPool = guardPoolErrors(new Pool({ connectionString: process.env.DATABASE_URL, max: 1, connectionTimeoutMillis: 1000, statement_timeout: 1000, query_timeout: 1000, idleTimeoutMillis: 1000, allowExitOnIdle: true }));
  }
  return signalPool;
}

export async function writeOperationalCounts(counts: Counts, queries: Queries = database()): Promise<void> {
  const rows = Object.entries(counts);
  if (rows.some(([event, count]) => !events.includes(event as OperationalEvent) || !Number.isSafeInteger(count) || count! < 1 || count! > 1_000_000)) throw new Error("Invalid operational counter");
  if (!rows.length) return;
  // Prune and aggregate atomically: a maintenance failure cannot requeue a
  // batch whose insert already committed. These are global counts only.
  await queries.query(`WITH expired AS (
      DELETE FROM operational_counters WHERE minute < now() - interval '7 days'
    ) INSERT INTO operational_counters(event, minute, count)
    SELECT event, date_trunc('minute', clock_timestamp()), count FROM jsonb_to_recordset($1::jsonb) AS x(event text, count integer)
    ON CONFLICT(event, minute) DO UPDATE SET count = least(1000000, operational_counters.count + excluded.count)`,
  [JSON.stringify(rows.map(([event, count]) => ({ event, count })))]);
}

/** Four bounded buckets and one in-flight write per process, including during a database outage. */
export class OperationalSignalBuffer {
  private pending: Counts = {};
  private active: Promise<void> | undefined;
  private nextDiagnosticAt = 0;
  constructor(private write: (counts: Counts) => Promise<void>) {}
  record(event: OperationalEvent) {
    if (!events.includes(event)) return;
    this.pending[event] = Math.min(1_000_000, (this.pending[event] ?? 0) + 1);
  }
  async flush(): Promise<void> {
    if (this.active) return this.active;
    if (!Object.keys(this.pending).length) return;
    const batch = this.pending;
    this.pending = {};
    this.active = Promise.resolve().then(() => this.write(batch)).catch(() => {
      for (const event of events) if (batch[event]) this.pending[event] = Math.min(1_000_000, (this.pending[event] ?? 0) + batch[event]!);
      if (Date.now() >= this.nextDiagnosticAt) {
        this.nextDiagnosticAt = Date.now() + 60_000;
        try { console.error('{"event":"operational_telemetry_unavailable"}'); } catch { /* Telemetry must not fail the caller. */ }
      }
    }).finally(() => { this.active = undefined; });
    return this.active;
  }
}
const buffer = new OperationalSignalBuffer(writeOperationalCounts);
let scheduled = false;
export function recordOperationalEvent(event: OperationalEvent) {
  buffer.record(event);
  if (!scheduled) {
    scheduled = true;
    setTimeout(() => { scheduled = false; void buffer.flush(); }, 1000).unref();
  }
}
export const flushOperationalEvents = () => buffer.flush();
