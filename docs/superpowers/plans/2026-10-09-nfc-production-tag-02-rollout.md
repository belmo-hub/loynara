# TAG-02 Production NFC Rollout Implementation Plan

> **Release reconciliation, 9 October 2026: SOFTWARE RELEASE ON HOLD.** Returning-customer NFC is now a mandatory launch requirement. The founder now selects optional verified-email recovery after enrollment: verification is not a prerequisite for the first stamp. The reconciled signed session uses 90-day inactivity and a 365-day absolute root. This supersedes the earlier mandatory onboarding selection. The old NFC-only SHA is retained as accepted evidence, not the executable release target. No production or hardware action is authorized by this amendment.

**Verified integration chain:** production `792e218a17287009067ce0993c33eda3bfc3f4b7` → accepted NFC `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec` → Google Wallet Demo `621364a575c5f325b9cac01cc0a421b634a36940` (two commits) → returning-customer `8c1271f1b9842a0b158856fac081eca782ff19d0` (one commit) → integrated recovery `9c344082e4c7d026636b51c0b97ef2efa42c2566` (one focused commit). The integrated branch additionally has documentation-only child `2b4fef7362a73909db58addab5eea9c740b9af0b`. Parallel recovery `89f1837a249dc369a33aecccffd477ef7029cf77` is a sibling of `9c34408`, both from `8c1271f`. The new `codex/nfc-reconciled-release-v1` starts at `2b4fef7` and selectively imports optional recovery/email-link improvements; no blind merge or overwrite. Accepted NFC/Google ancestry is intact. Pin the exact final reconciled SHA recorded in the completion report/YouTrack before any separately approved cutover; never deploy an older NFC-only or mandatory-policy target.

**Launch gates added:** optional verified-email setup after enrollment, first stamp without email verification, signed session inactivity/absolute boundaries, focused first-to-return physical browser continuity and inbox recovery, public customer routing/Access separation, and an evidence-backed disposition of the recorded unchanged retention test failure. The prior local returning-customer record reports 113 focused tests passing/one optional Mailpit skip, four Chrome browser cases passing, and a full-suite failure at `src/lib/retention.integration.test.ts:120`; it is not an all-green release audit. No completed audit or physical suite is being repeated.

**Schema reconciliation:** Google and returning-customer sources change no migration SQL/journal or migrator/rollback artifacts relative to the accepted NFC candidate. The expected transition remains `0020 → 0021`, journal `21 → 22`, with the fingerprints in section 3. Existing `membership_contacts`, verification/recovery challenge tables and ledger/outbox support the implemented recovery design. The integrated change adds no migration; all seven fingerprints below were reverified unchanged.

**Authorization boundaries:** Google Demo acceptance does not authorize publishing, production credentials, Direct provider activation or a new Wallet pass. TAG-02 provisioning remains separately authorized. The technical NFC tenant allowlist remains mandatory before broader merchant activation; the synthetic onboarding freeze is not a substitute for that broader gate. Transactional recovery email approval/configuration is now a separate launch prerequisite; promotional email remains off. The reconciled procedure below remains suspended until the outstanding focused launch gates pass and production deployment is separately authorized.

> **For agentic workers:** Use `superpowers:executing-plans` when the owner authorizes execution. Steps use checkboxes for tracking. This document authorizes no production action; this reconciliation authorized focused local implementation/tests and read-only branch/routing checks only.

**Goal:** Release the integrated NFC, accepted Google Wallet Demo and returning-customer recovery implementation, then run one supervised TAG-02 pilot in the existing internal synthetic production scope with explicit cashier approval and exactly one ledger award per accepted request.

**Architecture:** Deploy the additive database migration and the exact reviewed web/worker revision with NFC and providers off. Separately establish production custody, physically provision TAG-02 offline, configure Web Push, and activate only the approved synthetic tag. Preserve independent database recovery, exact-image recovery, and a shutdown procedure that cancels pending requests.

**Tech Stack:** Installed Next.js and its bundled PWA documentation, PostgreSQL/Drizzle, Railway GraphQL API, Node/tsx, NTAG 424 DNA/PCSC, HKDF-SHA256/AES, Web Push/VAPID, age-encrypted EU R2 backups, Healthchecks.

**Spec:** Owner's “LOYNARA — NFC PRODUCTION ROLLOUT PREPARATION / TAG-02”, attached at `/Users/youssefbelmokhtar/.codex/attachments/c52b6d2b-ab69-4db4-9176-c72f5b308125/Pasted text.txt`. Reviewed implementation: `docs/nfc-cashier-phone-release-review.md` at the frozen candidate below.

## Global Constraints

- LOCAL IMPLEMENTATION AND READ-ONLY RELEASE RECONCILIATION ONLY. Synthetic loopback database/browser/Mailpit tests are permitted. No production deployment, migration, new secret, tag provisioning/change, NFC/Wallet activation or external provider request is authorized or performed.
- Production base: `792e218a17287009067ce0993c33eda3bfc3f4b7`; schema `0020`; journal 21.
- Integrated historical source: `9c344082e4c7d026636b51c0b97ef2efa42c2566`; selected release branch `codex/nfc-reconciled-release-v1`, extending `2b4fef7`. Exact final SHA is recorded in its completion evidence and LOY-29/30/34/76. Freeze that full SHA before an authorized cutover, subject to outstanding gates. NFC evidence remains frozen at `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec`; Google Demo evidence at `621364a575c5f325b9cac01cc0a421b634a36940`.
- TAG-01 remains the permanent preview/reference tag. TAG-03–05 remain untouched. Never reuse preview NFC or VAPID credentials.
- First production NFC acceptance uses internal synthetic staff and a synthetic member only. `staff_confirmed`, 60-second cooldown, explicit approval; no automatic stamps.
- Preserve Apple Wallet acceptance, Wallet data, the existing PassFast mapping/credential, ordinary loyalty behavior, and ledger history. PassFast, Wallet providers, billing and external email remain off for software deployment. Optional recovery delivery requires separately approved transactional email; promotional email stays off.
- Do not repeat completed audits or preview acceptance without a specific changed production dependency.
- Never emit secrets, session tokens, card links, push endpoints, monitor capability URLs, or replayable SUN sample URLs into reports, command arguments, or Git.
- Read installed Next documentation before changing Next code; the focused recovery implementation followed the installed cookie, route-handler and Strict Mode guidance.

## Review Focus

1. An uncertain Railway response must not cause a second deployment or migration request.
2. A stopped deployment status is insufficient until all relevant instances and database writers have actually stopped.
3. A verified tag type is insufficient to prove chip originality or TAG-02's current AES credentials.
4. Provider acceptance is insufficient to prove delivery to a locked phone; record actual device arrival.
5. A global NFC flag change is insufficient to stop already pending confirmations; revoke, disable policy, cancel, and reconcile in-flight awards.

## 1. Fresh production baseline — verified, not inferred

Read-only observations: 9 October 2026, 15:44–15:59 Europe/Berlin (13:44–13:59 UTC). Queries used existing authenticated Railway access and bounded PostgreSQL read-only transactions. No crash/restart drill, backup run, restore, or physical test was repeated.

