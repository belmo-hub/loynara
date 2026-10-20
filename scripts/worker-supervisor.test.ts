import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { startWorkerMonitor } from "./worker-monitor";

const directory = mkdtempSync(path.join(tmpdir(), "wallet-supervisor-test-"));
const child = path.join(directory, "job.cjs");
const log = path.join(directory, "work.log");
writeFileSync(child, `const fs=require('node:fs');
process.on('message', job => {
  fs.appendFileSync(job.payload.log, 'started\\n');
  setInterval(()=>fs.appendFileSync(job.payload.log,'work\\n'),10);
  if(job.payload.complete) process.send({status:'complete'});
});
process.on('SIGTERM',()=>{});
`);
const job = { id: "synthetic", tenantId: "synthetic", attempts: 1, kind: "wallet.refresh", payload: { log } };
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
afterAll(() => rmSync(directory, { recursive: true, force: true }));
async function api() {
  const implementation = await import("./worker-supervisor").catch(() => null);
  expect(implementation?.superviseWalletJob, "Wallet execution needs an enforceable process supervisor").toBeTypeOf("function");
  return implementation!;
}
describe("actual Wallet job process ownership", () => {
  it("kills and reaps a child which ignores termination before the absolute deadline", async () => {
    const { superviseWalletJob } = await api();
    writeFileSync(log, "");
    const started = Date.now();
    let beats = 0;
    const stopMonitor = startWorkerMonitor({ intervalMs: 20, timeoutMs: 30, heartbeat: async () => { beats++; } });
    const result = await superviseWalletJob({ job, entryPoint: child, execArgv: [], deadline: started + 500, cleanupReserveMs: 50, killGraceMs: 20, renewEveryMs: 25, renew: async () => true });
    await stopMonitor();
    expect(beats).toBeGreaterThanOrEqual(10);
    expect(result.status).toBe("retry");
    expect(Date.now() - started).toBeLessThan(700);
    const lines = readFileSync(log, "utf8");
    expect(lines).toContain("started");
    await sleep(75);
    expect(readFileSync(log, "utf8")).toBe(lines);
  });
  it("stops an active child as soon as fenced renewal loses ownership", async () => {
    const { superviseWalletJob } = await api();
    writeFileSync(log, "");
    let renewals = 0;
    const result = await superviseWalletJob({ job, entryPoint: child, execArgv: [], deadline: Date.now() + 1500, cleanupReserveMs: 50, killGraceMs: 20, renewEveryMs: 60, renew: async () => ++renewals < 2 });
    expect(result.status).toBe("lease_lost");
    const lines = readFileSync(log, "utf8");
    expect(lines).toContain("started");
    await sleep(75);
    expect(readFileSync(log, "utf8")).toBe(lines);
  });
  it("reaps active work on shutdown and never reports timeout or shutdown complete", async () => {
    const { superviseWalletJob } = await api();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await superviseWalletJob({ job, entryPoint: child, execArgv: [], signal: controller.signal, deadline: Date.now() + 1500, cleanupReserveMs: 50, killGraceMs: 20, renew: async () => true });
    expect(result.status).toBe("stopped");
  });
  it("fails closed when the lease database operation stalls", async () => {
    const { superviseWalletJob } = await api();
    const started = Date.now();
    const result = await superviseWalletJob({ job, entryPoint: child, execArgv: [], deadline: started + 1500, cleanupReserveMs: 50, killGraceMs: 20, renewEveryMs: 25, renewalTimeoutMs: 60, renew: () => new Promise(() => {}) });
    expect(result.status).toBe("lease_lost");
    expect(Date.now() - started).toBeLessThan(700);
  });
  it("accepts success only after the reporting child has exited", async () => {
    const { superviseWalletJob } = await api();
    const result = await superviseWalletJob({ job: { ...job, payload: { log, complete: true } }, entryPoint: child, execArgv: [], deadline: Date.now() + 1500, cleanupReserveMs: 50, killGraceMs: 20, renew: async () => true });
    expect(result.status).toBe("complete");
    const lines = readFileSync(log, "utf8");
    await sleep(75);
    expect(readFileSync(log, "utf8")).toBe(lines);
  });
  it("terminates an orphan child after its parent is forcibly killed", async () => {
    const { installWalletParentGuard } = await api();
    expect(installWalletParentGuard).toBeTypeOf("function");
    const guarded = path.join(directory, "guarded.mjs"), parent = path.join(directory, "parent.cjs");
    const supervisor = path.resolve(__dirname, "worker-supervisor.ts");
    writeFileSync(guarded, `import supervisor from ${JSON.stringify(supervisor)};
const {installWalletParentGuard}=supervisor;
import fs from 'node:fs';
installWalletParentGuard(Number(process.env.WALLET_JOB_PARENT_PID));
fs.writeFileSync(${JSON.stringify(log)},String(process.pid));
setInterval(()=>{},10);
`);
    writeFileSync(parent, `const {spawn}=require('node:child_process');
spawn(process.execPath,['--import','tsx',${JSON.stringify(guarded)}],{stdio:['ignore','ignore','inherit','ipc'],env:{...process.env,WALLET_JOB_PARENT_PID:String(process.pid)}});
setInterval(()=>{},10);
`);
    writeFileSync(log, "");
    const processParent = spawn(process.execPath, [parent], { cwd: path.resolve(__dirname, ".."), stdio: ["ignore", "ignore", "pipe"] });
    let diagnostics = ""; processParent.stderr?.on("data", data => diagnostics += data);
    try {
      for (let i=0;i<150 && !readFileSync(log,"utf8");i++) await sleep(20);
      const pid = Number(readFileSync(log,"utf8"));
      expect(pid, diagnostics).toBeGreaterThan(0);
      processParent.kill("SIGKILL");
      let alive = true;
      for(let i=0;i<150;i++) { try { process.kill(pid,0); } catch { alive=false; break; } await sleep(20); }
      expect(alive).toBe(false);
    } finally { processParent.kill("SIGKILL"); }
  }, 10000);
});
describe("Wallet job timing line", () => {
  const serial = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
  it("carries queue wait, child start and each PassFast call, and nothing else", async () => {
    const { walletTimingLine } = await api();
    const line = walletTimingLine({ queueWaitMs: 812.4, totalMs: 9050, outcome: "complete", timing: { childStartMs: 1400, tenantId: serial,
      calls: [{ method: "get", status: 404, ms: 310, url: `https://api.passfa.st/functions/v1/manage-passes/serial/${serial}` },
        { method: "POST", status: 201, ms: 2200, apiKey: "synthetic-key" }, { method: serial, status: "500", ms: -1 }] } });
    expect(line.startsWith("Wallet job timing ")).toBe(true);
    expect(JSON.parse(line.slice("Wallet job timing ".length))).toEqual({ outcome: "complete", queueWaitMs: 812, childStartMs: 1400, totalMs: 9050,
      passfast: [{ method: "GET", status: 404, ms: 310 }, { method: "POST", status: 201, ms: 2200 }, { method: "OTHER", status: 0, ms: null }] });
    expect(line).not.toMatch(/passfa\.st|synthetic-key|3f2b1c4d/);
  });
  it("still logs a line when the child sent no timing", async () => {
    const { walletTimingLine } = await api();
    expect(walletTimingLine({ totalMs: 5, outcome: "lease_lost" })).toBe(
      'Wallet job timing {"outcome":"lease_lost","queueWaitMs":null,"childStartMs":null,"totalMs":5,"passfast":[]}');
  });
  it("passes the child's timing through the supervisor outcome", async () => {
    const { superviseWalletJob } = await api();
    const timed = path.join(directory, "timed.cjs");
    writeFileSync(timed, `process.on('message', () => process.send({status:'complete',timing:{childStartMs:7,calls:[{method:'PATCH',status:200,ms:90}]}}));`);
    const result = await superviseWalletJob({ job, entryPoint: timed, execArgv: [], deadline: Date.now() + 1500, cleanupReserveMs: 50, killGraceMs: 20, renew: async () => true });
    expect(result).toEqual({ status: "complete", timing: { childStartMs: 7, calls: [{ method: "PATCH", status: 200, ms: 90 }] } });
  });
});
