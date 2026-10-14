import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// This is an offline evidence validator. It has no execution or transport adapter.
// Immutable reviewed application source (43b54d2 plus the motion dependency build correction); later release-tooling/ledger commits do not move this pin.
// 43b54d2edbf5059d662ffa4aeb50ae6cced72ee9 failed its clean Docker build (TS2307, motion) and is not a releasable generation.
// No CLI or environment override may select a different release generation.
export const RELEASE_SHA = "a436b77dff8b46628d0694f277e5d8474ce802fc";
const PROJECT = "b07a3919-b3fc-4637-8b91-d0b4418d2856";
const ENVIRONMENT = "a3ba3a4a-3d4c-4149-91c4-735e8bae3447";
const reference = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9./:_-]{2,199}$/).refine(v => !/^(unknown|tbd|pending|placeholder)$/i.test(v));
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const instant = z.string().datetime({ offset: true });
const generation = z.union([sha, z.string().regex(/^sha256:[0-9a-f]{64}$/)]);
const flags = z.object({ NFC_ENABLED: z.literal(false), APPLE_WALLET_ENABLED: z.literal(false), GOOGLE_WALLET_ENABLED: z.literal(false), PASSFAST_ENABLED: z.literal(false),
  EXTERNAL_EMAIL_ENABLED: z.literal(false), PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: z.literal(false), TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: z.literal(false),
  LIVE_BILLING_ENABLED: z.literal(false), WALLET_PRODUCTION_APPROVED: z.literal(false), PUBLIC_REGISTRATION_ENABLED: z.literal(false) }).strict();
// Configured branch and deployed build provenance are separate facts. These
// utility snapshots were independently observed via Railway read-only metadata.
// They are current-baseline identities, not permission to deploy another source.
const utilityDeployments = {
  backup: { deploymentId: "be445944-e1e5-4f3b-beb6-5b66cfb4db87", commitSha: "90ad26a0f3553c89f17ce5d07e8246591240b852" },
  ops: { deploymentId: "56bb5199-79e9-4b6b-8005-696c72769937", commitSha: "90ad26a0f3553c89f17ce5d07e8246591240b852" },
} as const;
const utilityProvenance = z.object({ reference, deploymentId: z.string().uuid(), commitSha: sha,
  branch: z.literal("railway-rc"), independentlyVerified: z.literal(true) }).strict();
const serviceSchema = z.object({
  role: z.enum(["web", "worker", "migrate", "backup", "ops", "postgres", "cloudflared"]), id: z.string().uuid(),
  currentGeneration: generation, plannedGeneration: generation, repository: z.enum(["belmo-hub/loynara", "platform-image"]),
  branch: z.enum(["railway-rc"]).nullable(), dockerfile: z.enum(["/Dockerfile", "/Dockerfile.backup"]).nullable(),
  startCommand: z.string().max(100).nullable(), preDeployCommand: z.string().max(100).nullable(),
  cronSchedule: z.string().max(100).nullable(), deploymentProvenance: utilityProvenance.optional(),
}).strict();
const physicalSchema = z.object({ reference, criticalTablesPresent: z.literal(true), tenantConstraintsAccepted: z.literal(true),
  appendOnlyTriggerAccepted: z.literal(true), structuresThrough0020Accepted: z.literal(true) }).strict();
