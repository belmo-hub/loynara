import { spawn } from "node:child_process";
import path from "node:path";
import { z } from "zod";
import { DomainError } from "./loyalty";
const request = z.object({ scope:z.enum(["member","tenant"]),tenant_id:z.uuid(),member_id:z.uuid().nullable(),cutoff_at:z.iso.datetime(),intent_id:z.uuid() }).strict();
export type ClosureIntent = z.infer<typeof request>;
const required = ["ERASURE_S3_BUCKET","ERASURE_CLOSURE_S3_ENDPOINT","ERASURE_CLOSURE_S3_BUCKET","ERASURE_CLOSURE_S3_PREFIX","ERASURE_CLOSURE_NAMESPACE_ID","ERASURE_CLOSURE_AWS_ACCESS_KEY_ID","ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY"];
const unavailable = () => new DomainError("CLOSURE_ARCHIVE_UNAVAILABLE", "Closure could not be saved safely. Your card or business is still open; retry later or contact the privacy operator.");
/** Only the public encryption key and closure-bucket writer credentials enter this process. */
export async function recordClosureIntent(value: ClosureIntent, environment: Record<string, string | undefined> = process.env): Promise<void> {
  const intent=request.parse(value);
  if ((intent.scope==="member") !== (intent.member_id!==null)) throw new Error("Invalid closure scope");
  if (environment.ERASURE_POLICY_APPROVED!=="2026-10-15" || required.some(key=>!environment[key]) || !(environment.ERASURE_CLOSURE_AGE_RECIPIENT||environment.ERASURE_AGE_RECIPIENT)) throw unavailable();
  const keys=[...required,"ERASURE_POLICY_APPROVED","ERASURE_CLOSURE_AGE_RECIPIENT","ERASURE_AGE_RECIPIENT","ERASURE_S3_BUCKET","PATH","HOME","TMPDIR","LANG"];
  const env:NodeJS.ProcessEnv={...Object.fromEntries(keys.filter(key=>environment[key]!==undefined).map(key=>[key,environment[key]!])),NODE_ENV:"production"};
  await new Promise<void>((resolve,reject)=>{
    const child=spawn("python3",[path.resolve("scripts/erasure_manifest.py"),"record-closure"],{env,stdio:["pipe","ignore","ignore"]});
    let timedOut=false,settled=false;
    let forceKill:ReturnType<typeof setTimeout>|undefined;
    const timer=setTimeout(()=>{
      timedOut=true;
      child.kill("SIGTERM"); // The CLI kills and reaps its transport groups on TERM.
      forceKill=setTimeout(()=>{child.kill("SIGKILL");finish(unavailable());},2_000);
      forceKill.unref();
    },60_000);
    timer.unref();
    const cleanup=()=>{clearTimeout(timer);if(forceKill)clearTimeout(forceKill);};
    const finish=(error?:Error)=>{if(settled)return;settled=true;cleanup();if(error)reject(error);else resolve();};
    child.once("error",()=>finish(unavailable()));
    child.once("close",code=>finish(code===0&&!timedOut?undefined:unavailable()));
    child.stdin.on("error",()=>{});
    child.stdin.end(JSON.stringify(intent));
  });
}