| Item | Fresh result |
|---|---|
| Web / worker source | Both exactly `792e218a17287009067ce0993c33eda3bfc3f4b7` |
| Runtime | Both SUCCESS, one RUNNING instance each; ON_FAILURE, maximum 10 retries |
| Web health | HTTPS `/api/health` 200, status ok, database reachable |
| Schema | 21 journal entries, final timestamp `1791296519073`; canonical `0020` hash/timestamp sequence |
| Journal digest | `bd8b69cc835d22fe8c70c6794034dd9b` — internal MD5 sequence comparison, not a security fingerprint |
| New table | `staff_push_subscriptions` absent, as expected before `0021` |
| Queue | 13 `wallet.refresh` jobs, all complete; no failed, blocked, expired processing lease or overdue work |
| Ledger / Wallet | 11 ledger rows, 1 wallet pass, 0 Apple registrations; balances reconcile; append-only trigger present; invalid constraints 0 |
| NFC | Flag absent/effectively off; provider and verify/admin/synthetic keys absent; secure tags 0; tap requests 0 |
| Web Push | All three VAPID variables absent on configured web/worker and running snapshots |
| Wallet | PassFast, Wallet production approval, Apple and Google flags false; `/api/wallet/status` returns both unavailable |
| Retained integration | One PassFast tenant mapping, wallet types `apple`; credential/mapping retained, provider not called |
| Scope | Exactly one tenant, one location and one program; all the established synthetic scope |
| Registration | Public registration false; existing web staff invitation signup true, preserved |
| Other providers | Billing and external/transactional/promotional email false |
| Staged changes | Railway staged patch empty |

Worker logs show one start, no stop/error/heartbeat failure; two database activity observations advance. The actual `WORKER_HEARTBEAT_URL` matches the green Healthchecks worker check: last ping 28 seconds before observation, period 60 seconds, grace 300 seconds. The outbox check was green with a ping 2 minutes earlier; encrypted backup check was green. No synthetic heartbeat was sent. The old unused “Loynara RC worker” check is not the active heartbeat.

The latest existing encrypted backup object was HEAD-verified, not restored in this task:

`loynara/2026/10/09/20261009T030016Z-3b95e2f99bfa.dump.age`

175,167 bytes; last modified `2026-10-09T03:00:18.874Z`; ETag `3bc6e74baeeda289e7cfe3858e863254`. It does not replace the fresh pre-release backup and exact-object isolated restore gate.

Sanitized local evidence is under `var/nfc-production-rollout-20261009/`: `fresh-control.json`, `fresh-database-console.json`, `fresh-operations.json`, `fresh-release-source.json`, `fresh-backup.json`, `fresh-monitor.json`, `fresh-recovery.json`. Database evidence is a transcription of the observed private console results; each process used `BEGIN REPEATABLE READ READ ONLY`, timeouts and SELECT only, then exited.

## 2. Frozen candidate and retained acceptance

The historical NFC candidate `21019e811a9ac7a1e6a7f7c01cc43360bee5b6ec` remains accepted evidence, not the release target. It descends from the production base; historical migrations `0000`–`0020` are unchanged. Retain the recorded review: 138 test files, 1,196 tests, one skip; typecheck/build passed; lint zero errors/two existing warnings; 28 distinct compiled browser cases. Local `0020 → 0021 → 0020 → 0021` rehearsals preserve historical loyalty/Wallet data. Three reviewed P1 fixes cover shared crypto polling limits, wake-up recovery after a crash, and expiry after membership locking. That completed release audit is retained; this reconciliation ran only affected regressions and a narrow retention classification check.


The selected candidate is **`codex/nfc-reconciled-release-v1`**, from the verified integrated documentation child `2b4fef7`, preserving the original integrated backend and selectively reconciling `89f1837`. Its full SHA must be frozen from the verified completion evidence before any cutover. Historical `9c34408` is retained evidence and is superseded as the delivery target. This local/unpublished candidate is **not approved for production execution**. See `docs/nfc-reconciled-release-review.md` for the latest local results and the exact renewal event.

Focused evidence at the integrated candidate: 15 affected regression files passed, 162 tests/one optional delivery skip; the new Chrome/Mailpit full recovery case passed (47 seconds); typecheck and optimized build passed; lint zero errors/three existing warnings. The independent reviewer found no remaining actionable defects after the referral-bonus bypass and card-refresh continuation fixes. The email browser case uses synthetic local development mode, not production transport or physical acceptance. See `docs/nfc-integrated-recovery-release-review.md` for scope/evidence/limitations. The separately reproduced retention failure at line 120 remains open; this is not an all-green full-suite claim.

The first-award check covers the shared cashier/QR/offline ledger transaction and first positive referral bonuses. An unverified referrer's bonus enters the existing owner-review state, preserving the verified guest's own checkout and recorded referral; verification does not auto-credit held bonuses. Existing awarded memberships retain history. Wallet bridge tests with the recovery policy enabled preserve the original membership and Google object through duplicate confirmation and simulated adapter failure/retry. Verification and credential recovery add no marketing consent.

Retain the owner's Google Wallet Demo acceptance at `621364a`: Android saving, +1, replay protection, −1 correction and closure. Google Direct remains scoped and Apple PassFast routing/mapping is preserved. This acceptance does not authorize publishing or production activation and is not NFC Android/browser acceptance.

Retain TAG-01 verification, K-number display, foreground notification, locked-iPhone notification, authenticated opening, explicit approval, exactly-one award, actor concurrency, replay, expiry, QR fallback and logout/revoked-staff checks. Latest locked-iPhone case: K-PKRVXT 4 → 5; provider acceptance 493 ms. Actual device arrival time was not measured.

