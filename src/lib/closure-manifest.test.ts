import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.unmock("./closure-manifest");
const spawn = vi.hoisted(()=>vi.fn());
vi.mock("node:child_process",()=>({spawn}));
import { recordClosureIntent } from "./closure-manifest";
const intent={scope:'member' as const,tenant_id:'00000000-0000-4000-8000-000000000001',member_id:'00000000-0000-4000-8000-000000000002',cutoff_at:'2026-10-15T00:00:00.000Z',intent_id:'00000000-0000-4000-8000-000000000003'};
const env={NODE_ENV:'test' as const,ERASURE_POLICY_APPROVED:'2026-10-15',ERASURE_S3_BUCKET:'synthetic-purge',ERASURE_CLOSURE_S3_ENDPOINT:'https://synthetic.example.test',ERASURE_CLOSURE_S3_BUCKET:'synthetic-closure',ERASURE_CLOSURE_S3_PREFIX:'closures',ERASURE_CLOSURE_NAMESPACE_ID:intent.tenant_id,ERASURE_CLOSURE_AWS_ACCESS_KEY_ID:'synthetic-writer',ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY:'synthetic-key',ERASURE_AGE_RECIPIENT:'synthetic-public-recipient',DATABASE_URL:'synthetic-private-database',ERASURE_AGE_IDENTITY_FILE:'synthetic-private-key',ERASURE_AWS_SECRET_ACCESS_KEY:'synthetic-purge-key'};
beforeEach(()=>spawn.mockReset());
afterEach(()=>vi.useRealTimers());
function child(code:number|null){const process=new EventEmitter() as EventEmitter&{stdin:Writable};let data='';process.stdin=new Writable({write(chunk,_encoding,done){data+=chunk.toString();done();},final(done){if(code!==null)queueMicrotask(()=>process.emit('close',code));done();}});return {process,data:()=>data};}
describe('closure archive transport boundary',()=>{
 it('refuses missing activation/configuration before creating a child',async()=>{await expect(recordClosureIntent(intent,{})).rejects.toMatchObject({code:'CLOSURE_ARCHIVE_UNAVAILABLE'});expect(spawn).not.toHaveBeenCalled();});
 it('sends only validated identifiers and excludes runtime database/purge/private-key secrets',async()=>{const fake=child(0);spawn.mockReturnValue(fake.process);await recordClosureIntent(intent,env);expect(JSON.parse(fake.data())).toEqual(intent);const passed=spawn.mock.calls[0][2];expect(passed.env).not.toHaveProperty('DATABASE_URL');expect(passed.env).not.toHaveProperty('ERASURE_AGE_IDENTITY_FILE');expect(passed.env).not.toHaveProperty('ERASURE_AWS_SECRET_ACCESS_KEY');expect(passed.stdio).toEqual(['pipe','ignore','ignore']);});
 it('refuses an unacknowledged upload without external diagnostics',async()=>{spawn.mockReturnValue(child(1).process);await expect(recordClosureIntent(intent,env)).rejects.toMatchObject({code:'CLOSURE_ARCHIVE_UNAVAILABLE'});});
 it('rejects accidental contact fields or inconsistent tenant scope',async()=>{await expect(recordClosureIntent({...intent,email:'private@example.test'} as typeof intent,env)).rejects.toThrow();await expect(recordClosureIntent({...intent,scope:'tenant'},env)).rejects.toThrow('Invalid closure scope');expect(spawn).not.toHaveBeenCalled();});
 it('terminates politely, allows cleanup, and rejects even a late success after the deadline',async()=>{
  vi.useFakeTimers();const fake=child(null);const kill=vi.fn();Object.assign(fake.process,{kill});spawn.mockReturnValue(fake.process);
  const pending=recordClosureIntent(intent,env);const assertion=expect(pending).rejects.toMatchObject({code:'CLOSURE_ARCHIVE_UNAVAILABLE'});
  await vi.advanceTimersByTimeAsync(60_000);expect(kill.mock.calls).toEqual([['SIGTERM']]);
  fake.process.emit('close',0);await assertion;
  await vi.advanceTimersByTimeAsync(2_000);expect(kill.mock.calls).toEqual([['SIGTERM']]);
 });
 it('forces termination only after the cleanup grace period',async()=>{
  vi.useFakeTimers();const fake=child(null);const kill=vi.fn();Object.assign(fake.process,{kill});spawn.mockReturnValue(fake.process);
  const pending=recordClosureIntent(intent,env);const assertion=expect(pending).rejects.toMatchObject({code:'CLOSURE_ARCHIVE_UNAVAILABLE'});
  await vi.advanceTimersByTimeAsync(61_999);expect(kill.mock.calls).toEqual([['SIGTERM']]);
  await vi.advanceTimersByTimeAsync(1);expect(kill.mock.calls).toEqual([['SIGTERM'],['SIGKILL']]);
  await assertion;
 });

});
