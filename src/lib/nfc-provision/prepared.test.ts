import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import * as crypto from "node:crypto";
import { mkdtemp, writeFile, rm, chmod, symlink } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { normalizePreparedCustody, loadPreparedCustody, planSummary, planKeys, currentPlanKeys, assertApprovedPlan, disposePreparedPlan, planEvidence } from "./prepared";
import { analyseEvidence, type EvidenceEvent } from "./evidence";
import { simulatePreparedPlan, runPreparedPreview } from "./preview-run";

vi.mock("node:crypto", async importOriginal => {
 const actual = await importOriginal<typeof import("node:crypto")>();
 return { ...actual, randomBytes: vi.fn(actual.randomBytes) };
});

const hash=(s:Buffer|string)=>createHash("sha256").update(s).digest("hex");
function custody() {
 const uid="04000000000001",keyRef="dev_cpu_fixture",publicRef="abcdefghijklmnopqrstuvwx";
 const shared={classification:"TAG01_PREVIEW_NON_PRODUCTION",tag:"TAG-01",uid,keyRef,publicRef,origin:"https://preview.getloynara.com",keyModel:"five independent development AES-128 keys; no masters",expectedKeyVersions:[1,1,1,1,1]};
 const values=Object.fromEntries(["key0","fileReadKey","metaReadKey","key3","key4"].map((n,i)=>[n,Buffer.alloc(16,i+1).toString("hex")]));
 return {format:"LOY NARA TAG01 PREVIEW CUSTODY BACKUP v1",shared,admin:{...shared,role:"OPERATOR_ADMIN_ONLY",key0:values.key0,key3:values.key3,key4:values.key4},verification:{...shared,role:"PREVIEW_VERIFICATION_ONLY",fileReadKey:values.fileReadKey,metaReadKey:values.metaReadKey},transport:{...shared,role:"VERIFIED_CURRENT_TRANSPORT_STATE",...Object.fromEntries(Object.keys(values).map(k=>[k,Buffer.alloc(16).toString("hex")]))},binding:{tenantId:"11111111-1111-4111-8111-111111111111",locationId:"22222222-2222-4222-8222-222222222222",programId:"33333333-3333-4333-8333-333333333333",actorUserId:"44444444-4444-4444-8444-444444444444",cooldownSeconds:60,mode:"staff_confirmed"},fingerprints:Object.fromEntries(Object.entries(values).map(([n,v])=>[n,hash(Buffer.from(v,"hex"))])),authEvidence:{tag:"TAG-01",uid_match:"PASS",mutating_apdus_sent:0,authentication_attempts:[1,1,1,1,1],keys:[0,1,2,3,4].map(slot=>({slot,result:"PASS"}))},acceptanceEvidence:{tag:"TAG-01",uid}};
}
const normalize=(raw:unknown=custody())=>normalizePreparedCustody(raw,hash("cpu-encrypted-bundle"),"preview");

