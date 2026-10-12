import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repo = path.resolve(__dirname, "..");
const release = "43b54d2edbf5059d662ffa4aeb50ae6cced72ee9";
const supersededOnboardingRelease = "153928b10db55cbd0b40351116ee54515a6b107c";
const previousRelease = "ee4af7b79e9e4a667d383b0b9f815f31daa53956";
const current = "792e218a17287009067ce0993c33eda3bfc3f4b7";
const previousPinnedRelease = "519e1569195c20a01c8b55c3877dfc0ab0ca3463";
const utilitySource = "90ad26a0f3553c89f17ce5d07e8246591240b852";
const utilityDeployments: Record<string, string> = { backup: "dac712d4-3061-486f-9a0f-9677f87fcfe1", ops: "56bb5199-79e9-4b6b-8005-696c72769937" };
const ids = {
  web: "5c1303ad-42c2-4094-a996-3ac6140d088d", worker: "3bfad7e8-c638-41bd-8f50-743e68c0633f",
  migrate: "ba6a41c5-b9ee-463a-bc25-f7745c549f59", backup: "78ee0c58-c306-4f3a-95c0-1c94e72e793c",
  ops: "c3189719-e305-4c4c-b8ca-4d0b0335c25f", postgres: "7eb7c68b-c890-4f79-844f-f439f9fe0234",
  cloudflared: "131ff3f7-3eb8-4837-a9f9-694db14f623b",
};
function fixture() {
  const now = Date.now();
  const at = (offset: number) => new Date(now + offset).toISOString();
  return {
    version: 1, releaseSha: release,
    projectId: "b07a3919-b3fc-4637-8b91-d0b4418d2856", environmentId: "a3ba3a4a-3d4c-4149-91c4-735e8bae3447",
    operator: { id: "OPERATOR-A", reference: "OPERATOR-ATTESTATION-123", observedAt: at(-300_000), validUntil: at(1_800_000) },
    services: Object.entries(ids).map(([role, id]) => ({ role, id, currentGeneration: ["backup", "ops"].includes(role) ? utilitySource : current,
      plannedGeneration: ["web", "worker", "migrate", "ops"].includes(role) ? release : ["backup", "ops"].includes(role) ? utilitySource : current,
      repository: ["postgres", "cloudflared"].includes(role) ? "platform-image" : "belmo-hub/loynara",
      branch: ["web", "worker", "migrate"].includes(role) ? "railway-rc" : null,
      cronSchedule: role === "backup" ? "0 3 * * *" : role === "ops" ? "*/5 * * * *" : null,
      ...(["backup", "ops"].includes(role) ? { deploymentProvenance: { reference: "SYNTHETIC-DEPLOYMENT-RECEIPT-" + role, deploymentId: utilityDeployments[role], commitSha: utilitySource, branch: "railway-rc", independentlyVerified: true } } : {}),
      dockerfile: ["postgres", "cloudflared"].includes(role) ? null : role === "backup" ? "/Dockerfile.backup" : "/Dockerfile",
      startCommand: ({ web: null, worker: "npm run worker", migrate: "npm run production:migrate", backup: null, ops: "npm run production:ops-check", postgres: null, cloudflared: null } as Record<string, string | null>)[role],
      preDeployCommand: null,
    })),
    configuration: { reference: "CONFIG-123", stagedChanges: false, safeFlagsConfirmed: true, flags: {
      web: { APPLE_WALLET_ENABLED: false, GOOGLE_WALLET_ENABLED: false, PASSFAST_ENABLED: false, EXTERNAL_EMAIL_ENABLED: false, PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: false, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: false, LIVE_BILLING_ENABLED: false, WALLET_PRODUCTION_APPROVED: false, PUBLIC_REGISTRATION_ENABLED: false },
      worker: { APPLE_WALLET_ENABLED: false, GOOGLE_WALLET_ENABLED: false, PASSFAST_ENABLED: false, EXTERNAL_EMAIL_ENABLED: false, PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: false, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: false, LIVE_BILLING_ENABLED: false, WALLET_PRODUCTION_APPROVED: false, PUBLIC_REGISTRATION_ENABLED: false },
    } },
    writers: { complete: true, reference: "WRITERS-123", sources: ["web-http", "web-immediate-nfc", "worker-outbox", "worker-housekeeping", "migration-schema"], unaccounted: [] as string[] },
    exactCommit: { confirmed: true, reference: "EXACT-SHA-123", branchUnchanged: true },
    drain: { accepted: true, at: at(-240_000), reference: "DRAIN-123", allOldWritersStopped: true, inFlight: 0 },
    backup: { reference: "BACKUP-123", objectId: "loynara/2026/10/11/synthetic.dump.age", capturedAt: at(-180_000), bytes: 12345,
      schemaFingerprint: "e0996eb13fa3a48ef941e895e6ea1459c9c384cb2e5facc3a450c91332060d43", sha256: "a".repeat(64), encrypted: true, independentlyRetrieved: true, headVerified: true,
      sourceDatabase: "PRODUCTION-DB-123", sourceGeneration: current, keyCustodian: "CUSTODIAN-A", destination: "APPROVED-EU-R2-123",
      physicalSchema: { reference: "SOURCE-SCHEMA-123", criticalTablesPresent: true, tenantConstraintsAccepted: true, appendOnlyTriggerAccepted: true, structuresThrough0020Accepted: true } },
    restore: { accepted: true, reference: "RESTORE-123", at: at(-60_000), objectSha256: "a".repeat(64),
      target: "ISOLATED-DB-123", isolated: true, initiallyEmpty: true, approved: true, independentOperator: "WITNESS-B", integrityAccepted: true,
      schemaFingerprint: "e0996eb13fa3a48ef941e895e6ea1459c9c384cb2e5facc3a450c91332060d43",
      physicalSchema: { reference: "RESTORED-SCHEMA-123", criticalTablesPresent: true, tenantConstraintsAccepted: true, appendOnlyTriggerAccepted: true, structuresThrough0020Accepted: true },
      history: { reference: "RESTORED-HISTORY-123", sourceDatabase: "PRODUCTION-DB-123", membershipHistoryAccepted: true, ledgerHistoryAccepted: true, tenantIsolationAccepted: true, countsReconciled: true } },
    operationsUpgrade: { serviceId: ids.ops, sourceSha: release,
      configuration: { reference: "SYNTHETIC-OPS-CONFIG", accepted: true }, runtime: { reference: "SYNTHETIC-OPS-RUNTIME", accepted: true },
      monitor: { reference: "SYNTHETIC-OPS-MONITOR", accepted: true }, exactCommit: { reference: "SYNTHETIC-OPS-EXACT-COMMIT", accepted: true },
      deploymentAuthorization: "SYNTHETIC-FOUNDER-OPS-DEPLOYMENT" },
    authorizations: { backupRestore: "FOUNDER-BACKUP-RESTORE-123", deployment: "FOUNDER-DEPLOYMENT-123", releaseSha: release },
    currentJournal: { reference: "JOURNAL-123", rows: [["7274fc079d768a164d604dfe6fd4b0dee984b4901e8453aab35728990aa4418b",1790341790664],["1fa5daad714bf2251b8d25303f8aabc57f6a582f32ebe54c984204f44ea1570f",1790342756050],["b5c06f3836ebac94a19a01aff5ec2012480e8713f1e3bbd753baef4b23d4d957",1790342925349],["905c850059f6b951202af1746366244ac0512bb133d8343caff5f4771f73b5e9",1790343596440],["e6763bae245ddeba53620c6d01da0fcbaf899b9f3db3cb297e754a1d0761e5bc",1790345071657],["4cc008b7009677b83f1c8382d1b82e0d87f8b113941fda9e0d1541c483086b1a",1790345900549],["55ebba4eb685be271b35c0e1f24f96a0884886a9cc90aa3487a05d03e65d9e04",1790347449816],["e035e41c01021f2d26a828be3c3b5a893b182dfa0842a0f926cce36fa444cdfd",1790363870739],["20f0dce395bcb6dc19ef66b7009e679051c6cc17eb787589d17f960965c1fd9b",1790365412649],["0ee1bcce7b97bbd1d1d39cb50d0e250899d650d94100c56172b757e65f4487da",1790366483044],["4e7f1f0fe5be753665aac9033b7840fb37b104a8c3097e7be5cc032d1fec390f",1790367246298],["71c290984548b3da95fd8047dd2f942d01b6d9823f680af814a9924700d73084",1790368587151],["75f4e2ba01ab3a9b5c5ec26e7fdc143077bf0102cd5b76b028358a2c140e3140",1790373099963],["fff65e5c30f92fe82e4faaabf7079f7e38f2f97e30a4fe7caeaf0e602d21e3f6",1790374827104],["c8b7d0f723f2cd65db882f9cc9c0e798b255708ffea94431527a455145fc7ed5",1790477381106],["da4f40b74b3e63ae8a5c8eeb6093b7b3ce1aefb7db6140b87d4a64454d24b0be",1790477578300],["62c59eea31a550a4e53cb443a04846b9ffe85d4fb546ad6955e3dce6de208090",1790545967721],["19a8a0624a32bf269606e977234072ab31f6e9f2b727c0b79917a28d3bb59ff9",1790546708472],["abd0e28e8b223a5273ef884033ec99a16124876009b61bb5c1ebdd716884c7c8",1790956320487],["f7d1d53946c9cf309896b6368d5241c97974ce009c7e8471358515e3ff496c69",1791127119079],["943a8fe9066159fd75840cfb073e7b41be91da0e6646ce33c6dd9ab5508debbf",1791296519073]] },
  };
}
function run(evidence?: unknown, extra: string[] = [], repository = repo) {
  const dir = mkdtempSync(path.join(tmpdir(), "loynara-release-preflight-"));
  try {
    const trace = path.join(dir, "trace"); const preload = path.join(dir, "deny.cjs");
    writeFileSync(trace, "");
    writeFileSync(preload, String.raw`
      const fs = require('node:fs'); const { createRequire, syncBuiltinESMExports } = require('node:module');
      const record = value => fs.appendFileSync(process.env.PREFLIGHT_TRACE, value + '\n');
      const original = fs.readFileSync;
      fs.readFileSync = function(file, ...rest) { if (/(^|\/)\.env(?:\..*)?$/.test(String(file))) { record('dotenv'); throw new Error('Secret files forbidden'); } return original.call(this, file, ...rest); };
      createRequire(process.env.PREFLIGHT_REPO + '/package.json')('pg').Client.prototype.connect = async () => { record('database'); throw new Error('Database forbidden'); };
      require('node:child_process').spawn = () => { record('subprocess'); throw new Error('Mutation subprocess forbidden'); };
      globalThis.fetch = async () => { record('network'); throw new Error('Network forbidden'); }; syncBuiltinESMExports();
    `);
    const args = ["--release-preflight", "--repository", repository];
    if (evidence !== undefined) { const file = path.join(dir, "evidence.json"); writeFileSync(file, typeof evidence === "string" ? evidence : JSON.stringify(evidence)); args.push("--evidence", file); }
    const result = spawnSync(process.execPath, ["--require", preload, "--import", path.join(repo, "node_modules/tsx/dist/loader.mjs"), path.join(repo, "scripts/production-migrate.ts"), ...args, ...extra], {
      cwd: dir, env: { PATH: process.env.PATH, NODE_ENV: "development", PREFLIGHT_TRACE: trace, PREFLIGHT_REPO: repo,
        DATABASE_URL: "synthetic-private-connection", MIGRATION_DATABASE_URL: "synthetic-private-migration", PRODUCTION_MIGRATION_APPROVED: "true" },
      encoding: "utf8", timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.stdout, result.stderr).toContain('"status"');
    expect(readFileSync(trace, "utf8")).toBe("");
    expect(result.stdout + result.stderr).not.toMatch(/synthetic-private/);
    return { exit: result.status, output: JSON.parse(result.stdout) };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("offline release preflight through the existing migration CLI", () => {
  it("defaults to BLOCKED without operator evidence and performs no secret, database or network reads", () => {
    const r = run(); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
    expect(r.output.releaseSha).toBe(release); expect(r.output.executionEnabled).toBe(false);
    expect(r.output.source.status).toBe("PASS");
    expect(r.output.source.pendingMigrations.map((v: { tag: string }) => v.tag)).toEqual([
      "0021_staff_push_subscriptions", "0022_email_rate_limit_retry", "0023_reward_ready_automation", "0024_outbox_claim_token",
    ]);
    expect(r.output.writerInventory.map((v: { id: string }) => v.id)).toContain("web-immediate-nfc");
  });
  it("validates complete synthetic declarations for the newly reviewed staff-revocation release", () => {
    const e = fixture(), selected = "43b54d2edbf5059d662ffa4aeb50ae6cced72ee9";
    e.releaseSha = selected; e.authorizations.releaseSha = selected; e.operationsUpgrade.sourceSha = selected;
    for (const service of e.services) if (["web", "worker", "migrate", "ops"].includes(service.role)) service.plannedGeneration = selected;
    const r = run(e); expect(r.exit, JSON.stringify(r.output)).toBe(0); expect(r.output.executionEnabled).toBe(false);
  });
  it("pins the newly reviewed staff-revocation application rather than the previous candidate", () => {
    expect(run().output.releaseSha).toBe("43b54d2edbf5059d662ffa4aeb50ae6cced72ee9");
  });
  it("binds the reviewed application snapshot independently of later local tooling commits", () => {
    const r = run(fixture()); expect(r.exit, JSON.stringify(r.output)).toBe(0);
    expect(r.output.releaseSha).toBe(release); expect(r.output.executionEnabled).toBe(false);
    expect(r.output.source.fingerprints).toEqual(expect.arrayContaining([
      { file: "src/app/cashier/page.tsx", sha256: "ee85d2496bc117de873d949eeae573d2fadef251e299e638cfb788fd19f796d4" },
      { file: "src/lib/product.ts", sha256: "79e6fb6daa4dc6f94a2e01fa951b89d2cc0f73b4e5dd22b34da73f3412ac3252" },
      { file: "src/lib/staff-push.ts", sha256: "21490c4d8d2b96cfd03701cbf771d4f35c4db063c262a7ae3d19cc6581165ae7" },
      { file: "src/components/owner/owner-context.tsx", sha256: "42effe679c1fb55b92a87621772fee9eb8d054d5f68516b932df65c34bea8b72" },
      { file: "src/components/owner/program-setup.tsx", sha256: "3de9d7dfa17ec494af3c4d6dd36d8374943f3af91d5acec4fd141de9de90fcc6" },
      { file: "scripts/production-restore-check.sh", sha256: "f4f46d4a93db6a20be23860f3844170b6d9173fd4d0f7d6e196082698621adac" },
    ]));
    expect(r.output.source.fingerprints.map((v: { file: string }) => v.file)).toEqual(expect.arrayContaining([
      "package.json", "package-lock.json", "marketing-site/package.json", "marketing-site/package-lock.json",
      "scripts/config-check.ts", "scripts/ops-heartbeat.ts", "scripts/operational-error.ts",
    ]));
  });
  it("rejects complete declarations that retain the superseded onboarding-only release", () => {
    const e = fixture(); e.releaseSha = previousPinnedRelease; e.authorizations.releaseSha = previousPinnedRelease; e.operationsUpgrade.sourceSha = previousPinnedRelease;
    for (const service of e.services) if (["web", "worker", "migrate", "ops"].includes(service.role)) service.plannedGeneration = previousPinnedRelease;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED"); expect(r.output.executionEnabled).toBe(false); expect(r.output.releaseSha).toBe(release);
  });
  it.each(["web", "worker", "migrate", "ops"])("rejects a superseded onboarding-only planned %s generation", role => {
    const e = fixture(); e.services.find(service => service.role === role)!.plannedGeneration = previousPinnedRelease;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED"); expect(r.output.executionEnabled).toBe(false);
  });
  it("rejects receipts for the superseded release without echoing them or enabling execution", () => {
    const e = fixture(); e.releaseSha = previousRelease; e.authorizations.releaseSha = previousRelease;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
    expect(r.output.releaseSha).toBe(release); expect(r.output.executionEnabled).toBe(false);
    expect(JSON.stringify(r.output)).not.toContain(previousRelease);
  });
  it.each(["web", "worker", "migrate"])("rejects the superseded planned %s generation", role => {
    const e = fixture(); e.services.find(v => v.role === role)!.plannedGeneration = previousRelease;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
    expect(r.output.executionEnabled).toBe(false);
  });
  it("rejects the previous onboarding generation and old fingerprint override claims", () => {
    const old = fixture(); old.releaseSha = supersededOnboardingRelease; old.authorizations.releaseSha = supersededOnboardingRelease;
    for (const service of old.services) if (["web", "worker", "migrate"].includes(service.role)) service.plannedGeneration = supersededOnboardingRelease;
    const r = run(old); expect(r.exit).toBe(2); expect(r.output.executionEnabled).toBe(false); expect(r.output.releaseSha).toBe(release);
    const override = { ...fixture(), sourceFingerprints: [{ file: "src/components/owner/owner-context.tsx", sha256: "e0fa80bf127251122bdd480f508ca2b11945b6c02aad1221ece1812a97f599aa" }] };
    const rejected = run(override); expect(rejected.exit).toBe(2); expect(rejected.output.executionEnabled).toBe(false);
  });
  it.each(["web", "worker", "migrate"])("rejects the previous onboarding planned %s generation", role => {
    const e = fixture(); e.services.find(v => v.role === role)!.plannedGeneration = supersededOnboardingRelease;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.executionEnabled).toBe(false);
  });
  it("refuses a release receipt that leaves the older operations safeguards outside the coordinated rollout", () => {
    const e = fixture();
    delete (e as Partial<typeof e>).operationsUpgrade;
    e.services.find(service => service.role === "ops")!.plannedGeneration = utilitySource;
    const r = run(e);
    expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED"); expect(r.output.executionEnabled).toBe(false);
  });
  it("requires source-scoped operations compatibility, eligibility and deployment evidence", () => {
    const mutations: Array<[string, (e: ReturnType<typeof fixture>) => void]> = [
      ["wrong service", e => { e.operationsUpgrade.serviceId = ids.worker; }],
      ["old source", e => { e.operationsUpgrade.sourceSha = utilitySource; }],
      ["unknown source", e => { e.operationsUpgrade.sourceSha = "b".repeat(40); }],
      ["old planned ops", e => { e.services.find(service => service.role === "ops")!.plannedGeneration = utilitySource; }],
      ["unknown planned ops", e => { e.services.find(service => service.role === "ops")!.plannedGeneration = "b".repeat(40); }],
      ["missing authority", e => { e.operationsUpgrade.deploymentAuthorization = ""; }],
      ["backup authority reused", e => { e.operationsUpgrade.deploymentAuthorization = e.authorizations.backupRestore; }],
    ];
    for (const field of ["configuration", "runtime", "monitor", "exactCommit"] as const) {
      mutations.push([`${field} unknown`, e => { delete (e.operationsUpgrade as Partial<typeof e.operationsUpgrade>)[field]; }]);
      mutations.push([`${field} unaccepted`, e => { e.operationsUpgrade[field].accepted = false; }]);
      mutations.push([`${field} missing reference`, e => { e.operationsUpgrade[field].reference = ""; }]);
    }
    for (const [name, mutate] of mutations) {
      const e = fixture(); mutate(e);
      const r = run(e); expect(r.exit, name).toBe(2); expect(r.output.status, name).toBe("BLOCKED"); expect(r.output.executionEnabled, name).toBe(false);
    }
  });
  it("orders explicit pinned operations deployment and verification before final health and reopening", () => {
    const operations = run().output.orderedOperations as string[];
    expect(operations).toContain("deploy-pinned-ops-under-separate-authorization");
    expect(operations).toContain("verify-ops-source-safe-config-and-acknowledged-heartbeat");
    expect(operations.indexOf("deploy-pinned-ops-under-separate-authorization")).toBeGreaterThan(operations.indexOf("deploy-identical-pinned-worker"));
    expect(operations.indexOf("verify-ops-source-safe-config-and-acknowledged-heartbeat")).toBeLessThan(operations.indexOf("verify-no-old-writers-and-health"));
  });
  it("accepts accurate known branchless utility metadata only with exact independently attested deployed provenance", () => {
    const e = fixture();
    expect(e.services.find(v => v.role === "backup")!.branch).toBeNull();
    expect(e.services.find(v => v.role === "ops")!.branch).toBeNull();
    const r = run(e); expect(r.exit).toBe(0); expect(r.output.status).toBe("PASS"); expect(r.output.executionEnabled).toBe(false);
  });
  it.each(["backup", "ops"])("keeps %s utility provenance and configuration fail-closed", role => {
    const mutations: Array<[string, (service: ReturnType<typeof fixture>["services"][number]) => void]> = [
      ["wrong repository", service => { service.repository = "unreviewed/repository"; }],
      ["invented connected branch", service => { service.branch = "railway-rc"; }],
      ["missing provenance", service => { delete service.deploymentProvenance; }],
      ["missing generation", service => { delete (service as Record<string, unknown>).currentGeneration; }],
      ["unknown generation", service => { service.currentGeneration = "b".repeat(40); }],
      ["unreviewed planned generation", service => { service.plannedGeneration = role === "ops" ? utilitySource : release; }],
      ["unverified provenance", service => { service.deploymentProvenance!.independentlyVerified = false; }],
      ["wrong provenance generation", service => { service.deploymentProvenance!.commitSha = release; }],
      ["wrong deployment identity", service => { service.deploymentProvenance!.deploymentId = "00000000-0000-4000-8000-000000000009"; }],
      ["swapped deployment identity", service => { service.deploymentProvenance!.deploymentId = utilityDeployments[role === "backup" ? "ops" : "backup"]; }],
      ["missing provenance reference", service => { service.deploymentProvenance!.reference = ""; }],
      ["wrong Dockerfile", service => { service.dockerfile = "/unreviewed.Dockerfile"; }],
      ["wrong start command", service => { service.startCommand = "npm start"; }],
      ["wrong cron", service => { service.cronSchedule = "* * * * *"; }],
      ["missing cron", service => { delete (service as Record<string, unknown>).cronSchedule; }],
    ];
    for (const [name, mutate] of mutations) {
      const e = fixture(); mutate(e.services.find(v => v.role === role)!);
      const r = run(e); expect(r.exit, name).toBe(2); expect(r.output.status, name).toBe("BLOCKED"); expect(r.output.executionEnabled, name).toBe(false);
    }
  });
  it.each(["web", "worker", "migrate"])("does not accept a branchless or scheduled connected %s role", role => {
    for (const mode of ["branchless", "wrong branch", "scheduled"]) {
      const e = fixture(); const service = e.services.find(v => v.role === role)!;
      if (mode === "branchless") service.branch = null;
      else if (mode === "wrong branch") service.branch = "unreviewed-branch";
      else service.cronSchedule = "* * * * *";
      const r = run(e); expect(r.exit, mode).toBe(2); expect(r.output.executionEnabled, mode).toBe(false);
    }
  });
  it("validates a complete synthetic evidence manifest without granting execution authority", () => {
    const r = run(fixture()); expect(r.exit, JSON.stringify(r.output)).toBe(0);
    expect(r.output.status).toBe("PASS"); expect(r.output.executionEnabled).toBe(false);
    expect(r.output.evidenceBasis).toBe("DECLARED_OPERATOR_EVIDENCE_REQUIRES_AUTHENTICATION");
  });
  it("refuses journal-only evidence without source and restored physical schema/history acceptance", () => {
    const e = fixture();
    delete (e.backup as Record<string, unknown>).physicalSchema;
    delete (e.restore as Record<string, unknown>).physicalSchema;
    delete (e.restore as Record<string, unknown>).history;
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
  });
  it.each(["backup", "restore", "writers", "authorizations"])("refuses missing %s evidence", field => {
    const e = fixture() as Record<string, unknown>; delete e[field];
    const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
  });
  it.each([
    ["unknown writers", (e: ReturnType<typeof fixture>) => { e.writers.complete = false; }],
    ["unaccounted writer", (e: ReturnType<typeof fixture>) => { e.writers.unaccounted.push("UNKNOWN-JOB"); }],
    ["missing immediate NFC", (e: ReturnType<typeof fixture>) => { e.writers.sources = e.writers.sources.filter(v => v !== "web-immediate-nfc"); }],
    ["unaccepted restoration", (e: ReturnType<typeof fixture>) => { e.restore.accepted = false; }],
    ["same operator witness", (e: ReturnType<typeof fixture>) => { e.restore.independentOperator = e.operator.id; }],
    ["production restore target", (e: ReturnType<typeof fixture>) => { e.restore.target = e.backup.sourceDatabase; }],
    ["backup only HEAD verified", (e: ReturnType<typeof fixture>) => { e.backup.independentlyRetrieved = false; }],
    ["backup before drain", (e: ReturnType<typeof fixture>) => { e.backup.capturedAt = new Date(Date.parse(e.drain.at) - 1000).toISOString(); }],
    ["wrong restore object", (e: ReturnType<typeof fixture>) => { e.restore.objectSha256 = "b".repeat(64); }],
    ["writer still running", (e: ReturnType<typeof fixture>) => { e.drain.allOldWritersStopped = false; }],
    ["in-flight claim", (e: ReturnType<typeof fixture>) => { e.drain.inFlight = 1; }],
    ["different planned worker source", (e: ReturnType<typeof fixture>) => { e.services.find(v => v.role === "worker")!.plannedGeneration = current; }],
    ["different current web source", (e: ReturnType<typeof fixture>) => { e.services.find(v => v.role === "web")!.currentGeneration = release; }],
    ["wrong worker command", (e: ReturnType<typeof fixture>) => { e.services.find(v => v.role === "worker")!.startCommand = "npm start"; }],
    ["unexpected predeploy", (e: ReturnType<typeof fixture>) => { e.services.find(v => v.role === "web")!.preDeployCommand = "npm run production:migrate" as never; }],
    ["staged configuration", (e: ReturnType<typeof fixture>) => { e.configuration.stagedChanges = true; }],
    ["missing worker flag", (e: ReturnType<typeof fixture>) => { delete (e.configuration.flags.worker as Record<string, unknown>).TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED; }],
    ["wrong backup schema", (e: ReturnType<typeof fixture>) => { e.backup.schemaFingerprint = "0".repeat(64); }],
    ["missing source physical schema", (e: ReturnType<typeof fixture>) => { delete (e.backup as Record<string, unknown>).physicalSchema; }],
    ["unaccepted source trigger", (e: ReturnType<typeof fixture>) => { e.backup.physicalSchema.appendOnlyTriggerAccepted = false; }],
    ["unknown source constraints", (e: ReturnType<typeof fixture>) => { (e.backup.physicalSchema as Record<string, unknown>).tenantConstraintsAccepted = "UNKNOWN"; }],
    ["missing restored physical schema", (e: ReturnType<typeof fixture>) => { delete (e.restore as Record<string, unknown>).physicalSchema; }],
    ["unaccepted restored structures", (e: ReturnType<typeof fixture>) => { e.restore.physicalSchema.structuresThrough0020Accepted = false; }],
    ["wrong restored journal", (e: ReturnType<typeof fixture>) => { e.restore.schemaFingerprint = "b".repeat(64); }],
    ["missing restored tenant history", (e: ReturnType<typeof fixture>) => { delete (e.restore as Record<string, unknown>).history; }],
    ["unaccepted restored ledger history", (e: ReturnType<typeof fixture>) => { e.restore.history.ledgerHistoryAccepted = false; }],
    ["unknown restored tenant isolation", (e: ReturnType<typeof fixture>) => { (e.restore.history as Record<string, unknown>).tenantIsolationAccepted = "UNKNOWN"; }],
    ["unreconciled restored counts", (e: ReturnType<typeof fixture>) => { e.restore.history.countsReconciled = false; }],
    ["restored history from another database", (e: ReturnType<typeof fixture>) => { e.restore.history.sourceDatabase = "OTHER-DB-123"; }],
    ["same authorization receipt", (e: ReturnType<typeof fixture>) => { e.authorizations.deployment = e.authorizations.backupRestore; }],
    ["unknown flags", (e: ReturnType<typeof fixture>) => { e.configuration.safeFlagsConfirmed = false; }],
    ["unverified exact-SHA eligibility", (e: ReturnType<typeof fixture>) => { e.exactCommit.confirmed = false; }],
    ["wrong release approval", (e: ReturnType<typeof fixture>) => { e.authorizations.releaseSha = current; }],
    ["stale attestation", (e: ReturnType<typeof fixture>) => { e.operator.observedAt = new Date(Date.now() - 7_200_000).toISOString(); }],
    ["unbounded attestation", (e: ReturnType<typeof fixture>) => { e.operator.validUntil = new Date(Date.now() + 86_400_000).toISOString(); }],
    ["expired attestation", (e: ReturnType<typeof fixture>) => { e.operator.validUntil = new Date(Date.now() - 1000).toISOString(); }],
    ["unverified journal", (e: ReturnType<typeof fixture>) => { e.currentJournal.rows[0][0] = "0".repeat(64); }],
  ])("blocks %s", (_name, mutate) => { const e = fixture(); mutate(e); const r = run(e); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED"); });
  it.each(["{bad json", '{"secret":"synthetic-private-token"}'])("sanitizes malformed or unrecognized input", input => {
    const r = run(input); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED");
    expect(JSON.stringify(r.output)).not.toContain("synthetic-private-token");
  });
  it("blocks an unavailable pinned candidate even with complete declared evidence", () => { const r = run(fixture(), [], tmpdir()); expect(r.exit).toBe(2); expect(r.output.source.status).toBe("BLOCKED"); });
  it("refuses an execution flag without falling into migration", () => { const r = run(fixture(), ["--execute"]); expect(r.exit).toBe(2); expect(r.output.status).toBe("BLOCKED"); });
});
