import { spawn } from "node:child_process";
import path from "node:path";
import type { OutboxJob } from "../src/lib/outbox";

export type WalletJobOutcome = { status: "complete" | "blocked" | "retry" | "lease_lost" | "stopped" };
export const walletJobLifetimeMs = 270_000;

/** The child must install this before importing database/provider modules. */
export function installWalletParentGuard(parentPid: number) {
  const exit = () => process.exit(1);
  if (!Number.isSafeInteger(parentPid) || parentPid <= 1 || !process.connected || process.ppid !== parentPid) exit();
  process.on("disconnect", exit);
  process.on("SIGTERM", exit);
  process.on("SIGINT", exit);
  const watchdog = setInterval(() => {
    if (!process.connected || process.ppid !== parentPid) return exit();
    try { process.kill(parentPid, 0); } catch { exit(); }
  }, 100);
  watchdog.unref();
}

/** Resolve only after exit: a failed lease must never leave a concurrent provider writer behind. */
export function superviseWalletJob(options: {
  job: OutboxJob;
  deadline: number;
  renew: () => Promise<boolean>;
  signal?: AbortSignal;
  entryPoint?: string;
  execArgv?: string[];
  renewEveryMs?: number;
  renewalTimeoutMs?: number;
  cleanupReserveMs?: number;
  killGraceMs?: number;
}): Promise<WalletJobOutcome> {
  return new Promise(resolve => {
    const killGraceMs = options.killGraceMs ?? 1000;
    const remaining = options.deadline - Date.now() - (options.cleanupReserveMs ?? 10_000);
    if (options.signal?.aborted || remaining <= killGraceMs) {
      resolve({ status: options.signal?.aborted ? "stopped" : "retry" });
      return;
    }
    const child = spawn(process.execPath, [
      ...(options.execArgv ?? [...process.execArgv, "--import", "tsx"]),
      options.entryPoint ?? path.resolve(__dirname, "wallet-worker-job.ts"),
    ], {
      // Provider/DB errors are deliberately not forwarded from the isolated process.
      stdio: ["ignore", "ignore", "ignore", "ipc"],
      env: { ...process.env, WALLET_JOB_PARENT_PID: String(process.pid) },
    });
    let outcome: WalletJobOutcome | undefined;
    let killing: ReturnType<typeof setTimeout> | undefined;
    let renewalTimer: ReturnType<typeof setTimeout> | undefined;
    let renewing = false;
    let exited = false;
    const stop = (status: WalletJobOutcome["status"]) => {
      // Lease loss/shutdown overrides a result that has not yet been reaped.
      if (status === "lease_lost" || status === "stopped" || !outcome) outcome = { status };
      if (killing || exited) return;
      child.kill("SIGTERM");
      killing = setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    };
    const abort = () => stop("stopped");
    options.signal?.addEventListener("abort", abort, { once: true });
    const deadlineTimer = setTimeout(() => stop("retry"), remaining - killGraceMs);
    const renewInterval = setInterval(() => {
      if (renewing || outcome || exited) return;
      renewing = true;
      renewalTimer = setTimeout(() => stop("lease_lost"), options.renewalTimeoutMs ?? 5000);
      Promise.resolve().then(options.renew).then(owned => {
        if (!owned) stop("lease_lost");
      }, () => stop("lease_lost")).finally(() => {
        if (renewalTimer) clearTimeout(renewalTimer);
        renewing = false;
      });
    }, options.renewEveryMs ?? 30_000);
    const finish = () => {
      if (exited) return;
      exited = true;
      clearTimeout(deadlineTimer);
      clearInterval(renewInterval);
      if (renewalTimer) clearTimeout(renewalTimer);
      if (killing) clearTimeout(killing);
      options.signal?.removeEventListener("abort", abort);
      resolve(outcome ?? { status: "retry" });
    };
    child.on("message", message => {
      if (!message || typeof message !== "object" || !("status" in message)) return;
      if (["complete", "blocked", "retry"].includes(String(message.status))) stop(message.status as "complete" | "blocked" | "retry");
    });
    child.on("error", () => { outcome = { status: "retry" }; if (!child.pid) finish(); else stop("retry"); });
    child.on("exit", finish);
    child.on("spawn", () => {
      if (options.signal?.aborted) return stop("stopped");
      if (!child.connected) return stop("retry");
      child.send(options.job, error => { if (error) stop("retry"); });
    });
  });
}
