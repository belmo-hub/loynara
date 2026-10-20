import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { stageCustomerExport } from "./customer-export-stage";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, open: vi.fn(async (...args: Parameters<typeof actual.open>) => {
    const handle = await actual.open(...args);
    // Check the actual filesystem permissions before production unlinks it.
    expect((await actual.stat(path.dirname(String(args[0])))).mode & 0o777).toBe(0o700);
    expect((await handle.stat()).mode & 0o777).toBe(0o600);
    return handle;
  }) };
});

it("stages a complete private file and removes it after transfer", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-stage-test-"));
  try {
    const result = await stageCustomerExport(async append => { await append('{"complete":'); await append("true}"); }, undefined, { root });
    expect(await readdir(root)).toEqual([]);
    expect(await new Response(result.stream).json()).toEqual({ complete: true });
    await expect.poll(async () => (await readdir(root)).length).toBe(0);
  } finally { await rm(root, { recursive: true }); }
});
it("removes partial staging after a late category failure or explicit size refusal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-stage-test-"));
  try {
    await expect(stageCustomerExport(async append => { await append('{"partial":'); throw new Error("synthetic category failure"); }, undefined, { root })).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
    await expect(stageCustomerExport(async append => { await append("a".repeat(11)); }, undefined, { root, maxBytes: 10 })).rejects.toMatchObject({ code: "EXPORT_ASSISTANCE_REQUIRED" });
    expect(await readdir(root)).toEqual([]);
  } finally { await rm(root, { recursive: true }); }
});
it("removes private staging on cancellation and abort", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-stage-test-"));
  try {
    const result = await stageCustomerExport(async append => append("{}"), undefined, { root });
    await result.stream.cancel(); expect(await readdir(root)).toEqual([]);
    const controller = new AbortController();
    const next = await stageCustomerExport(async append => append("{}"), controller.signal, { root });
    controller.abort();
    await expect(new Response(next.stream).text()).rejects.toThrow();
    await expect.poll(async () => (await readdir(root)).length).toBe(0);
  } finally { await rm(root, { recursive: true }); }
});
it("keeps no named staging copy while producing or transferring, so a crash only closes the private descriptor", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "export-stage-test-"));
  let result: Awaited<ReturnType<typeof stageCustomerExport>> | undefined;
  try {
    result = await stageCustomerExport(async append => {
      expect(await readdir(root)).toEqual([]);
      await append('{"complete":true}');
    }, undefined, { root });
    expect(await readdir(root)).toEqual([]);
    expect(await new Response(result.stream).json()).toEqual({ complete: true });
  } finally { await result?.dispose(); await rm(root, { recursive: true }); }
});
it("aborts a timed-out producer and keeps capacity reserved until the producer actually stops", async () => {
  vi.useFakeTimers();
  let release!: () => void, entered!: () => void, count=0;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const signals:AbortSignal[]=[];
  const produce=async (_append:(text:string)=>Promise<void>,signal:AbortSignal)=>{signals.push(signal);if(++count===2)entered();await gate;};
  const pending=[stageCustomerExport(produce),stageCustomerExport(produce)];
  const settled=pending.map(result=>result.catch(()=>undefined));
  try {
    await started;await vi.advanceTimersByTimeAsync(120_000);
    expect(signals.every(signal=>signal?.aborted)).toBe(true);
    await expect(stageCustomerExport(async append=>append("{}"))).rejects.toMatchObject({code:"EXPORT_BUSY"});
    release();await Promise.all(settled);await vi.advanceTimersByTimeAsync(0);
    const next=await stageCustomerExport(async append=>append("{}"));await next.dispose();
  } finally {release();await Promise.all(settled);vi.useRealTimers();}
});