const evidenceSchema = z.object({
  version: z.literal(1), releaseSha: z.literal(RELEASE_SHA), projectId: z.literal(PROJECT), environmentId: z.literal(ENVIRONMENT),
  operator: z.object({ id: reference, reference, observedAt: instant, validUntil: instant }).strict(),
  services: z.array(serviceSchema).length(7),
  configuration: z.object({ reference, stagedChanges: z.literal(false), safeFlagsConfirmed: z.literal(true), flags: z.object({ web: flags, worker: flags }).strict() }).strict(),
  writers: z.object({ complete: z.literal(true), reference, sources: z.array(reference), unaccounted: z.array(reference).length(0) }).strict(),
  exactCommit: z.object({ confirmed: z.literal(true), reference, branchUnchanged: z.literal(true) }).strict(),
  drain: z.object({ accepted: z.literal(true), at: instant, reference, allOldWritersStopped: z.literal(true), inFlight: z.literal(0) }).strict(),
  backup: z.object({ reference, objectId: reference, capturedAt: instant, bytes: z.number().int().positive(), schemaFingerprint: digest, sha256: digest,
    encrypted: z.literal(true), independentlyRetrieved: z.literal(true), headVerified: z.literal(true),
    sourceDatabase: reference, sourceGeneration: sha, keyCustodian: reference, destination: reference, physicalSchema }).strict().optional(),
  restore: z.object({ accepted: z.literal(true), reference, at: instant, objectSha256: digest, target: reference,
    isolated: z.literal(true), initiallyEmpty: z.literal(true), approved: z.literal(true), independentOperator: reference, integrityAccepted: z.literal(true), schemaFingerprint: digest, physicalSchema,
    history: z.object({ reference, sourceDatabase: reference, membershipHistoryAccepted: z.literal(true), ledgerHistoryAccepted: z.literal(true),
      tenantIsolationAccepted: z.literal(true), countsReconciled: z.literal(true) }).strict() }).strict().optional(),
  // A utility rollout is not implied by a web/worker deployment or a missing connected branch.
  // This declaration must be authenticated separately; unknown runtime/configuration stays blocking.
  operationsUpgrade: z.object({ serviceId: z.literal("c3189719-e305-4c4c-b8ca-4d0b0335c25f"), sourceSha: z.literal(RELEASE_SHA),
    configuration: z.object({ reference, accepted: z.literal(true) }).strict(),
    runtime: z.object({ reference, accepted: z.literal(true) }).strict(),
    monitor: z.object({ reference, accepted: z.literal(true) }).strict(),
    exactCommit: z.object({ reference, accepted: z.literal(true) }).strict(),
    deploymentAuthorization: reference }).strict(),
  backupUpgrade: z.object({ serviceId: z.literal("78ee0c58-c306-4f3a-95c0-1c94e72e793c"), sourceSha: z.literal(RELEASE_SHA),
    configuration: z.object({ reference, accepted: z.literal(true) }).strict(),
    runtime: z.object({ reference, accepted: z.literal(true) }).strict(),
    monitor: z.object({ reference, accepted: z.literal(true) }).strict(),
    exactCommit: z.object({ reference, accepted: z.literal(true) }).strict(),
    deploymentAuthorization: reference }).strict().optional(),
  backupSnapshotTransition: z.object({ reference,
    baselineDeploymentId: z.literal(utilityDeployments.backup.deploymentId), deploymentId: z.string().uuid(),
    sourceSha: z.literal(utilityDeployments.backup.commitSha), objectSha256: digest, at: instant,
    configurationRestored: z.literal(true) }).strict().optional(),
  founderRestoreAcceptance: z.object({ reference, founderId: reference, at: instant, objectSha256: digest,
    releaseSha: z.literal(RELEASE_SHA) }).strict().optional(),
  authorizations: z.object({ scope: z.object({ backupRestore: z.boolean(), cutover: z.literal(true),
    utilityUpgrades: z.literal(true), exactShaOnly: z.literal(true) }).strict(), backupRestore: reference.optional(), deployment: reference, releaseSha: z.literal(RELEASE_SHA) }).strict(),
  currentPhysicalSchema: physicalSchema.optional(),
  backupPreservation: z.object({ reference, compatible: z.literal(true), sourceSha: z.literal(utilityDeployments.backup.commitSha),
    configurationUnchanged: z.literal(true) }).strict().optional(),
  disposableDataException: z.object({ reference, founderId: reference, releaseSha: z.literal(RELEASE_SHA), acceptedAt: instant,
    scope: z.literal("customer-memberships-and-loyalty-transactions"), databaseResetAuthorized: z.literal(false),
    otherDataAssessment: z.object({ reference, observedAt: instant, noIrreplaceableDataAtRisk: z.literal(true),
      sourceGeneration: z.literal("792e218a17287009067ce0993c33eda3bfc3f4b7") }).strict(),
    existingEncryptedBackup: z.object({ reference, objectId: reference, retained: z.literal(true) }).strict() }).strict().optional(),
  acceptedExistingRecovery: z.object({ reference, founderAuthorization: reference, releaseSha: z.literal(RELEASE_SHA),
    changesSinceUsableBackupLossAccepted: z.literal(true), databaseResetAuthorized: z.literal(false),
    objectId: z.literal("loynara/2026/10/11/20261011T030225Z-19970f3c172a.dump.age"),
    objectSha256: z.literal("2907f22ed330d59be55a13a4615f56b2e1dd1d1093ce97b355cffeb91dd58b0a"), retained: z.literal(true),
    authenticatedDecryptionVerified: z.literal(true), isolatedEmptyPostgres18RestoreVerified: z.literal(true),
    canonicalJournalVerified: z.literal(true), physicalSchemaVerified: z.literal(true), businessInvariantsVerified: z.literal(true),
    technicalReview: reference, previousRestoreEvidence: reference,
    preservationAssessment: z.object({ reference, observedAt: instant, allRequiredRecordsCovered: z.literal(true),
      latestPreservedRecordChange: instant }).strict() }).strict().optional(),
  currentJournal: z.object({ reference, rows: z.array(z.tuple([digest, z.number().int().positive()])).length(21) }).strict(),
}).strict().superRefine((e, context) => {
  const reject = () => context.addIssue({ code: "custom", message: "Recovery policy evidence is incomplete or inconsistent" });
  if (e.disposableDataException || e.acceptedExistingRecovery) {
    if ((e.disposableDataException && e.acceptedExistingRecovery) || !e.currentPhysicalSchema || !e.backupPreservation || e.backup || e.restore || e.founderRestoreAcceptance
      || e.backupUpgrade || e.backupSnapshotTransition || e.authorizations.backupRestore
      || e.authorizations.scope.backupRestore) reject();
  } else if (!e.backup || !e.restore || !e.founderRestoreAcceptance || !e.backupUpgrade
    || !e.authorizations.backupRestore || !e.authorizations.scope.backupRestore
    || e.backupPreservation || e.currentPhysicalSchema) reject();
});

