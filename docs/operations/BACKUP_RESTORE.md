# Encrypted backups and isolated recovery

Prepared 15 October 2026 for LOY-195. The owner approved retention policy `2026-10-15` for implementation and synthetic testing; production activation remains unauthorized. Current production objects, custody, alerts and storage settings were not inspected. See [synthetic evidence](RESTORE_DRILL_EVIDENCE.md), [approved policy](RETENTION_POLICY_PROPOSAL.md) and [production action sequence](PRODUCTION_STEPS.md).

## Independent custody

The existing daily 03:00 UTC job streams a PostgreSQL custom archive into age encryption, uploads ciphertext to private EU R2, and verifies object HEAD before its success heartbeat. The approved database-backup window is 14 days. Verify actual expiry of R2 objects, native snapshots, downloaded backups and rehearsal copies; a configured lifecycle alone does not prove deletion. This work changes no remote schedule or lifecycle.

Keep separate protected buckets and credentials for database backups, purge manifests and closure manifests. The runtime also retains the nonsecret `ERASURE_S3_BUCKET` name so bucket separation can be checked. Runtime credentials may write only the closure bucket; routine maintenance may write purge intents; neither may delete archival evidence. Custodians need independent read/decrypt custody and a separately controlled delete identity for conditional expiry. Bucket separation is required because prefix isolation must not be assumed. Restrict writers, preserve audit evidence and prevent public access. Trusted bucket writers supply the authorization boundary: age provides confidentiality and ciphertext integrity, not sender signatures.

Name primary and alternate custodians in the private operations register. Keep private age identities outside the application runtime, with a recoverable protected copy independent of the objects. Record recipient fingerprints and custody/access owners privately. The runtime receives public recipients only. Keep old private identities while retained objects require them; recipient rotation does not re-encrypt historical archives. Never put identities, credentials, hold files or customer records in this repository or tickets.

| Purpose | Explicit configuration |
| --- | --- |
| Database backup | Existing `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_AGE_RECIPIENT` and scoped AWS credentials |
| Purge archive | `ERASURE_S3_ENDPOINT`, `ERASURE_S3_BUCKET`, `ERASURE_S3_PREFIX`, `ERASURE_NAMESPACE_ID`, `ERASURE_AWS_ACCESS_KEY_ID`, `ERASURE_AWS_SECRET_ACCESS_KEY`, `ERASURE_AGE_RECIPIENT` |
| Closure archive | `ERASURE_CLOSURE_S3_ENDPOINT`, `ERASURE_CLOSURE_S3_BUCKET`, `ERASURE_CLOSURE_S3_PREFIX`, `ERASURE_CLOSURE_NAMESPACE_ID`, `ERASURE_CLOSURE_AWS_ACCESS_KEY_ID`, `ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY` |
| Offline decryption | `ERASURE_AGE_IDENTITY_FILE`; optional separate `ERASURE_CLOSURE_AGE_IDENTITY_FILE` |

Closure encryption uses optional `ERASURE_CLOSURE_AGE_RECIPIENT`, otherwise public `ERASURE_AGE_RECIPIENT`; its offline identity similarly falls back to `ERASURE_AGE_IDENTITY_FILE`. Namespaces require distinct UUIDs and dedicated prefixes outside the database backup's `loynara/` prefix. Both endpoints must be approved HTTPS EU R2 endpoints. Configure `ERASURE_POLICY_APPROVED=2026-10-15` only under the approved rollout procedure.

Custodians initialize each previously empty protected namespace once, with `ERASURE_INITIALIZE_CONFIRMED=new-protected-namespace` and `python3 scripts/erasure_manifest.py initialize`, then `initialize-closures`. Never reinitialize a missing or unavailable archive. `check-namespace` checks both initialized anchors without private keys; backup fails before dumping if either cannot be verified. `verify` requires both current inventories and offline identities. A heartbeat or HEAD alone does not prove business recovery.

## Closure and purge ordering

`record-closure` accepts strict minimal JSON on stdin: `scope`, `tenant_id`, nullable `member_id`, `cutoff_at`, and random receipt `intent_id`. It encrypts and uploads a `closure` record and verifies HEAD before application closure commits. It needs no database connection, private key or purge writer credentials. Archive failure rolls back closure. An intent persisted before a local rollback still authorizes closure on recovery; do not silently cancel it.

`purge` accepts the same subject fields without `intent_id`. One maintenance transaction locks the eligible closed subject and checks holds/accounting/Wallet predicates, publishes and verifies an encrypted `prepared` intent, purges, then commits. A `completed` record follows commit. Failure to archive preparation prevents purge. A crash before commit or loss of the completion upload leaves a prepared intent which recovery must replay; prepared records are never ignored because completion is absent.

