import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { spawn } from "node:child_process";
import { assertRetentionDatabaseIdentity, runRetentionChild, runRetentionCycle, startRetentionSchedule, type RetentionWork } from "./retention-job";
const candidate={scope:'member' as const,tenant_id:'00000000-0000-4000-8000-000000000001',membership_id:'00000000-0000-4000-8000-000000000002',cutoff:new Date()};
const identity={database:'synthetic',serverAddress:'127.0.0.1',serverPort:5432};
function work(overrides:Partial<RetentionWork>={}):RetentionWork {
 return {verifyTarget:async()=>{},lock:async()=>true,unlock:async()=>{},inactivity:async()=>({closed:0,flagged:0,cleaned:0}),prune:async()=>({rows:0}),candidates:async()=>[],erase:async()=>{},...overrides};
}
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
describe('retention target identity',()=>{
 it('accepts two actual server/database identities only when all fields match',()=>{expect(()=>assertRetentionDatabaseIdentity(identity,{...identity})).not.toThrow();});
 it.each([{...identity,database:'other'},{...identity,serverAddress:'127.0.0.2'},{...identity,serverPort:5433},{...identity,serverAddress:null},{...identity,serverPort:null},{...identity,database:''}])('refuses mismatched or incomplete actual identity %j',other=>{expect(()=>assertRetentionDatabaseIdentity(identity,other)).toThrow('database target');});
 it('refuses an incomplete runtime identity even when both missing values match',()=>{expect(()=>assertRetentionDatabaseIdentity({...identity,serverAddress:null},{...identity,serverAddress:null})).toThrow('database target');});
});
describe('retention job orchestration',()=>{
 it('verifies the target before acquiring locks or attempting any mutation',async()=>{
  const lock=vi.fn(async()=>true), inactivity=vi.fn(async()=>({closed:0,flagged:0,cleaned:0})),prune=vi.fn(async()=>({rows:0}));
  await expect(runRetentionCycle(work({verifyTarget:async()=>{throw Error('database target mismatch');},lock,inactivity,prune}))).rejects.toThrow('database target');
  expect(lock).not.toHaveBeenCalled();expect(inactivity).not.toHaveBeenCalled();expect(prune).not.toHaveBeenCalled();
 });
 it('serializes jobs and refuses to prune when another run owns the lock',async()=>{
  const inactivity=vi.fn(async()=>({closed:0,flagged:0,cleaned:0}));
  const result=await runRetentionCycle(work({lock:async()=>false,unlock:async()=>{throw Error('not owned');},inactivity}));
  expect(result).toEqual({skipped:true});expect(inactivity).not.toHaveBeenCalled();
 });
 it('drains full inactivity batches, every positive prune count and all candidate batches',async()=>{
  const inactivity=vi.fn().mockResolvedValueOnce({closed:50,flagged:0,cleaned:0}).mockResolvedValueOnce({closed:1,flagged:2,cleaned:0});
  const prune=vi.fn().mockResolvedValueOnce({first:1,second:0}).mockResolvedValueOnce({first:0,second:1}).mockResolvedValueOnce({first:0,second:0});
  const candidates=vi.fn().mockResolvedValueOnce([candidate]).mockResolvedValueOnce([candidate]).mockResolvedValueOnce([]),erase=vi.fn(async()=>{}),unlock=vi.fn(async()=>{});
  const result=await runRetentionCycle(work({inactivity,prune,candidates,erase,unlock}));
  expect(result).toEqual({skipped:false,closed:51,flagged:2,erased:2});expect(prune).toHaveBeenCalledTimes(3);expect(candidates).toHaveBeenCalledTimes(3);expect(erase).toHaveBeenCalledTimes(2);expect(unlock).toHaveBeenCalledOnce();expect(JSON.stringify(result)).not.toContain(candidate.membership_id);
 });
 it('drains bounded stale-review cleanup even when no card is closed or flagged',async()=>{
  const inactivity=vi.fn().mockResolvedValueOnce({closed:0,flagged:0,cleaned:50}).mockResolvedValueOnce({closed:0,flagged:0,cleaned:1});
  expect(await runRetentionCycle(work({inactivity}))).toMatchObject({skipped:false,closed:0,flagged:0});
  expect(inactivity).toHaveBeenCalledTimes(2);
 });
 it('stops at archival failure and releases the lock without a successful result',async()=>{
  const unlock=vi.fn(async()=>{}),erase=vi.fn(async()=>{throw Error('archive unavailable');});
  await expect(runRetentionCycle(work({candidates:async()=>[candidate,candidate],erase,unlock}))).rejects.toThrow('archive unavailable');
  expect(erase).toHaveBeenCalledOnce();expect(unlock).toHaveBeenCalledOnce();
 });
 it('refuses a queued purge when less than its cleanup-inclusive deadline remains',async()=>{
  let now=0;const erase=vi.fn(async()=>{}),unlock=vi.fn(async()=>{});
  await expect(runRetentionCycle(work({prune:async()=>{now=200_000;return {rows:0};},candidates:async()=>[candidate],erase,unlock}),{now:()=>now})).rejects.toThrow('budget');
  expect(erase).not.toHaveBeenCalled();expect(unlock).toHaveBeenCalledOnce();
 });
 it('fails ongoing prune backlog at the wall-clock deadline rather than reporting success',async()=>{
  let now=0;const candidates=vi.fn(async()=>[]),unlock=vi.fn(async()=>{});
  await expect(runRetentionCycle(work({prune:async()=>{now+=50_000;return {rows:1};},candidates,unlock}),{now:()=>now})).rejects.toThrow('budget');
  expect(candidates).not.toHaveBeenCalled();expect(unlock).toHaveBeenCalledOnce();
 });
 it('fails closed for invalid or empty pruning measurements',async()=>{
  await expect(runRetentionCycle(work({prune:async()=>({})}))).rejects.toThrow('measurement');
  await expect(runRetentionCycle(work({prune:async()=>({rows:-1})}))).rejects.toThrow('measurement');
 });
});
function fakeChild(){
 const child=new EventEmitter() as EventEmitter&{stdin:Writable;kill:ReturnType<typeof vi.fn>};let data='';
 child.stdin=new Writable({write(chunk,_encoding,done){data+=chunk.toString();done();}});child.kill=vi.fn(()=>true);
 const start=vi.fn(()=>child) as unknown as typeof spawn;
 return {child,start,data:()=>data};
}
describe('retention purge subprocess deadline',()=>{
 it('passes identifiers by stdin and accepts only an acknowledged zero exit',async()=>{
  const fake=fakeChild(),result=runRetentionChild(candidate,fake.start);
  expect(JSON.parse(fake.data())).toMatchObject({scope:'member',member_id:candidate.membership_id});
  fake.child.emit('close',0);await expect(result).resolves.toBeUndefined();
  expect(fake.start).toHaveBeenCalledWith('python3',expect.any(Array),expect.objectContaining({stdio:['pipe','ignore','ignore']}));
 });
 it('sends TERM at45seconds then KILL after2seconds and rejects without waiting forever',async()=>{
  vi.useFakeTimers();const fake=fakeChild(),result=runRetentionChild(candidate,fake.start);const failed=expect(result).rejects.toThrow('refused');
  await vi.advanceTimersByTimeAsync(45_000);expect(fake.child.kill).toHaveBeenCalledWith('SIGTERM');
  await vi.advanceTimersByTimeAsync(2_000);expect(fake.child.kill).toHaveBeenCalledWith('SIGKILL');await failed;
 });
 it('treats a zero exit after its deadline as failure and cancels escalation after cleanup',async()=>{
  vi.useFakeTimers();const fake=fakeChild(),result=runRetentionChild(candidate,fake.start);const failed=expect(result).rejects.toThrow('refused');
  await vi.advanceTimersByTimeAsync(45_000);fake.child.emit('close',0);await failed;
  await vi.advanceTimersByTimeAsync(2_000);expect(fake.child.kill).toHaveBeenCalledTimes(1);
 });
 it('does not pass runtime URLs, closure credentials or private archive keys to the purge child',async()=>{
  vi.stubEnv('DATABASE_URL','synthetic-runtime-secret');vi.stubEnv('ERASURE_AGE_IDENTITY_FILE','synthetic-private-key');vi.stubEnv('ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY','synthetic-closure-secret');
  const fake=fakeChild(),result=runRetentionChild(candidate,fake.start);fake.child.emit('close',0);await result;
  const passed=vi.mocked(fake.start).mock.calls[0][2]!;
  expect(passed.env).not.toHaveProperty('DATABASE_URL');expect(passed.env).not.toHaveProperty('ERASURE_AGE_IDENTITY_FILE');expect(passed.env).not.toHaveProperty('ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY');
 });
 it('rejects an invalid cutoff before starting a child process',async()=>{
  const fake=fakeChild();await expect(runRetentionChild({...candidate,cutoff:new Date('invalid')},fake.start)).rejects.toThrow('refused');expect(fake.start).not.toHaveBeenCalled();
 });
 it('withholds raw spawn diagnostics',async()=>{
  const fake=fakeChild(),result=runRetentionChild(candidate,fake.start);fake.child.emit('error',Error('synthetic private connection string'));
  await expect(result).rejects.toThrow('refused');
 });
});
describe('retention schedule',()=>{
 it('runs one cycle at a time every interval, kills an overrunning cycle and stops its child',async()=>{
  vi.useFakeTimers();const children:ReturnType<typeof fakeChild>['child'][]=[];
  const start=vi.fn(()=>{const {child}=fakeChild();children.push(child);return child;}) as unknown as typeof spawn;
  const stop=startRetentionSchedule({start,entryPoint:'synthetic.ts',execArgv:[],intervalMs:300_000,lifetimeMs:270_000,killGraceMs:5_000});
  expect(start).toHaveBeenCalledTimes(1);expect(vi.mocked(start).mock.calls[0][1]).toEqual(['synthetic.ts']);
  await vi.advanceTimersByTimeAsync(299_000);expect(start).toHaveBeenCalledTimes(1);
  expect(children[0].kill).toHaveBeenCalledWith('SIGTERM');children[0].emit('close',null);
  await vi.advanceTimersByTimeAsync(1_000);expect(start).toHaveBeenCalledTimes(2);
  children[1].emit('close',1);await vi.advanceTimersByTimeAsync(300_000);expect(start).toHaveBeenCalledTimes(3);
  const stopped=stop();expect(children[2].kill).toHaveBeenCalledWith('SIGTERM');children[2].emit('close',null);await stopped;
  await vi.advanceTimersByTimeAsync(600_000);expect(start).toHaveBeenCalledTimes(3);
 });
});