const definitions = [
  { role: "web", id: "5c1303ad-42c2-4094-a996-3ac6140d088d", dockerfile: "/Dockerfile", command: null, cronSchedule: null },
  { role: "worker", id: "3bfad7e8-c638-41bd-8f50-743e68c0633f", dockerfile: "/Dockerfile", command: "npm run worker", cronSchedule: null },
  { role: "migrate", id: "ba6a41c5-b9ee-463a-bc25-f7745c549f59", dockerfile: "/Dockerfile", command: "npm run production:migrate", cronSchedule: null },
  { role: "backup", id: "78ee0c58-c306-4f3a-95c0-1c94e72e793c", dockerfile: "/Dockerfile.backup", command: null, cronSchedule: "0 3 * * *" },
  { role: "ops", id: "c3189719-e305-4c4c-b8ca-4d0b0335c25f", dockerfile: "/Dockerfile", command: "npm run production:ops-check", cronSchedule: "*/5 * * * *" },
  { role: "postgres", id: "7eb7c68b-c890-4f79-844f-f439f9fe0234", dockerfile: null, command: null, cronSchedule: null },
  { role: "cloudflared", id: "131ff3f7-3eb8-4837-a9f9-694db14f623b", dockerfile: null, command: "cloudflared tunnel --no-autoupdate --loglevel warn --metrics 127.0.0.1:20241 run", cronSchedule: null },
] as const;
const writers = [
  { id: "web-http", service: "web", components: ["src/app/api"], effect: "HTTP/API routes: loyalty, consent, staff, campaign and other application writes" },
  { id: "web-immediate-nfc", service: "web", components: ["src/lib/staff-push.ts", "src/lib/outbox.ts"], effect: "Immediate cashier notification claim/renew/outcome; not confined to the background worker" },
  { id: "worker-outbox", service: "worker", components: ["scripts/worker.ts", "src/lib/outbox.ts", "src/lib/outbox-replay.ts"], effect: "Durable claim/replay/renew/outcome and delivery/reward/Wallet processing" },
  { id: "worker-housekeeping", service: "worker", components: ["scripts/worker.ts", "src/lib/wallet/refresh.ts"], effect: "Recovery/contact challenge cleanup and revoked Apple registration cleanup" },
  { id: "migration-schema", service: "migrate", components: ["scripts/production-migrate.ts", "drizzle/meta/_journal.json"], effect: "Auth/schema/ledger-trigger migration; scheduled/one-off invocations must remain stopped until approved" },
];
const requiredEvidence = [
  "Pinned backup rollout on the normal recovery path, or independently verified unchanged regular-backup compatibility for the release-specific disposable-data exception",
  "Explicit pinned operations-service rollout: independently authenticated configuration/runtime/monitor compatibility, exact-commit eligibility and scoped deployment authorization; old baseline provenance alone cannot satisfy the upgraded operational safeguards",
  "Authenticated operator receipt for exact project/environment/service identities, current generations, unchanged branch and resolved safe flags",
  "Complete live writer inventory including immediate NFC, scheduled jobs, manual replay/migrations and any outside clients; no unaccounted writers",
  "Known branchless backup/ops utilities need exact configured repository/cron/command plus independently verified deployed commit/deployment identity; absence of a connected branch is not code provenance",
  "Authenticated exact-commit deployment eligibility and explicitly scoped founder cutover authorization for the pinned release",
  "Authorized all-old-writer shutdown/drain receipt with zero in-flight work before the recovery point",
  "Normal recovery path requires fresh encrypted approved EU R2 object after drain: source database/generation/schema, date/size/SHA256, independent retrieval and key custodian (never the key)",
  "Explicit source and restored physical schema receipts: critical tables, tenant constraints, append-only trigger and structures through 0020; journal hashes alone are insufficient",
  "Approved initially-empty isolated restore target distinct from production; independent operator accepted the same retrieved object, exact canonical journal and source-bound membership/ledger history, tenant isolation and reconciled counts",
  "Normal recovery authorization plus distinct founder acceptance, OR authenticated release-specific disposable-data exception with current no-irreplaceable-data assessment and retained existing encrypted backup; current exact canonical 0000..0020 journal/hash/timestamp and schema evidence before ordered 0021..0024",
];