Records contain version/policy, tenant/member UUID, random intent UUID, scope, cutoff/preparation/completion dates and status only. They contain no email, bearer, message or provider payload. UUIDs remain pseudonymous personal data. Object names contain random UUIDs, without subject identifiers. Diagnostics and stdout expose only fixed failures and aggregate counts.

## Current legal-hold checkpoint

Before recovery, a custodian must reconcile the current private hold register, including holds created after the backup. Pause both closure and purge writers through checkpoint capture, replay and final signoff. Do not manufacture an empty checkpoint from the old backup's hold table.

Export the current authoritative active hold register under its separately authorized private procedure to an owner-readable JSON file (mode 400 or 600). The exact schema is:

```json
{"schema_version":1,"generated_at":"2026-10-15T12:00:00Z","holds":[{"tenant_uuid":"11111111-1111-4111-8111-111111111111","member_uuid":null,"categories":["ledger"],"basis":"Specific recorded preservation basis","reason":"Specific preservation purpose","custodian":"Named private custodian","review_at":"2026-10-16T12:00:00Z","release_condition":"Recorded review outcome"}]}
```

This example is synthetic and is not a current checkpoint. Capture a fresh UTC `generated_at` within 15 minutes of execution; future tolerance is five minutes. Use at most 1,000 holds and 1 MiB. Category values are `membership`, `ledger`, `redemptions`, `purchases`, `consent`, `security`, `tenant`; `review_at` must be future and at most 30 days away. The basis/custodian fields are bounded to 500/300 characters; reason/release condition to 1,000. No extra fields or executable SQL are accepted. An empty `holds` array requires an actual current review finding no active holds.

Protect the export independently in transit and at rest; keep its restricted source/time/custodian evidence privately. Set `RESTORE_CURRENT_HOLDS_FILE` to the reviewed plaintext checkpoint only inside quarantine, then remove the temporary copy under the disposal procedure. Recovery calls fixed hold-setter functions before any replay. It skips subjects absent from the snapshot, refuses cross-tenant mismatches and never clears existing restored holds. Holds released since backup require separate custodian review and explicit authorized maintenance release; absence from the JSON does not automatically release them. A held purge intent withholds PASS for resolution rather than bypassing preservation.

## Isolated restore

1. Authorize the exact trusted encrypted object and recovery purpose. Privately record backup time/key/size, release SHA, custody and isolation. PostgreSQL restore executes archived SQL.
2. Prepare a fresh dedicated PostgreSQL host and `loynara_restore_*` database, with no application or worker connected. Existing Bash, Python 3, `psql`, `pg_restore`, age and AWS tools are required; the script installs nothing. Keep all external integrations and delivery credentials disconnected.
3. Review the backup's exact release migration manifest. `RESTORE_MIGRATIONS_DIR` may point to its absolute `drizzle` directory while running recovery code from a separately reviewed candidate checkout. Every journal file, hash and timestamp must match exactly; an older prefix is never accepted automatically.
4. Recover both archive inventories and private identities, reconcile the fresh hold checkpoint, and keep both writer authorities paused. Set the explicit gates below only after doing those operations.
5. Run `bash /absolute/path/to/reviewed-candidate/scripts/production-restore-check.sh` with private configuration and no shell tracing.