The earlier release audit found `railway-rc` at `5c580be9b1887327cc456e672d2f25f29fc25830`; the frozen NFC branch was not published. Do not deploy “latest”, move `railway-rc`, or pick up unrelated newer commits. After focused acceptance and separate authorization, publish only the integrated dedicated branch and deploy using full `commitSha`. Railway supports that field in its [service deployment API](https://docs.railway.com/integrations/api/manage-services).

## 3. Migration 0021 readiness and exact artifacts

All fingerprints are SHA-256 of bytes at the accepted NFC candidate and are unchanged at the integrated implementation target:

| File | SHA-256 |
|---|---|
| `drizzle/0021_staff_push_subscriptions.sql` | `54ab5fa338723c9d1cea6074d67d61f09b1e4d86fa82acf5ce8f300aad3a0721` |
| `drizzle/meta/0021_snapshot.json` | `97ff5e3035046cdf5baae84a1101f8c28588e5f235be7d858d3c170c0dc1e3b0` |
| `drizzle/meta/_journal.json` | `ef10b28b78dd53137e2c17d24161a64670abc8bf3f61816b0c51c07a47e84e54` |
| `docs/rollback/0021-staff-push-subscriptions-down.sql` | `ca5dd82c919053bfb2be98f65229107965bc8c9638ba490efb4deaf32a2ab517` |
| `scripts/production-migrate.ts` | `8df95d4744b0f5395b91a3d53193c59dceb4dbb0d820ad2da679206f7ed4c997` |
| `scripts/production-migrate-config.ts` | `82dcc727efc4f01db27df3e14960c748dd769894dbe4678613a7424d491c29a2` |
| `drizzle.config.ts` | `04661e341f184513ec992ce67a61ba924f13b3541781c626cdfd156d75649647` |

Expected new journal entry: index 21, version 7, timestamp `1791417633414`, tag `0021_staff_push_subscriptions`, breakpoints true; total 22. Production's historical 21 records must remain byte-for-byte equivalent by hash/timestamp sequence. The new record's `hash` must equal the SQL file fingerprint.

The migration adds only the staff push subscriptions table, its endpoint uniqueness, location index, tenant/location foreign key, user/session cascade foreign keys, locale constraint and HTTPS constraint. Application code validates the session/user pairing. Do not claim the migration has a composite session/user constraint or a failure-count constraint it does not contain.

Old web/worker can remain on the additive schema while features are off, but the old worker does not understand `push.tap_pending`. New web must not run against `0020`. The chosen safest procedure uses a short maintenance window with both writers stopped; all preparation is completed before starting that window. Never activate push until both running services use the candidate and no old worker remains.

## 4. Exact software release procedure — future execution only

**Files used:** Frozen migration/rollback artifacts above; `scripts/production-backup.sh`, `scripts/production-restore-check.sh`, `scripts/production-guard.ts`, Dockerfile. The focused returning-customer/recovery change is included in the integrated target. No additional migration is required.

**Railway identifiers:** project `b07a3919-b3fc-4637-8b91-d0b4418d2856`; production environment `a3ba3a4a-3d4c-4149-91c4-735e8bae3447`.

| Service | ID | Saved command/policy |
|---|---|---|
| Web | `5c1303ad-42c2-4094-a996-3ac6140d088d` | Default Dockerfile / `npm start`; ON_FAILURE 10 |
| Worker | `3bfad7e8-c638-41bd-8f50-743e68c0633f` | `npm run worker`; ON_FAILURE 10 |
| Migrate | `ba6a41c5-b9ee-463a-bc25-f7745c549f59` | `npm run production:migrate`; NEVER, no cron |
| Backup | `78ee0c58-c306-4f3a-95c0-1c94e72e793c` | Existing backup image; NEVER; cron `0 3 * * *` UTC |

**A. Prepare without starting maintenance**

- [ ] First close the focused gates in sections 2 and 12; then obtain separate approval for this concrete software packet: frozen branch publication, one fresh backup and isolated restore, bounded migration, exact web/worker deployments, brief maintenance, and the recovery actions in section 11. This packet leaves NFC and providers off.
- [ ] Recheck exact production source/schema, clean staged patch, provider flags, scope, queue, recovery availability and fingerprints immediately before execution. If changed, stop and reconcile the base; do not broaden this release.
- [ ] Prepare an empty isolated restore database, access to the offline age recovery identity, and required `pg_restore`, `psql`, `age`, `aws` tools before maintenance. No app or worker may point to the restore target. Arrange a window away from the 03:00 UTC backup cron.
- [ ] Capture private before-config and rendered variable snapshots, old deployment IDs/images, historical rows/fingerprints and queue state. Save sanitized summaries separately. Do not restore an entire snapshot over unrelated later changes.
- [ ] Publish only `git push origin <REVIEWED_RECONCILED_FULL_SHA>:refs/heads/codex/nfc-reconciled-release-v1`; verify the remote ref equals that SHA. Do not move the configured auto-deploy branch `railway-rc`.

**B. Quiesce, back up, and prove recovery**

- [ ] Ask internal staff to pause writes during the agreed maintenance window. Stop worker first, then web, using `deploymentStop` once per captured deployment. Record exclusive intent files before requests. Observe all instances as actually stopped/exited and no surviving application database writers; a boolean response or service status alone is not the gate. If an outcome is uncertain, reconcile read-only; do not retry blindly.
- [ ] Start exactly one fresh backup from the established backup deployment `dac712d4-3061-486f-9a0f-9677f87fcfe1` using `deploymentRedeploy(..., usePreviousImageTag: true)`, preserving its image and cron. Recheck that deployment identity/image immediately before requesting it. Record exclusive intent; never send a second request after an uncertain response.
- [ ] Require backup SUCCESS, exited runtime, correct previous image, and the log “Encrypted offsite backup uploaded and HEAD-verified”. Record the exact new object key/size/ETag. Do not accept the earlier nightly object as the fresh gate.
- [ ] Restore that exact new object using `scripts/production-restore-check.sh` into an empty `loynara_restore_*` database on a different private host. Set `RESTORE_TARGET_CONFIRMED=isolated`; recovery identity file mode 400/600. A supported local alternative is `127.0.0.1`, explicit `RESTORE_ALLOW_LOCAL_ISOLATED=true` and a separate non-5432 port; never production. Load credentials privately. Run no application/providers on restored data.
- [ ] Require restore PASS, schema/journal 21, append-only trigger/constraints, and equality of the captured historical ledger, memberships/balances, Wallet rows/mapping and queue fingerprints. The restore script's basic row-count output alone is insufficient. If the backup/restore gate fails, recover the old images with schema untouched and end maintenance; do not migrate.

**C. One bounded migration**

- [ ] Verify the migrator is inactive, NEVER, no cron/pre-deploy command, correct production marker/origin, existing `PRODUCTION_MIGRATION_APPROVED=true`, and `MIGRATION_DATABASE_URL` points to the same host/port/database as `DATABASE_URL`. Do not add URL options or persistent `PGOPTIONS`/`NODE_OPTIONS`.
- [ ] Patch only the migrator's saved start command, with `skipDeploys:true`, to the exact shell-wrapped command below. Save before-state. Require two settled readbacks of the allowed delta and empty staged patch before deploying. Reuse the established settlement approach; an accepted patch response alone is insufficient.

```text
/bin/sh -c "export PGOPTIONS='-c lock_timeout=100ms -c statement_timeout=2s -c transaction_timeout=10s'; exec npm run production:migrate"
```

Railway must receive the shell wrapper; a raw leading `PGOPTIONS=...` command previously failed because of command tokenization. The existing wrapper uses advisory lock keys 731849/1001 and suppresses driver error detail. Timeouts apply only inside this process.

- [ ] Deploy the migrator exactly once with `serviceInstanceDeployV2`, full candidate `commitSha`. Require exact SHA and command in its runtime manifest, NEVER, exactly one `production:migrate` start and one “Production migration PASS”, terminal SUCCESS and exited runtime.
- [ ] Restore the saved command `npm run production:migrate` with `skipDeploys:true`, on success or failure; verify settlement. Restoring configuration does not terminate an already running process. Require no active migrator/lock before proceeding.
- [ ] Read the database: exactly 22 journal entries ending at `1791417633414`, new hash as above, unchanged first 21, expected new table/index/constraints, no historical row changes, no drift. Classify timeout/failure as unchanged, fully applied or inconsistent using read-only evidence. No automatic migration replay. An inconsistent/uncertain state stops the release.

**D. Web acceptance and worker handover**

- [ ] Deploy web once at the full candidate SHA with original start/restart/healthcheck configuration. Preserve all provider flags and mappings; NFC/key-provider/VAPID remain absent/off and `VERIFIED_RECOVERY_BEFORE_FIRST_AWARD=false` (or absent/default-off) on both services. Require correct runtime source/image, production guard PASS, health 200, unauthenticated/authenticated ordinary page behavior, Wallet status unavailable, and existing loyalty/Wallet rows unchanged. No provider call or award is required for this software gate.
- [ ] Deploy worker once at the same SHA, command `npm run worker`, ON_FAILURE 10. Require exactly one running candidate worker, no old instance, successful poll/real heartbeat, no unexpected failed/unknown queue kind, leases or provider activation. Capture new image digests as the pilot recovery targets.
- [ ] Verify both rendered configurations and running snapshots still have NFC, PassFast, Wallet providers, billing and external email off; VAPID and NFC keys absent. Preserve public registration false and existing staff signup behavior. Reconcile historical ledger/Wallet/queue fingerprints, new schema and operational monitoring. End maintenance only after these gates.

The following are **future mutation shapes**, not calls performed by this request. Use authenticated structured variables, exclusive intent records, and exact target assertions:

```graphql
mutation($d:String!){deploymentStop(id:$d)}
mutation($d:String!){deploymentRedeploy(id:$d,usePreviousImageTag:true){id status createdAt}}
mutation($e:String!,$p:EnvironmentConfig!){environmentPatchCommit(environmentId:$e,patch:$p,skipDeploys:true)}
mutation($s:String!,$e:String!,$c:String!){serviceInstanceDeployV2(serviceId:$s,environmentId:$e,commitSha:$c)}
```

Migrator patch shape: `{"services":{"ba6a41c5-b9ee-463a-bc25-f7745c549f59":{"deploy":{"startCommand":"<exact command above>"}}}}`. Use the same shape with the saved command for restoration. Preserve all other fields. Railway's [deployment actions](https://docs.railway.com/deployments/deployment-actions) describe recovery behavior; availability is rechecked at execution time.

## 5. Production NFC custody proposal

**Files defining the contract:** `src/lib/nfc-keys.ts`, `src/lib/nfc-provision/production.ts` (`assertProductionOperatorEnvironment`), `scripts/nfc-operator-keys.ts` at the candidate. The separate `operator-safety.ts` guard is for the preview/device-test path and must not be used as the production procedure.

The implemented provider is `derived_v1`: two independent 32-byte CSPRNG masters, encoded as 64 hex characters, distinct and passing the parser's byte-diversity check. HKDF-SHA256 derives 16-byte AES keys from master, versioned salt, public key reference, UID and slot label. Verification master derives file-read key 1 and metadata-read key 2; administrator master derives slots 0, 3 and 4. The server holds verification material only. A compromised verifier can forge SUN reads; separation protects chip rewriting, not forgery by a compromised verifier.

- [ ] Owner names the production operator and independent recovery custodian, approves the production-only custody location and offsite encrypted recovery arrangement. Proposed local directory: `/Users/youssefbelmokhtar/.loynara-custody/production-nfc/`, outside Git and synced folders, directory mode 700/files 600; this directory has not been created by this task.
- [ ] Generate independent masters using the operating system CSPRNG directly into private custody; print neither value. Do not place secrets in command arguments, shell history, chat, logs, fixtures, evidence journals or repository files. Validate the actual bytes locally without printing them.
- [ ] Encrypt the masters and custody manifest to a separately held age recovery identity; store an independent encrypted copy off the workstation/Railway. Prove recovery offline without echoing secrets. Include provider version/derivation contract, UID-to-label mapping, origin/binding, key reference, provenance, tool revision and evidence location. Keep decryption identities outside the backup bundle and production services.
- [ ] Local provisioning uses a restricted temporary operator environment containing both masters, `NFC_KEY_PROVIDER=derived_v1` and `PRODUCTION_APPROVED_ORIGIN=https://app.getloynara.com`. Remove inherited development/test/synthetic environment and `DATABASE_URL`; the operator's safety guard must pass. Clean up temporary plaintext after use; do not claim guaranteed secure deletion on SSDs.
- [ ] Railway web receives only `NFC_VERIFY_MASTER_KEY`, `NFC_KEY_PROVIDER=derived_v1`, and `NFC_ENABLED=true` during the later atomic activation patch. Never install `NFC_ADMIN_MASTER_KEY` or `TAP_SYNTHETIC_KEY_FILE` on production. Worker needs no NFC master/provider and can remain NFC off while delivering push.

The production guard rejects a verify master/provider while NFC is off. Therefore secret-only staging on a running NFC-off web deployment is not a valid intermediate state. Keep production NFC material offline until the atomically consistent web activation in section 8, with zero registered active tags.

**Recovery and rotation:** Recover the same masters/version/ref/UID from independent custody to retain tag identity. Losing admin custody does not justify key guessing or resetting a chip. Quarantine and replace hardware if custody cannot be recovered. The v1 provider has no multi-master key ring or proven live rekeying procedure. A compromised verify master requires disabling affected activity, revoking tags, generating separate replacement custody and provisioning fresh authorized hardware. An admin compromise also requires physical custody review. Do not promise seamless rotation or reprogram TAG-01/03–05. Reprogramming an already personalized TAG-02 needs a separately reviewed authenticated procedure; the current virgin-tag path is not that procedure.

## 6. TAG-02 physical provisioning only

**Files used:** `scripts/nfc-operator.ts`, `scripts/nfc-operator-keys.ts`, `src/lib/nfc-provision/{production-run,production,ntag,evidence}.ts`, `scripts/operator-register-tag.ts`, `scripts/nfc-register.ts`. Execute from the clean frozen candidate worktree, not the unrelated current checkout.

- [ ] Physically separate TAG-02; label/photograph it with custody reference. Remove TAG-01 and TAG-03–05 from the reader area. Observe and record the exact PCSC reader name and UID; they cannot be invented in advance.
- [ ] Run the CPU-only preview of the production procedure: `node --import tsx scripts/nfc-operator.ts provision --target production --dry-run`. It allocates no production identity, opens no reader, reads no keys and contacts no database.
- [ ] Use `reader-check --reader "<observed PCSC name>"` and `tag-inspect --reader "<observed PCSC name>"` with the same CLI prefix. These are read-only chip identity/file classification operations. Require NTAG 424 DNA, 7-byte UID, expected untouched state/file settings `0000e0ee000100`, and no conflicting local journal. A GetVersion result alone proves type, not originality.
- [ ] Verify NXP originality by `Read_Sig` plus the NXP ECDSA public-key verification procedure in an appropriate trusted read-only NFC tool; record signature validation result, UID and tool version. The repo does not implement this originality verification. Obtain supplier/current-key provenance for this exact UID; confirm all five existing AES slots through that custody/approved read-only authentication procedure. Do not infer TAG-02's keys from TAG-01 or assume zero keys. If originality, UID, initial settings, provenance or credentials are unknown/mixed, stop and quarantine without writes. See NXP [NTAG 424 DNA datasheet, originality signature](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf) and [AN12196](https://www.nxp.com/docs/en/application-note/AN12196.pdf).
- [ ] Store the explicit current-key file as a restricted regular non-symlink file: keys named `uid`, `key0`, `fileReadKey`, `metaReadKey`, `key3`, `key4`; UID lowercase 14 hex and each AES key 32 hex. No default credential fallback. This is TAG-02 transport/current custody, separate from production masters and preview custody.
- [ ] Confirm the exact binding in section 8 and approved origin. After physical-write authorization, execute the command below in an interactive private terminal; read the tool's actual UID/binding/change summary and type `PROVISION <actual UID>` only if every field matches.

```text
node --import tsx scripts/nfc-operator.ts provision --target production --execute \
  --provenance-ref TAG-02-INITIAL-STATE-20261009 \
  --transport-keys-file /Users/youssefbelmokhtar/.loynara-custody/production-nfc/TAG-02-current-keys.json \
  --env-file /Users/youssefbelmokhtar/.loynara-custody/production-nfc/operator.env \
  --reader "<observed exact PCSC name>" \
  --tenant-id d966ab62-3d65-41ad-9435-2ba8f7d4ee48 \
  --location-id 24a5e6f8-fd09-41af-af61-56b436c6cd61 \
  --program-id cf9f5121-0a4a-4800-a778-e5629f4b403d \
  --cooldown-seconds 60
```

The tool generates a new production public reference and `dv1_...` key reference under exclusive per-UID evidence custody. It authenticates with explicit current key 0 before changes; writes NDEF bound to `https://app.getloynara.com/tap/<new ref>`; reads it back; changes keys 1–4; configures/read-verifies SDM and exact offsets/access; changes key 0 last; authenticates the personalized key; verifies SUN MAC/decrypted UID and increasing counters across a fresh application selection/reconnect, and rejects wrong keys. Repeated reads within the same selection can share a counter; strict advancement must be observed across the appropriate reselect boundary.

- [ ] Require all readback/proof stages acknowledged and complete. Preserve durable intent/stage journal, reader/UID/originality/provenance evidence, tool SHA, binding/origin, public/key references, settings/offsets, first/second counters and private registration bundle. Derived AES values must not be journaled. Sample SUN URLs are private replay evidence even though the bundle contains no master keys.
- [ ] Treat an intent without acknowledgement as uncertain physical state. Preserve journal/lock/custody and quarantine; do not blindly resume or probe alternate keys. Resume is supported only for durably acknowledged settings/key-0/readback stages with the same UID, binding and custody and typed `RESUME <UID>`. If only final bundle delivery was lost after complete evidence, recover the original bundle through `registrationBundleFromEvidence`/`deliverRegistrationBundle`; do not retap or rewrite to recreate it.
- [ ] Do not use the physically personalized chip in the public flow before production registration. Load only its bundle privately into the production web console as `NFC_TAG_BUNDLE`, using a restricted file/controlled stdin loader, with no shell-history interpolation or credential arguments. After the activation patch in section 8, run `node --import tsx scripts/operator-register-tag.ts --target loynara-production --actor-user-id mN1x3Mv8g0imIJUGfzhojwqnWri9hFn1` for the read-only default; inspect its exact target/binding/proof, then add `--execute` under the pilot authorization. Recheck this actor is the active synthetic owner first.
- [ ] Require one active production TAG-02 mapping only, correct UID/ref/keyRef/binding, counter floor at least the highest provisioning proof counter. Registration's idempotent `already_registered` result requires the same exact binding. Provisioning samples at/below the floor must never create a new pending request or award. Preserve registration audit and resulting tag ID in the private execution record.

TAG-02 is not yet inspected, authenticated, personalized or registered by this request. No new hardware acceptance is claimed.

## 7. Web Push requirements and operation

**Files:** `src/lib/staff-push.ts`, `src/lib/cashier-push-client.ts`, `src/app/api/cashier/push/{config,subscription}/route.ts`, public cashier service worker/manifest and icons, worker delivery code. Reuse the reviewed implementation; no APNs Wallet change is needed.

| Variable | Requirement / custody |
|---|---|
| `VAPID_PUBLIC_KEY` | Base64url, unpadded P-256 uncompressed 65-byte public key, 87 characters; browser-visible |
| `VAPID_PRIVATE_KEY` | Matching 32-byte P-256 private scalar, base64url 43 characters; secret on web and worker only |
| `VAPID_SUBJECT` | Valid `mailto:` monitored owner/support address or HTTPS contact URL approved by owner |

- [ ] Generate a production-only pair into private custody after authorization; cryptographically verify the pair matches, not only regex shape. Encrypt independent recovery like NFC custody, with separate purpose/version metadata. Use the identical pair/subject on web and worker; keep it distinct from preview, NFC masters and auth secrets. Generate/install nothing in this planning task.
- [ ] Install VAPID on the candidate worker and then candidate web under pilot authorization, preserving all Wallet/provider flags. Presence of the full triple enables push; there is no separate `WEB_PUSH_ENABLED` flag. It can be configured with NFC off. Verify guard/runtime snapshots privately and report presence only.
- [ ] Verify live HTTPS `/cashier-sw.js` returns current JS (not a login HTML response), correct MIME type, active scope `/cashier`, and `updateViaCache: none`; verify `/cashier.webmanifest` has `/cashier` start/scope, standalone display and working 192/512 icons. Confirm the phone's active worker is the deployed version. The worker has no fetch handler/authenticated content cache; notification clicks open same-origin cashier UI.
- [ ] iPhone/iPad: iOS/iPadOS 16.4+, add cashier web app to Home Screen, launch that installed app, authenticate there, choose notification enable via an explicit user action, grant browser/OS permission, check Focus and network. No Apple Developer account or Wallet APNs certificate is needed for standards-based web push. See [WebKit's platform requirements](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/).
- [ ] Android Chrome: HTTPS, active service worker and granted site/OS Chrome notifications; use a supported ordinary browsing session. Installation is optional for web push. Verify real locked-device behavior and OEM battery settings instead of promising background delivery. See [Chrome notification controls](https://support.google.com/chrome/answer/3220216?co=GENIE.Platform%3DAndroid&hl=en) and [Push API subscription/key requirements](https://web.dev/articles/push-notifications-subscribing-a-user).

Subscription registration requires same-origin authenticated session/user and authorized selected location; rows bind tenant, location, user and session. Endpoint uniqueness prevents active cross-session takeover; expired/deleted prior sessions can be replaced. API limits 120/hour and 10 device endpoints/user. Only approved push-service endpoint shapes are accepted and redirects are not followed. Recipient selection joins a live matching session and active staff/location authorization; each recipient send rechecks that the request is still pending/unexpired. Logout/session deletion cascades subscription deletion; own-endpoint deletion unsubscribes. Revocation/expiry excludes a device from subsequent recipient selection. In-flight or provider-accepted messages may still arrive after logout; their generic payload grants no access, and opening/confirmation reauthenticates.

Delivery creates `push.tap_pending` in the pending-request transaction, attempts fast delivery after commit, and uses the worker as recovery. Worker polls every 5 seconds; 30-second processing lease is renewed before each recipient and completion is fenced. Transient failures retry after 15 seconds up to five claims. Endpoint 404/410 removes the row; transient timeout/429/5xx retains it; repeated definitive failures can evict it. Each send has a 5-second timeout; fanout is sequential. TTL is at most 120 seconds and bounded by remaining request lifetime (requests expire after 5 minutes). Successful recipient timestamps prevent routine resend; a crash after provider acceptance but before persistence can duplicate a generic notification, never an award.

Outage support: if no notification appears within a pilot support threshold of 10 seconds, unlock/open cashier to use its 2-second visible pending-feed polling or explicit authenticated QR fallback. Hidden-page polling pauses. Never auto-award or treat provider acceptance as delivery. Monitor push kind/status/attempts/age/leases, failed jobs and expired requests; investigate pilot work pending/retrying over 30 seconds. Keep existing real worker heartbeat (60-second period/300-second grace), outbox check (5-minute period/10-minute grace) and backup check; no new automation/ping is created here. Record provider latency separately from device arrival. VAPID rotation needs client unsubscribe/resubscribe through the reviewed enable flow; merely changing the server pair does not repair old subscriptions.

## 8. Synthetic scope and activation order

The approved proposed scope already exists:

| Binding | Value |
|---|---|
| Tenant | `d966ab62-3d65-41ad-9435-2ba8f7d4ee48` — Synthetic RC Hygiene |
| Location | `24a5e6f8-fd09-41af-af61-56b436c6cd61` — Synthetic Standort |
| Program | `cf9f5121-0a4a-4800-a778-e5629f4b403d` — active/manual/stamp, `staff_confirmed`, cooldown 60 |
| Proposed pilot member | `7c14baf4-d78e-47d4-bdcd-187552a98ac5`, K-QNUQYE, open, balance 0 |
| Staff | Existing active synthetic owner, manager and cashier; recheck selected location/session before use |

Do not use/reopen K-BVFUCY: it is the closed Wallet acceptance card. Recover the proposed member's existing card link/session through private synthetic custody; do not print credentials or create a real customer.

**Isolation limit:** The candidate's NFC capability and push configuration are global. It has no tenant feature allowlist. Today there is exactly one tenant/location/program and all are synthetic, so the first pilot can be isolated by sole existing scope, one registered tag, exact registration/policy binding, public registration off and an administrative freeze on additional tenant/merchant onboarding throughout the pilot. Do not describe this as a technical tenant allowlist. Tag verification and staff authorization do enforce the actual tag/location binding.

- [ ] Owner approves these exact synthetic IDs and staff/member use. Keep public registration false; freeze creation/onboarding of other merchant scopes. Recheck counts equal one and IDs/policy match immediately before activation and throughout the supervised pilot. If another tenant/location/program appears, halt activation or disable the pilot.
- [ ] Require section 4 software gates complete, schema 22, both candidate runtimes, no old worker, custody/recovery complete and TAG-02 physical proof complete. Keep physical TAG-02 in operator custody until registered.
- [ ] Configure VAPID worker first with worker NFC off/no NFC master; configure web VAPID and verify PWA/phone subscription requirements. Keep Wallet, billing and promotional providers off; approved transactional recovery email is the separate exception required before NFC activation.
- [ ] Before NFC activation, separately authorize/configure the existing transactional Mailgun EU transport on web and worker: `TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED=true`, `MAILGUN_SEND_APPROVED=true`, valid existing domain/from/API/webhook configuration and public origin. Do not invent or generate production secrets in this task. Leave `EXTERNAL_EMAIL_ENABLED=false` and `PROMOTIONAL_EXTERNAL_EMAIL_ENABLED=false`; verify delivery/confirmation/recovery using synthetic custody and no marketing opt-in. Keep `VERIFIED_RECOVERY_BEFORE_FIRST_AWARD=false` on both services for the selected optional policy. Deploy only the separately approved exact reconciled SHA and require guards passing while web NFC is still off. Prove a zero-award card can earn its first cashier-approved stamp without contact verification; separately verify optional contact/recovery delivery. Recovery email never implies marketing consent.
- [ ] Atomically patch web `NFC_ENABLED=true`, `NFC_KEY_PROVIDER=derived_v1`, production verification master, approved VAPID triple, preserving `VERIFIED_RECOVERY_BEFORE_FIRST_AWARD=false` and approved transactional email; preserve marker/origin and all unrelated config. If VAPID is already settled, preserve its exact values. Deploy exact candidate once, verify production guard and zero registered active tags. This interval exposes capability only in the sole synthetic scope and cannot process a registered production tag yet.
- [ ] Register only TAG-02 using section 6. Verify exactly one active tag, correct binding/counter floor, no unintended ledger or queue activity; unlock the supervised physical test.

Before adding a real merchant or wider scope, require a separately reviewed technical scope gate covering capability/UI, tap entry, push subscription/delivery and settings, or disable NFC first. Such a change creates a new reviewed SHA; it is outside this planning request and is not silently added to the frozen RC.

## 9. Scoped physical production acceptance

These checks are justified by new production origin/keys/VAPID/runtime and new TAG-02; they do not reopen the completed TAG-01 preview audit. Test only internal synthetic staff/member; preserve every resulting ledger row rather than deleting test history.

- [ ] Prepare the customer phone with the existing open K-QNUQYE card/session; offer optional recovery setup and prove the first award is not email-gated, then confirm balance and ledger baseline (historically 0; capture fresh). Prepare cashier's existing smartphone in authenticated installed cashier PWA, correct location, subscribed with production key and notifications allowed. Lock it. Record device/OS/browser versions, permissions and active SW version.
- [ ] Customer physically taps TAG-02. Record actual tap time, new UID-matching increasing counter, request ID/pending time and displayed K-number. Before approval require unchanged balance/ledger and one pending request. Observe a real locked-screen cashier notification; record actual arrival time separately from provider acceptance time.
- [ ] Open the notification, require authenticated cashier/location, review K-number and explicitly confirm once. Require one linked ledger award, final request confirmed, balance baseline +1 (0 → 1 if unchanged), normal customer completion and healthy push queue. Notification receipt/click alone must never award.
- [ ] Use a subsequent supervised request after cooldown with two independently authenticated authorized cashier phones if available; both attempt confirmation. Require exactly one award and consistent loser/already-confirmed result. Retain the previous actor-level concurrency PASS; actual two-device observation closes the remaining physical gap.
- [ ] Capture a production SUN sample privately and replay the already processed counter. Require no additional pending request or award. Provisioning proof at/below registered counter floor is also rejected. Do not create a forged production URL for a physical acceptance case.
- [ ] Create one new physical request after cooldown and let it expire for more than five minutes; confirm rejection and no award. Use another request only when needed to test deliberate notification permission failure: with notifications denied/unsubscribed, the visible authenticated feed must still show it; cancel without awarding.
- [ ] Test the customer card's QR on the actual cashier phone camera, explicit scan/confirmation, correct scope and exactly one intended award. This verifies phone fallback; the previous desktop webcam fallback remains accepted. Account for every deliberately awarded test in the private evidence; do not reset balances by deleting ledger entries.
- [ ] Finish with no unattended pending requests, healthy queue/heartbeat, correct feature flags, and a documented choice to leave the supervised pilot enabled or disable using section 11. Record request/counter/tag/member/staff IDs, ledger IDs, before/after balances and tap/pending/provider/arrival/open/confirm timestamps without card links, sessions or push endpoints.

## 10. Android and two-phone gaps

The preview real customer-phone-to-TAG-01 flow reached a foreground desktop cashier. The locked-iPhone acceptance used a computer-generated cryptographically verified request; it did not demonstrate the simultaneous real customer NFC phone → locked cashier phone chain. That chain must be observed with TAG-02 in section 9.

Android customer NFC recognition/browser/session handling and locked Android Chrome cashier notification remain untested. Accepted Android Google Wallet Demo saving/+1/replay/−1/closure at `621364a` is a different workstream and is retained without repetition. Two actual cashier devices racing confirmation and cashier-phone camera QR remain unobserved, although actor concurrency and desktop QR already passed. Actual iPhone delivery latency remains unmeasured. No claim of Android readiness or delivery SLA is made.

Owner only needs to state Android phone availability/intended supported device cohort. Lack of Android hardware does not block the NFC-off software release or a supervised iPhone-only pilot; it blocks Android acceptance and wider Android claims. Do not repeat the preview logout/revocation audit absent a specific changed binding; validate production session/location and logout subscription removal during actual phone setup as relevant.

## 11. Immediate disablement, recovery and rollback

**A. Stop NFC activity while preserving history**

Use the exact TAG-02 ID from the private successful registration record; verify its UID/ref and all three scope IDs before any operation. The existing production operator guard and active synthetic owner context must pass. `nfc-operator tag-revoke` is preview-only and must not be used against production.

- [ ] In the private candidate production console, call the existing owner-authorized `revokeSecureTag({actorUserId: "mN1x3Mv8g0imIJUGfzhojwqnWri9hFn1", tagId: <verified TAG-02 id>})`. It locks the tag row and sets revoked status; preserve row, UID/ref, counters and provisioning evidence. New tag requests then fail closed.
- [ ] Call `setTapPolicy({actorUserId: sameOwner, programId: "cf9f5121-0a4a-4800-a778-e5629f4b403d", mode: "disabled", cooldownSeconds: null})`. The existing owner HTTP alternative is same-origin authenticated POST `/api/merchant/tap` with `{action:"policy", programId:<same>, mode:"disabled", cooldownSeconds:null}`. Record returned policy.
- [ ] Enumerate only `pending_staff` requests for the verified synthetic tenant/location/program and TAG-02; also inspect any other pending rows in that disabled program (baseline had none). Call `cancelTapRequest({userId: sameOwner, locationId: "24a5e6f8-fd09-41af-af61-56b436c6cd61", requestId:<each verified pending id>})`. It locks/rechecks each row. Re-read until no pending requests remain. A confirmation already holding its lock may finish first; record/reconcile its award without deleting it. Already-confirmed/expired responses require read-only classification, not blind retries.
- [ ] If these scoped calls cannot complete promptly or compromise is active, stop web and worker once through the known Railway stop operation, verify actual instance/DB quiescence, then perform the same binding-checked cancellation using the frozen operator modules in a private maintenance context. Retain an outage rather than leave unaudited confirmations possible.
- [ ] Atomically set web `NFC_ENABLED=false` and remove `NFC_KEY_PROVIDER` plus `NFC_VERIFY_MASTER_KEY`; redeploy the exact candidate and ensure no old enabled instance survives. Flag-only disable is insufficient because pending confirmation does not consult that flag. Preserve encrypted offline masters and custody.
- [ ] To shut off all Web Push, remove the complete VAPID triple from web/worker and redeploy the exact candidate after pending cancellation; leave Wallet secrets/mappings untouched. Cancelled requests are skipped by push delivery. A provider-accepted generic notification cannot be recalled, but authenticated opening cannot resurrect an award.
- [ ] Verify revoked tag, disabled policy, no pending requests, no new tap/ledger writes after the shutdown barrier, off capability and healthy ordinary services. Quarantine physical TAG-02 on compromise/uncertain state; do not reset its keys or discard evidence. Preserve ledger/tap/outbox rows and private before/after operator evidence. No centralized tag-operation audit table is implied by this plan.

For an unavailable web console, the following **planned emergency SQL** is an exact alternative after both writers are stopped and actual database quiescence is verified. Run in the existing private PostgreSQL console with `psql -X --set=ON_ERROR_STOP=1`, session-only lock timeout 100ms/statement timeout 2s/transaction timeout 10s. Set the three non-secret psql variables `tag_id`, `tag_uid`, `tag_ref` from the private verified TAG-02 registration record first. No inferred UUID/UID/ref is permitted. The sole-synthetic counts and active owner are fail-closed guards. On a lock timeout or uncertain COMMIT, inspect read-only before deciding whether anything else is needed.

```sql
BEGIN;
LOCK TABLE programs, secure_tags, tap_requests IN SHARE ROW EXCLUSIVE MODE;
SELECT (
  (SELECT count(*) FROM tenants) = 1 AND
  (SELECT count(*) FROM locations) = 1 AND
  (SELECT count(*) FROM programs) = 1 AND
  (SELECT count(*) FROM secure_tags) = 1 AND
  EXISTS (SELECT 1 FROM staff_roles
    WHERE tenant_id = 'd966ab62-3d65-41ad-9435-2ba8f7d4ee48'
      AND user_id = 'mN1x3Mv8g0imIJUGfzhojwqnWri9hFn1'
      AND role = 'owner' AND active) AND
  EXISTS (SELECT 1 FROM secure_tags
    WHERE id = :'tag_id'::uuid AND uid = :'tag_uid' AND public_ref = :'tag_ref'
      AND tenant_id = 'd966ab62-3d65-41ad-9435-2ba8f7d4ee48'
      AND location_id = '24a5e6f8-fd09-41af-af61-56b436c6cd61'
      AND program_id = 'cf9f5121-0a4a-4800-a778-e5629f4b403d'
      AND status IN ('active','provisioned','revoked'))
) AS tag02_shutdown_valid \gset
\if :tag02_shutdown_valid
UPDATE secure_tags SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
WHERE id = :'tag_id'::uuid;
UPDATE programs SET tap_mode = 'disabled', tap_cooldown_seconds = NULL
WHERE id = 'cf9f5121-0a4a-4800-a778-e5629f4b403d'
  AND tenant_id = 'd966ab62-3d65-41ad-9435-2ba8f7d4ee48'
  AND location_id = '24a5e6f8-fd09-41af-af61-56b436c6cd61';
UPDATE tap_requests SET status = 'cancelled'
WHERE status = 'pending_staff'
  AND tenant_id = 'd966ab62-3d65-41ad-9435-2ba8f7d4ee48'
  AND location_id = '24a5e6f8-fd09-41af-af61-56b436c6cd61'
  AND program_id = 'cf9f5121-0a4a-4800-a778-e5629f4b403d';
COMMIT;
\else
ROLLBACK;
\quit 2
\endif
```

Capture changed row counts and re-read all shutdown predicates/ledger before service recovery. This alternative changes only tag status, program tap policy and pending request status; it deletes nothing and never rewrites an accepted award.

**B. Exact-image application recovery**

Current frozen pre-release recovery targets, freshly `canRedeploy=true` and `canRollback=true`:

| Service | Deployment | Image |
|---|---|---|
| Web | `fe8b9d81-d6a9-452f-8807-c811f3c49421` | `sha256:b68a7a80344aafabeb0fba5a33e081b0db442828152ff84a4a544060b438c5ed` |
| Worker | `5471cb46-237e-40a5-a3eb-ad780db9bc59` | `sha256:3b42eaad39ea4987d6b1fb9e0bd9c380be73f07be237c55cb3d6ddbb7fcba8a2` |

Before recovery-policy activation, prefer recovering these previous images while leaving the additive `0021` schema in place if it is healthy and no push jobs have been created. Restore only the captured release-owned config deltas, with NFC/VAPID off, then request exact-image `deploymentRedeploy(id:...,usePreviousImageTag:true)` once per service and verify resulting image/source/runtime. Never redeploy `railway-rc` latest. Recheck recoverability at execution; Railway retention is finite.

After recovery-policy or NFC activation, prefer disabling the pilot and recovering the newly captured candidate images, retaining schema/history and the verified-contact requirement. The `792e218` images cannot enforce the new first-award policy or serve signed returning credentials/Google Direct behavior; recovering them is an outage/off-state fallback, not permission to resume the new journey or new-card staff/QR/offline awards without verification. Keep those write paths paused until an enforcing integrated image is restored. Preserve contacts, challenge/security records, Wallet projection records and ledger. Reconcile changed outbox payload/provider behavior before any old-worker restart; do not replay provider jobs blindly. If old worker recovery is necessary, stop both services and first resolve every `push.tap_pending` job; an old worker cannot understand even leftover historical push-kind rows. Archive those rows encrypted with their IDs/relationships before any reviewed cleanup. Do not truncate outbox, replay Wallet jobs or discard other queue kinds.

**C. Paired schema rollback if required**

- [ ] Disable/cancel the pilot and stop both services; verify quiescence. Archive encrypted staff subscriptions and all push-kind outbox rows before destructive rollback. Keep provisioning/tap/ledger custody. Record exact journal/fingerprints.
- [ ] Run only the reviewed `docs/rollback/0021-staff-push-subscriptions-down.sql`, fingerprint from section 3, once with `psql -X --set=ON_ERROR_STOP=1 --single-transaction --file=docs/rollback/0021-staff-push-subscriptions-down.sql`. Load private libpq connection variables without a credential-bearing URL argument; apply session-only `PGOPTIONS` lock timeout 100ms, statement timeout 2s and transaction timeout 10s. It exclusively locks the journal and refuses unless count 22/final timestamp `1791417633414`.
- [ ] The script deletes only `push.tap_pending` outbox rows, drops staff push subscriptions, and removes the final migration record. Subscription/push-job data is lost from the live DB by design; preserve its encrypted archive. It leaves ledger, balances, memberships/cards, tap requests, Wallet and staff unchanged. Verify exact canonical journal21/schema0020 plus unchanged historical fingerprints.
- [ ] Restore old off-state configuration and exact old web/worker images above. Verify health, ordinary loyalty/Wallet/queue behavior and actual heartbeat before ending maintenance.

Full database restoration into production is a last-resort separately assessed recovery, not an automatic rollback after accepted stamps: it can erase later legitimate history. Preserve a forensic snapshot and reconcile post-backup awards before choosing such recovery. Backup/restore gate failure before migration requires no database rollback.

## Selected customer session policy

The server validates HMAC-signed v2 credentials against both 90 days since last qualifying activity and 365 days since the immutable issuance root; cookie Max-Age is the smaller remaining bound. A fresh, cryptographically verified, same-origin customer NFC POST that creates a new pending cashier request is the selected meaningful activity. It renews in that customer's HTTP response before approval; a cancelled pending visit also counts as activity. A cashier response cannot set the customer browser's cookie, and approval/status polling never renew it. GETs, refreshes, link previews, counter replay and pending-request resume do not renew. Shared devices require explicit selection before creation. Both visible signed cookie scopes preserve the earliest root and shared flag; repair preserves the latest authenticated activity without extending it.

After expiry or complete loss, automatic private-card-page binding is refused. Explicit confirmation of the existing private bearer link or successful single-use verified-email recovery can establish a fresh root. Neither path treats a K-number as proof. Recovery rotates the existing card credential and attaches the recovered browser to the same membership; closures/reissues remain effective. Cookie format rotation uses a fresh random nonce; old signed envelopes are not individually revocable without a session store, but remain bounded by their original root/activity and current membership credential. No new session database or indefinite authentication was introduced.

## 12. Remaining real blockers

The focused recovery implementation is a locally verified candidate; production readiness has not been demonstrated. Software-only release remains **HOLD** until the selected journey has focused acceptance and the unresolved retention failure has an evidence-backed disposition.

- Returning-customer preview physical acceptance: serve the integrated candidate at the unchanged TAG-01 preview origin under existing preview custody; observe first enrollment → pending request → explicit approval → exactly one award without requiring verified contact → optional verified inbox setup → next physical tap retaining the same membership/K-number. Observe browser restart/context loss and recovery after both cookie and private link are lost, with merchant/shared-device isolation. TAG-01 is read only; do not reprovision it. Run only these changed-journey checks, not the completed physical audit.
- Transactional production recovery delivery/configuration is unapproved and untested; local Mailpit is synthetic evidence only. The optional policy does not force an email prerequisite for NFC awards. Production recovery delivery still requires separately approved/configured transactional transport and actual delivery acceptance. Legacy mandatory mode is retained only as an explicit opt-in; it is not the selected release configuration. No extra production secret was created.
- Public customer routes need actual candidate/browser acceptance. Read-only HEAD checks at 19:52 Berlin returned 200 without a redirect for `/recover`, `/join/<invalid probe>` and `/tap/<invalid probe>`; generic shells do not prove a valid card, correct cookie handling or Access separation. Recheck valid synthetic customer routes after any separately authorized deployment; staff routes remain authenticated.
- Recorded `src/lib/retention.integration.test.ts:120` failure was reproduced on Google parent and untouched returning source under equivalent conditions: confirmed pre-existing, with environment/timing sensitivity observed in later integrated runs. Source/test/query remain unchanged. Owning Must Launch gate LOY-164 stays open; no causal fix, all-green full-suite claim or launch waiver. This may block analytics/owner-overview launch even though the customer journey passes locally.

Later production execution gates remain fresh exact-object backup/isolated restore, current base/schema/config agreement, custody/recovery proof, production VAPID contact/key, TAG-02 originality/current-key/UID/personalization/registration, and real two-phone production acceptance. Unknown keys/originality block hardware; backup/restore failure, drift or uncertain migration blocks software.

A technical tenant allowlist remains mandatory before broader merchant NFC activation, covering capability/UI, tap entry, push subscription/delivery and settings. No such gate is implemented by this change. A sole-synthetic freeze is only the documented supervised pilot boundary. Google Wallet publishing/production activation, NFC hardware provisioning and any production secrets/deployment remain separately authorized workstreams.

## 13. Exact owner decisions / authorizations

1. **Software packet:** Authorize section 4's exact SHA/branch publication, fresh backup plus isolated restore, maintenance, one bounded `0021` migration, web/worker deployment and section 11's recovery. All providers/NFC remain off at completion.
2. **Custody:** Name NFC operator and independent recovery custodian; approve production-only offline/encrypted custody and verification-only Railway web storage. Approve VAPID custody and the real monitored subject/contact. These can be one decision covering both independent secret purposes.
3. **TAG-02 and pilot:** Authorize writes to TAG-02 only, the exact synthetic scope/member/staff above, VAPID/web NFC activation and registration, supervised physical acceptance awards, and immediate scoped disablement on failure. Approve the no-other-merchant onboarding boundary. The tool's typed UID confirmation is required by its physical safety contract, not an extra invented approval gate.
4. **Recovery transport:** Separately approve the existing transactional email transport, custody/configuration and scoped synthetic delivery/verification/recovery acceptance before offering production recovery delivery. Email verification remains optional for the first NFC stamp. This does not authorize promotional email.
5. **Google Wallet:** Demo acceptance is retained. Publishing, production credentials/Direct activation and production pass issuance require their own approval; none is included in the NFC software or hardware packet.
6. **Device coverage:** State Android device availability and whether the first supervised cohort is iPhone-only. This is an acceptance-scope decision, not a prerequisite for the off-state software deployment.

No production deployment, secret, hardware or provider activation permission is requested by this local reconciliation turn. The owner may approve the concrete software packet separately before any custody or tag activation work.

## 14. Minimal next execution step

The selected optional onboarding and bounded session renewal are implemented locally. Complete only the changed-journey preview physical/context/inbox acceptance and resolve/classify the recorded retention concern; separately approve production transactional transport when preparing NFC activation. Keep the software-only production release on hold. After the remaining release gates are satisfied and deployment is separately authorized, the first release actions remain the bounded preflight and isolated backup/restore preparation before any migration. Custody/TAG-02/activation and Google publishing/activation remain separate scopes; TAG-01 and TAG-03–05 stay untouched.

**Planning outcome:** BLOCKED for an executable release while focused returning-customer/recovery physical acceptance and the independent launch gates are incomplete. Production execution and hardware acceptance have not started.

NFC PRODUCTION ROLLOUT PLAN = BLOCKED