function git(repository: string, args: string[]): string {
  return execFileSync("git", ["-C", repository, "--no-pager", ...args], {
    encoding: "utf8", timeout: 10_000, maxBuffer: 2_000_000, stdio: ["ignore", "pipe", "ignore"],
    env: { PATH: process.env.PATH, NODE_ENV: "development", GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_OPTIONAL_LOCKS: "0", GIT_TERMINAL_PROMPT: "0", GIT_NO_LAZY_FETCH: "1" },
  });
}
function inspectCandidate(repository: string) {
  const blob = (file: string) => git(repository, ["show", `${RELEASE_SHA}:${file}`]);
  const pkg = JSON.parse(blob("package.json"));
  if (pkg.scripts.start !== "tsx scripts/production-guard.ts && next start"
    || pkg.scripts.worker !== "tsx scripts/worker.ts" || pkg.scripts["production:migrate"] !== "tsx scripts/production-migrate.ts"
    || pkg.scripts["production:backup"] !== "bash scripts/production-backup.sh" || pkg.scripts["production:ops-check"] !== "tsx scripts/production-ops-check.ts") throw new Error("role mismatch");
  const manifest = JSON.parse(blob("docs/launch-ledger/2026-10-11-release-manifest-104.json"));
  if (manifest.production.project !== PROJECT || manifest.production.environment !== ENVIRONMENT
    || manifest.production.web.service !== definitions[0].id || manifest.production.worker.service !== definitions[1].id) throw new Error("manifest mismatch");
  const tags = ["0021_staff_push_subscriptions", "0022_email_rate_limit_retry", "0023_reward_ready_automation", "0024_outbox_claim_token"];
  const journal = JSON.parse(blob("drizzle/meta/_journal.json"));
  if (!Array.isArray(journal.entries) || journal.entries.length !== 25) throw new Error("journal mismatch");
  const entries = journal.entries as { idx: number; when: number; tag: string }[];
  const hashes = entries.map((entry, i) => {
    if (entry.idx !== i || !Number.isSafeInteger(entry.when) || (i && entry.when <= entries[i - 1].when)
      || !new RegExp(`^${String(i).padStart(4, "0")}_`).test(entry.tag)) throw new Error("journal order");
    return createHash("sha256").update(blob(`drizzle/${entry.tag}.sql`)).digest("hex");
  });
  for (let i = 0; i < 21; i++) {
    const row = manifest.production.journal.rows[i];
    if (!row || row[1] !== hashes[i] || Number(row[2]) !== entries[i].when) throw new Error("base schema mismatch");
  }
  if (entries.slice(21).some((e, i) => e.tag !== tags[i])) throw new Error("pending order");
  // Fingerprints bind this inventory to committed source, never to a moving branch or working-copy .env.
  const files = ["package.json", "package-lock.json", "marketing-site/package.json", "marketing-site/package-lock.json",
    "src/app/cashier/page.tsx", "src/lib/product.ts", "src/components/owner/owner-context.tsx", "src/components/owner/program-setup.tsx",
    "scripts/production-restore-check.sh", "Dockerfile", "Dockerfile.backup", "scripts/production-guard.ts", "scripts/production-migrate.ts", "scripts/production-backup.sh",
    "scripts/production-ops-check.ts", "scripts/config-check.ts", "scripts/ops-heartbeat.ts", "scripts/operational-error.ts", "scripts/worker.ts", "src/lib/staff-push.ts", "src/lib/outbox.ts", "src/lib/outbox-replay.ts", "src/lib/wallet/refresh.ts"];
  const fingerprints = files.map(file => ({ file, sha256: createHash("sha256").update(blob(file)).digest("hex") }));
  if (!blob("Dockerfile").includes('npm start -- --hostname 0.0.0.0 --port ${PORT:-3000}')
    || !blob("Dockerfile.backup").includes('ENTRYPOINT ["bash", "/opt/loynara/production-backup.sh"]')) throw new Error("docker role mismatch");
  const canonicalJournal = entries.slice(0, 21).map((e, i) => [hashes[i], e.when] as [string, number]);
  const schemaFingerprint = createHash("sha256").update(JSON.stringify(canonicalJournal)).digest("hex");
  return { status: "PASS", canonicalJournal, schemaFingerprint, sourceBasis: "PINNED_COMMITTED_GIT_BLOBS_NOT_LIVE_RUNTIME", pendingMigrations: entries.slice(21).map((e, i) => ({ tag: e.tag, when: e.when, sha256: hashes[21 + i] })), fingerprints };
}

