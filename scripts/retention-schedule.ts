import { startRetentionSchedule } from "./retention-job";

// Long-running retention service: same artifact as the worker, but its own service with the maintenance
// authority, so web and worker never hold it (PRODUCTION_STEPS.md, retention job). Every cycle is `retention-prune.ts`.
const stop = startRetentionSchedule();
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void stop(); });