describe("prepared preview custody and immutable approval",()=>{
 it("preserves all five keys with no random generation and excludes them from serializable plans",()=>{
  const spy=vi.mocked(crypto.randomBytes);spy.mockClear();const raw=custody();const plan=normalize(raw);
  expect(spy).not.toHaveBeenCalled();
  expect(planKeys(plan).key0.toString("hex")).toBe(raw.admin.key0);
  expect(planKeys(plan).fileReadKey.toString("hex")).toBe(raw.verification.fileReadKey);
  expect(currentPlanKeys(plan).key0).toEqual(Buffer.alloc(16));
  expect(Object.isFrozen(plan)).toBe(true);expect(Object.isFrozen(plan.slots)).toBe(true);
  const log=JSON.stringify(planSummary(plan));expect(log).not.toContain(raw.shared.uid);expect(log).not.toContain(raw.admin.key0);expect(log).not.toContain(raw.verification.metaReadKey);
  disposePreparedPlan(plan);expect(()=>planKeys(plan)).toThrow(/CUSTODY/);
 });
 it.each(["uid","target","fingerprint","slots","versions","policy","binding","provenance"])("rejects %s corruption",field=>{
  const raw=custody();
  if(field==="uid")raw.admin.uid="04000000000002";
  if(field==="target")raw.shared.origin="https://getloynara.com";
  if(field==="fingerprint")raw.fingerprints.key0="a".repeat(64);
  if(field==="slots")delete (raw.admin as Partial<typeof raw.admin>).key4;
  if(field==="versions")raw.shared.expectedKeyVersions=[0,1,1,1,1];
  if(field==="policy")raw.binding.mode="automatic_fixed";
  if(field==="binding")raw.binding.tenantId="invalid";
  if(field==="provenance")raw.authEvidence.keys[2].result="FAIL";
  expect(()=>normalize(raw)).toThrow(/CUSTODY/);
 });
 it("rejects missing or incomplete custody without forwarding key-shaped input",()=>{
  for(const raw of [undefined,null,{},"deadbeef"])expect(()=>normalizePreparedCustody(raw,hash("cpu-encrypted-bundle"),"preview")).toThrow(/CUSTODY/);
 });
 it("requires the exact approved fingerprint and rejects production",()=>{
  const plan=normalize();expect(()=>assertApprovedPlan(plan,"0".repeat(64))).toThrow(/PLAN/);
  expect(()=>assertApprovedPlan(plan,plan.fingerprint)).not.toThrow();
  expect(()=>normalizePreparedCustody(custody(),hash("x"),"production")).toThrow(/CUSTODY/);
 });
 it("has deterministic fingerprints for identical plans and detects context changes",()=>{
  const plan=normalize();expect(normalize().fingerprint).toBe(plan.fingerprint);
  const changed=custody();changed.binding.cooldownSeconds=61;
  expect(normalize(changed).fingerprint).not.toBe(plan.fingerprint);
 });
 it("dry-run simulation consumes the exact approved plan and never calls physical transport",async()=>{
  const plan=normalize();const spy=vi.mocked(crypto.randomBytes);spy.mockClear();
  const proof=await simulatePreparedPlan(plan);expect(spy).not.toHaveBeenCalled();
  expect(proof.planFingerprint).toBe(plan.fingerprint);expect(proof.physicalApdus).toBe(0);
  expect(proof.mutations.map(m=>m.name)).toEqual(["ndef","key1","key2","key3","key4","settings","key0"]);
  expect(proof.verdict.state).toBe("complete");expect(proof.counters).toEqual([1,1,2]);
 });
 it.each(["writing_ndef","changing_key1","changing_key2","changing_key3","changing_key4","changing_settings","changing_key0"])("quarantines every interrupted %s without replacement credentials",async phase=>{
  const plan=normalize();const proof=await simulatePreparedPlan(plan,{interrupt:phase});
  expect(proof.verdict.state).toBe("uncertain");expect(proof.verdict).toMatchObject({openIntent:phase});
  expect(proof.physicalApdus).toBe(0);expect(proof.keyFingerprints).toEqual(plan.slots.map(s=>s.fingerprint));
 });
 it.each(["settings_changed","key0_changed","readback_verified"])("resume from %s reuses the original bundle and approved fingerprint",async phase=>{
  const plan=normalize();const result=await simulatePreparedPlan(plan,{interruptAfter:phase,resume:true});
  expect(result.resumed).toBe(true);expect(result.verdict.state).toBe("complete");
  expect(result.mutations.filter(m=>m.name==="key0")).toHaveLength(1);
  expect(result.planFingerprint).toBe(plan.fingerprint);
 });
 it.each(["wrongUid","wrongReservation","wrongBinding"] as const)("%s aborts before any simulated hardware write",async mismatch=>{
  const result=await simulatePreparedPlan(normalize(),{[mismatch]:true});expect(result.failure).toBe(true);expect(result.mutations).toEqual([]);
 });
 it("policy changed while owner confirms aborts before any tag mutation",async()=>{
  const result=await simulatePreparedPlan(normalize(),{policyDriftAfterConfirmation:true});expect(result.failure).toBe(true);expect(result.mutations).toEqual([]);
 });
 it.each(["writing_ndef","changing_key1","changing_key2","changing_key3","changing_key4","changing_settings","changing_key0"])("quarantines lost response AFTER %s took effect",async phase=>{
  const spy=vi.mocked(crypto.randomBytes);spy.mockClear();
  const result=await simulatePreparedPlan(normalize(),{loseAcknowledgement:phase,resume:true});
  expect(result.verdict).toMatchObject({state:"uncertain",openIntent:phase});expect(result.resumed).toBe(false);expect(spy).not.toHaveBeenCalled();
 });
 it("rejects an unapproved executor plan before transport or reservation",async()=>{
  const plan=normalize();const transmit=vi.fn();
  await expect(runPreparedPreview({plan,approvedFingerprint:"0".repeat(64),transport:{transmit},env:{},repository:{} as never,journal:{} as never,confirm:async()=>true})).rejects.toThrow(/PLAN/);
  expect(transmit).not.toHaveBeenCalled();
 });
 it.each(["planFingerprint","custodyId","slotFingerprints","settingsHex","policy","provenanceRef"])("resume rejects altered journal %s before transport, reservation or replacement keys",async field=>{
  const plan=normalize();const note={...planEvidence(plan),[field]:field==="planFingerprint"?"0".repeat(64):"different"};
  const stages=["confirmed","keys_saved","reserved","writing_ndef","ndef_written","changing_key1","key1_changed","changing_key2","key2_changed","changing_key3","key3_changed","changing_key4","key4_changed","keys_changed","changing_settings","settings_changed"];
  const events:EvidenceEvent[]=stages.map(name=>({at:"2026-10-05T10:00:00Z",kind:name.startsWith("changing_")||name==="writing_ndef"?"intent":"stage",name,note}));
  expect(analyseEvidence(events).state).toBe("resumable");
  const password="1".repeat(64),origin=plan.origin;
  const env={DATABASE_URL:`postgresql://looplocal_device:${password}@127.0.0.1:54331/looplocal_device_test`,DEVICE_TEST_DB_PASSWORD:password,DEVICE_TEST_APPROVED_ORIGIN:origin,PUBLIC_BASE_URL:origin,BETTER_AUTH_URL:origin,PUBLIC_REGISTRATION_ENABLED:"false",EXTERNAL_EMAIL_ENABLED:"false",LIVE_BILLING_ENABLED:"false",APPLE_WALLET_ENABLED:"false",GOOGLE_WALLET_ENABLED:"false"};
  const transmit=vi.fn(),checkTarget=vi.fn(),spy=vi.mocked(crypto.randomBytes);spy.mockClear();
  const journal={withExclusive:async<T>(_uid:string,fn:()=>Promise<T>)=>fn(),read:async()=>events,record:vi.fn(),verdict:async()=>analyseEvidence(events)};
  await expect(runPreparedPreview({plan,approvedFingerprint:plan.fingerprint,env,transport:{transmit},repository:{checkTarget} as never,journal,resume:true,confirm:async()=>true})).rejects.toThrow(/original|prepared plan|not repeated/i);
  expect(transmit).not.toHaveBeenCalled();expect(checkTarget).not.toHaveBeenCalled();expect(spy).not.toHaveBeenCalled();
 });
 it("age corruption, wrong identity and unrestricted files fail closed without secret output",async()=>{
  const folder=await mkdtemp(path.join(os.tmpdir(),"nfc-prepared-cpu-"));
  try {
   const id=path.join(folder,"identity"),wrong=path.join(folder,"wrong"),bundle=path.join(folder,"bundle.age");
   execFileSync("age-keygen",["-o",id],{stdio:["ignore","ignore","ignore"]});execFileSync("age-keygen",["-o",wrong],{stdio:["ignore","ignore","ignore"]});
   const recipient=execFileSync("age-keygen",["-y",id],{encoding:"utf8"}).trim();
   await writeFile(bundle,execFileSync("age",["-r",recipient],{input:JSON.stringify(custody())}),{mode:0o600});
   const plan=await loadPreparedCustody({bundlePath:bundle,identityPath:id,target:"preview"});expect(plan.tag).toBe("TAG-01");
   await expect(loadPreparedCustody({bundlePath:bundle,identityPath:wrong,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
   await chmod(bundle,0o644);
   await expect(loadPreparedCustody({bundlePath:bundle,identityPath:id,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
   await chmod(bundle,0o600);await chmod(id,0o644);
   await expect(loadPreparedCustody({bundlePath:bundle,identityPath:id,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
   await chmod(id,0o600);
   const link=path.join(folder,"bundle-link");await symlink(bundle,link);
   await expect(loadPreparedCustody({bundlePath:link,identityPath:id,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
   const identityLink=path.join(folder,"identity-link");await symlink(id,identityLink);
   await expect(loadPreparedCustody({bundlePath:bundle,identityPath:identityLink,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
   await writeFile(bundle,"corrupted ciphertext",{mode:0o600});
   await expect(loadPreparedCustody({bundlePath:bundle,identityPath:id,target:"preview"})).rejects.toThrow(/^CUSTODY_INVALID$/);
  } finally {await rm(folder,{recursive:true,force:true});}
 });
});