export function releasePreflight(repository: string, evidence?: unknown, now = Date.now(), argumentIssue?: string) {
  const blockers: string[] = [];
  let waived = false;
  let reused = false;
  let source: ReturnType<typeof inspectCandidate> | { status: string } = { status: "BLOCKED" };
  if (argumentIssue) blockers.push(argumentIssue);
  else {
    try { source = inspectCandidate(repository); } catch { blockers.push("Pinned candidate, Assignment104 identity, roles or canonical ordered migration source could not be verified"); }
  }
  if (evidence === undefined) blockers.push("Operator, writer, configuration, scoped cutover authority and complete recovery-or-disposable-data-exception evidence is missing");
  else {
    const parsed = evidenceSchema.safeParse(evidence);
    if (!parsed.success) blockers.push("Evidence manifest is incomplete, unknown, unsafe or malformed; consult requiredEvidence (input values withheld)");
    else {
      const e = parsed.data;
      waived = !!e.disposableDataException;
      reused = !!e.acceptedExistingRecovery;
      const block = (condition: boolean, text: string) => { if (condition) blockers.push(text); };
      block(Date.parse(e.operator.observedAt) > now || Date.parse(e.operator.validUntil) <= now
        || Date.parse(e.operator.validUntil) <= Date.parse(e.operator.observedAt)
        || now - Date.parse(e.operator.observedAt) > 3_600_000
        || Date.parse(e.operator.validUntil) - Date.parse(e.operator.observedAt) > 3_600_000, "Operator attestation is future-dated, expired or outside the one-hour release window");
      for (const definition of definitions) {
        const matches = e.services.filter(v => v.role === definition.role);
        const s = matches[0];
        block(matches.length !== 1 || s?.id !== definition.id || s?.dockerfile !== definition.dockerfile
          || s?.startCommand !== definition.command || s?.preDeployCommand !== null || s?.cronSchedule !== definition.cronSchedule,
          "Service identity, source role, command, cron or pre-deploy definition is inconsistent");
        if (s && ["postgres", "cloudflared"].includes(s.role)) block(s.repository !== "platform-image" || s.branch !== null, "Platform service definitions must not masquerade as application sources");
        if (s && ["web", "worker", "migrate"].includes(s.role)) {
          block(s.repository !== "belmo-hub/loynara" || s.branch !== "railway-rc", "Connected repository/branch must remain unchanged");
        }
        if (s && (s.role === "backup" || s.role === "ops")) {
          const baseline = utilityDeployments[s.role]; const provenance = s.deploymentProvenance;
          block(s.repository !== "belmo-hub/loynara" || s.branch !== null,
            "Known utility source configuration must preserve its repository and absent connected branch");
          const transition = s.role === "backup" ? e.backupSnapshotTransition : undefined;
          const expectedDeployment = transition?.deploymentId ?? baseline.deploymentId;
          if (transition) block(transition.objectSha256 !== e.backup?.sha256
            || Date.parse(transition.at) < Date.parse(e.backup?.capturedAt ?? "") || Date.parse(transition.at) > now,
            "Backup transition must attest restored configuration after this exact fresh backup, never a future or unrelated run");
          block(!provenance || provenance.deploymentId !== expectedDeployment || provenance.commitSha !== baseline.commitSha
            || s.currentGeneration !== baseline.commitSha || s.plannedGeneration !== (s.role === "backup" && (e.disposableDataException || e.acceptedExistingRecovery) ? baseline.commitSha : RELEASE_SHA),
            "Utility current provenance must match its exact known deployment/source; planned utility upgrades or preserved compatible backup must be independently attested");
        } else if (s) block(s.deploymentProvenance !== undefined, "Utility provenance cannot stand in for another service role");
        if (s && ["web", "worker", "migrate"].includes(s.role)) block(s.plannedGeneration !== RELEASE_SHA, "Web, worker and migration must target the same pinned source generation");
      }
      // One authenticated, explicitly scoped cutover receipt may authorize all ordered operations.
      // Permission to restore is never evidence that the actual fresh restore has been accepted.
      block(e.operationsUpgrade.deploymentAuthorization !== e.authorizations.deployment
        || (!!e.backupUpgrade && e.backupUpgrade.deploymentAuthorization !== e.authorizations.deployment),
        "Utility upgrades must bind to the explicitly scoped founder cutover authorization");
      if ("canonicalJournal" in source) block(JSON.stringify(e.currentJournal.rows) !== JSON.stringify(source.canonicalJournal),
        "Observed production journal must match the exact canonical pre-migration journal");
      if (e.acceptedExistingRecovery) {
        const recovery = e.acceptedExistingRecovery;
        block(recovery.founderAuthorization !== e.authorizations.deployment,
          "Existing recovery risk acceptance must bind to actual founder cutover authorization");
        block(Date.parse(recovery.preservationAssessment.observedAt) < Date.parse(e.drain.at)
          || Date.parse(recovery.preservationAssessment.observedAt) > now
          || Date.parse(recovery.preservationAssessment.latestPreservedRecordChange) > Date.parse("2026-10-11T03:02:25Z")
          || Date.parse(e.drain.at) < Date.parse(e.operator.observedAt) || Date.parse(e.drain.at) > now,
          "Existing recovery requires a final drained-state preservation assessment; newer preservation-required data needs fresh recovery");
      } else if (e.disposableDataException) {
        const exception = e.disposableDataException;
        block(Date.parse(exception.acceptedAt) > now || Date.parse(exception.otherDataAssessment.observedAt) > now
          || Date.parse(exception.otherDataAssessment.observedAt) < Date.parse(e.drain.at)
          || Date.parse(e.drain.at) < Date.parse(e.operator.observedAt) || Date.parse(e.drain.at) > now,
          "Disposable-data decision and other-data assessment must be genuine, current, and followed by verified writer drain");
        block(!exception.existingEncryptedBackup.objectId.endsWith(".dump.age"), "The existing encrypted backup must remain identified and retained");
      } else if (e.backup && e.restore && e.founderRestoreAcceptance) {
        const acceptance = e.founderRestoreAcceptance;
        block([e.authorizations.backupRestore, e.authorizations.deployment].includes(acceptance.reference),
          "Actual founder restore acceptance must be distinct from advance operation authorization");
        block(acceptance.objectSha256 !== e.backup.sha256 || acceptance.founderId !== e.restore.independentOperator,
          "Founder acceptance must bind to the exact restored encrypted object and independent founder custodian");
        block(Date.parse(acceptance.at) < Date.parse(e.restore.at) || Date.parse(acceptance.at) > now,
          "Explicit founder acceptance must follow the completed independent restore and precede migration");
        if ("canonicalJournal" in source) {
          block(e.backup.schemaFingerprint !== source.schemaFingerprint || e.restore.schemaFingerprint !== source.schemaFingerprint,
            "Observed production journal, backup and restored journal fingerprints must match the exact canonical pre-migration journal");
        }
        block(e.backup.sourceGeneration !== "792e218a17287009067ce0993c33eda3bfc3f4b7", "Backup provenance must match the current writer generation");
        block(!e.backup.objectId.endsWith(".dump.age"), "Backup must identify the encrypted archive object");
        block(e.restore.target === e.backup.sourceDatabase || e.restore.independentOperator === e.operator.id,
          "Restoration requires a distinct isolated target and independent verifier");
        block(e.restore.history.sourceDatabase !== e.backup.sourceDatabase, "Restored membership/ledger history and counts must be accepted against the backed-up source database");
        block(e.restore.objectSha256 !== e.backup.sha256, "Restore acceptance must identify the exact independently retrieved encrypted object");
        block(Date.parse(e.drain.at) < Date.parse(e.operator.observedAt) || Date.parse(e.drain.at) > Date.parse(e.backup.capturedAt) || Date.parse(e.backup.capturedAt) > Date.parse(e.restore.at)
          || Date.parse(e.restore.at) > now, "Required ordering is old-writer drain, fresh encrypted backup, accepted independent restore, then migration");
      }
      const web = e.services.find(v => v.role === "web"); const worker = e.services.find(v => v.role === "worker");
      block(!web || !worker || web.currentGeneration !== "792e218a17287009067ce0993c33eda3bfc3f4b7" || web.currentGeneration !== worker.currentGeneration,
        "Current writer generations or backup provenance are incompatible");
      block(writers.some(v => !e.writers.sources.includes(v.id)) || new Set(e.writers.sources).size !== writers.length
        || e.writers.sources.length !== writers.length, "Complete known writer coverage and no extra/unknown writer are required");

    }
  }
  return {
    status: blockers.length ? "BLOCKED" : "PASS", releaseSha: RELEASE_SHA, projectId: PROJECT, environmentId: ENVIRONMENT,
    recoveryCheckpoint: reused ? "EXISTING_VERIFIED_RECOVERY_WITH_AUTHORIZED_LATER_CHANGE_LOSS" : waived ? "WAIVED_FOR_THIS_RELEASE_NOT_PERFORMED" : "FRESH_BACKUP_AND_EXPLICIT_RESTORE_ACCEPTANCE_REQUIRED",
    executionEnabled: false, realCustomerIngressReopenEnabled: false, customerCards: "FOUNDER_HOLD_UNTIL_APPROVED_LEGAL_RELEASE_LIVE", evidenceBasis: "DECLARED_OPERATOR_EVIDENCE_REQUIRES_AUTHENTICATION",
    meaning: "Offline prerequisite validation only. No permission is granted and no production operation can be executed by this command.",
    source, serviceDefinitions: definitions, writerInventory: writers, liveWriterInventory: evidence === undefined ? "UNKNOWN" : "OPERATOR_ATTESTATION_REQUIRES_AUTHENTICATION",
    requiredEvidence, blockers: [...new Set(blockers)],
    orderedOperations: ["attest-all-writers-and-scoped-cutover-authorization", "stop-and-drain-all-old-writers", ...(reused ? ["verify-existing-restored-backup-and-final-drained-state-preservation-under-founder-change-loss-acceptance"] : waived ? ["authenticate-release-specific-disposable-data-risk-exception-and-preserve-existing-backup"] : ["fresh-encrypted-backup", "accept-independent-isolated-restore", "require-explicit-founder-acceptance-of-exact-fresh-restore"]),
      "migrate-0021-through-0024-and-verify-exact-25-entry-journal", "deploy-pinned-web-with-ingress-closed", "verify-web-source-and-safe-config",
      "deploy-identical-pinned-worker", ...((waived || reused) ? ["preserve-compatible-regular-backup-source-config-schedule-and-monitor"] : ["deploy-pinned-backup", "verify-backup-source-config-schedule-and-monitor"]), "deploy-pinned-ops-under-scoped-cutover-authorization", "verify-ops-source-safe-config-and-acknowledged-heartbeat",
      "verify-no-old-writers-and-health", "authorized-synthetic-two-tenant-smoke-keep-customer-ingress-contained", "reopen-real-customer-ingress-only-after-separate-approved-live-legal-release"],
  };
}

export function runReleasePreflight(args: string[]) {
  let repository = process.cwd(); let evidenceFile: string | undefined; let issue: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!["--repository", "--evidence"].includes(flag) || seen.has(flag) || !args[i + 1] || args[i + 1].startsWith("--")) { issue = "Unknown or malformed preflight arguments; execution flags are forbidden"; break; }
    seen.add(flag); const value = args[++i];
    if (flag === "--repository") repository = path.resolve(value); else evidenceFile = path.resolve(value);
  }
  let evidence: unknown;
  if (evidenceFile && !issue) {
    try {
      if (!evidenceFile.endsWith(".json") || /secret|credential|token|\.env/i.test(path.basename(evidenceFile))) throw new Error("unsafe filename");
      const info = lstatSync(evidenceFile);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 262144) throw new Error("unsafe input");
      evidence = JSON.parse(readFileSync(evidenceFile, "utf8"));
    } catch { issue = "Cannot read a bounded sanitized evidence JSON file (details withheld)"; }
  }
  const result = releasePreflight(repository, evidence, Date.now(), issue);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.status === "PASS" ? 0 : 2;
}