| Variable | Required input |
| --- | --- |
| `RESTORE_TARGET_CONFIRMED` | `isolated` |
| `RESTORE_PGHOST` / `PRODUCTION_PGHOST` | Dedicated private Railway host and distinct production reference |
| `RESTORE_PGDATABASE` | Fresh `loynara_restore_*` database |
| `RESTORE_PGUSER`, `RESTORE_PGPASSWORD`, `RESTORE_PGPORT` | Isolated custodian database login; port defaults to 5432 |
| `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_OBJECT_KEY` | Exact approved encrypted backup |
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_DEFAULT_REGION` | Backup read credentials; region `auto` |
| `BACKUP_AGE_IDENTITY_FILE` | Private local identity, mode 400 or 600 |
| Both erasure configurations above | Current read inventories and offline decryption identities |
| `RESTORE_ERASURE_CHECKPOINT_CONFIRMED` | `current-writers-paused` |
| `RESTORE_LEGAL_HOLDS_CONFIRMED` | `current` |
| `RESTORE_CURRENT_HOLDS_FILE` | Fresh reviewed private JSON checkpoint |
| `RESTORE_TRANSPORTS_CONFIRMED` | `disabled` |
| `ERASURE_POLICY_APPROVED` | `2026-10-15` |

Explicitly set `EXTERNAL_EMAIL_ENABLED`, `PROMOTIONAL_EXTERNAL_EMAIL_ENABLED`, `TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED`, `GOOGLE_WALLET_ENABLED`, `APPLE_WALLET_ENABLED`, `PASSFAST_ENABLED` to `false`; remove `VAPID_PRIVATE_KEY` and all unused delivery credentials. For a separately approved local rehearsal only, use `127.0.0.1`, a dedicated non-5432 port and `RESTORE_ALLOW_LOCAL_ISOLATED=true`; `ERASURE_EXPECTED_DATA_DIRECTORY` must identify the owned cluster. Host guards supplement actual isolation review.

The script refuses a populated target, custom schemas, extensions and large objects, including objects hidden by ordinary table privileges. It preflights the current hold file and both decrypted inventories before importing. It authenticates/decrypts into private temporary files and restores with `--single-transaction --exit-on-error --no-owner --no-acl`. Archive execution failure rolls back the import.

Because no-owner/no-acl imports do not preserve trusted function authority, the reviewed `scripts/provision-retention-roles.sql` must restore and validate dedicated NOLOGIN ownership, fixed search paths and restricted grants before replay. `loynara_maintenance` performs eligibility/purge/holds/expiry cleanup; only the isolated `loynara_restore` role may force-close/replay snapshot subjects. Runtime and routine maintenance must not inherit that role. An isolated administrator may SET ROLE during recovery; production runtime must never receive this authority.

Recovery imports current holds, then replays closure and prepared/completed erasure intents in cutoff order (closure first at equal cutoff). Closure retires restored bearers while preserving retained ledger; erasure prevents resurrection. Current UTC category expiry is then applied in bounded batches until all category counts are zero. A remaining backlog, changed inventories/hold file, unavailable store, invalid authority or legal hold withholds PASS. All outbound effects stay disabled; queued Wallet revocation still requires a separately reviewed later recovery plan.

PASS also requires enabled append-only ledger enforcement, validated tenant constraints, exact complete migration metadata, same-tenant balances equal to ledger sums and no unvalidated public foreign-key/check constraints. Output is aggregate only. Per-tool deadlines default to 600 seconds (`RESTORE_TOOL_TIMEOUT_SECONDS`/`BACKUP_TOOL_TIMEOUT_SECONDS`, integer 1–1800); maintenance queries are bounded at 30 seconds with five-second locks. Expiry reconciliation stops after 20 batches or 120 seconds. Review capacity before raising any bound.

Backups through 0024 have a 25-entry manifest and lack the retention schema/functions. They remain quarantined after archive invariant/manifest checks when provisioning fails. Do not claim them recovered. Apply only separately reviewed additive 0025–0031 migrations under an approved isolated upgrade procedure, re-provision authority, re-import current holds and replay both current archives, then rerun expiry and business/invariant checks. The restore script intentionally does not auto-upgrade or accept occupied targets; a failed reconciliation requires custodian investigation and an explicit reconciliation procedure, not blind rerun.

No script promotes a target or reconnects workers. Before any approved restart, inspect representative cards/balances/redemption/reversal/tenant boundaries, retired credentials, Wallet state, leases and pending sends. Resolve legitimate post-backup changes and current holds. A post-import failure leaves the database quarantined for investigation. Dispose only with authorization. Temporary files are removed on handled exits; host failure may require private cleanup, which is not forensic secure erasure.

## Conditional manifest expiry

Thirty days runs from a covering local purge completion, not closure or preparation. Closure-only and unresolved prepared-only intents never disappear by age. A completed tenant purge may cover earlier member/tenant intents; a member completion covers only that member and an equal or earlier cutoff.

The offline custodian runs `python3 scripts/erasure_manifest.py prune` only after audit, with `ERASURE_PRUNE_CONFIRMED=completed-30-days-and-other-backups-expired`, `ERASURE_OTHER_BACKUPS_EXPIRED_THROUGH` set to the verified UTC expiry cutoff, both archive identities and independent read-only `ERASURE_BACKUP_AWS_ACCESS_KEY_ID` / `ERASURE_BACKUP_AWS_SECRET_ACCESS_KEY`. Actual current database-backup bucket inventory must contain no older backup requiring the candidate manifests. Unknown keys, decryption/list failure, incomplete pagination or a changed checkpoint prevents deletion. The explicit confirmation covers native/ad hoc copies outside that inventory; it must follow actual investigation. Closure objects are deleted before prepared copies and covering completion proofs, preserving recovery authority after an interrupted cleanup. No automatic cleanup of unresolved operations is installed.

## Repeat synthetic checks

```sh
python3 scripts/erasure-manifest.test.py
python3 scripts/production-backup.test.py
python3 scripts/production-restore-target.test.py
python3 scripts/production-encrypted-backup.test.py
```

The drill owns a fresh ephemeral PostgreSQL cluster on a dynamic loopback port, temporary age keys and strictly synthetic data. It uses real PostgreSQL/archive/encryption/application functions; only object-store transport is a private filesystem adapter. It checks ownership and idle connections before removing its databases and stopping its cluster. It contacts no hosted service or existing database. See the evidence record for the final observed run and its limits.
