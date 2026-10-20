# Synthetic encrypted restore evidence — 15 October 2026

LOY-195: synthetic local recovery passed; production recovery remains unverified. This record covers the shared `feature/data-lifecycle-resilience` candidate, based on `eb493536aa994f429177b3e7caa4ee1ee958882c` plus the accompanying retention/recovery commits. Final frozen-candidate drill completed on 15 October 2026 at 11:11 UTC. The candidate contains 28 complete journal entries through `0027_data_retention`; these results do not describe a deployed release.

## Re-run after merging railway-rc — 16 October 2026

After `railway-rc` (`610a44b`, with `0025_data_integrity_guards`) was merged into this branch and its migrations became 0026–0028, the drill was re-run on PostgreSQL 18.6 and age 1.3.2: `python3 scripts/production-encrypted-backup.test.py` **21 cases PASS** (the 20 below plus `test_09b`, which proves an unexpected NOT VALID constraint still withholds PASS), 29 journal entries, 59 source tables. `production-restore-target.test.py` 9 PASS, `erasure-manifest.test.py` 24 PASS, `production-backup.test.py` PASS. The restore check now accepts exactly the five checks 0025 adds NOT VALID on purpose. The record below describes the earlier 0027-based candidate.

## Observed checks

| Command | Observed result |
| --- | --- |
| `python3 scripts/production-encrypted-backup.test.py` | 20 cases PASS, 57.153 seconds including cleanup |
| `python3 scripts/erasure-manifest.test.py` | 24 cases PASS, 9.015 seconds |
| `python3 scripts/production-restore-target.test.py` | 9 cases PASS, 8.970 seconds |
| `python3 scripts/production-backup.test.py` | Upload/HEAD/heartbeat, failure privacy, bounded upload, timeout validation and both archive-anchor gates PASS |
| `bash -n scripts/production-backup.sh scripts/production-restore-check.sh` | PASS |
| Python AST parsing of manifest and four Python test files | PASS |
| `./node_modules/.bin/eslint scripts/encrypted-backup-fixture.ts` | PASS |
| `git diff --check` | PASS |

Actual tools: PostgreSQL 18.6 and age 1.3.2. Both database suites owned fresh private temporary PostgreSQL clusters on dynamically selected loopback ports, checking their data directories before use. They did not use the shared integration database. No dependencies were installed. Temporary keys had owner-only permissions; private test directories mode 700. Unique databases and clusters were cleaned after checking ownership and idle connections.

The encrypted drill uses real PostgreSQL archive tools, encryption/authentication/decryption, constraints, triggers, trusted retention-role provisioning and application functions. Its sole object-store substitute transports ciphertext inside a private temporary directory and rejects unexpected endpoints, buckets and paths. A guarded dump adapter maps the synthetic production-shaped hostname to the owned cluster. No hosted backup, real customer data, production key or provider delivery was used.

Frozen migration SHA-256: `15fd5aa424622b1bf3212f3568f28d048da16caeb792b4f81380a8409c262af4`; trusted provisioning SHA-256: `f7b713843c46b3e3a381ddeccaa8add6a40fa68b94d01da41d4a2f69f3754ffc`. Both matched before and after the drill.

Temporary synthetic backup fingerprint from that successful run:

```json
{
  "ciphertext_bytes": 233508,
  "ciphertext_sha256": "7610f88e16c1f79ac3529144b2f1fb13086151cf3418bcae28ee9ee8071a31e2",
  "source_tables": 59,
  "migrations": 28,
  "synthetic_only": true,
  "real_age_and_postgresql": true,
  "hosted_transport": false
}
```

This identifies a disposable synthetic artifact, removed with the test directory. Its keys, IDs, times and ciphertext vary between runs. It is not a production recovery source.

## What recovery exercised

- All 59 public/journal tables matched source row counts and sorted-row fingerprints in the unchanged baseline restore. Empty tables were included; this does not imply every schema category contained representative records. The source remained unchanged.
- Two synthetic merchants/cards had balances of 2, eight ledger rows, two redemptions, two reversal links, two Wallet identities and two processing jobs with claim tokens. Restored application reads and balance/ledger/redemption/reversal relationships passed; ledger mutation and cross-tenant reassignment were rejected. An idle worker with outbound transports disabled processed zero due jobs.
- Wrong identities, corrupted/truncated ciphertext, broad identity permissions, occupied targets and incomplete release manifests failed safely. A foreign-key archive error rolled back all imported application objects. Balance mismatch, changed migration hashes and a disabled ledger guard withheld PASS. Explicit exact-release migration directories worked; changed SQL content refused.
- A real member closure published an independently encrypted closure intent before commit. Restoring the older open-card backup with only that closure intent retired the old bearer, denied closed-card reads and preserved all eight ledger rows. A separate encrypted tenant closure intent also shut down the old tenant/card snapshot without erasing ledger. Every tenant-scoped table of the surviving tenant matched its original fingerprint.
- A real eligible member purge archived prepared and completed intents. Recovery of the old backup removed the erased member and its ledger while preserving the surviving tenant and application behavior. Runtime and routine maintenance were denied the force-close recovery function.
- Failure to publish prepared intent prevented purge. Simulated failure after commit but before completion upload left a real encrypted prepared-only intent; replay still removed the old snapshot subject. Simulated rollback after preparation left the subject intact locally but retained the recovery intent.
- For that prepared rollback, a separately captured current post-backup ledger hold was imported through fixed setter calls before replay. Recovery refused PASS, preserved the held subject and surviving tenant, and retained the active hold. The checkpoint included an apostrophe-bearing reason as data, with no executable SQL accepted.
- An expired operational row added to an older archive was removed by current-UTC maintenance pruning before PASS. Unit checks require zero counts across all categories and reject invalid measurements or a remaining bounded backlog.
- Closure CLI encryption/upload/HEAD works with no database variables, private identity or purge credentials. Wrong-purpose records and shared bucket names are refused. Both archives are decrypted before replay, closures precede equal-cutoff purges, and inventories must remain unchanged through signoff.
- Thirty-day cleanup boundary checks retain unresolved prepared-only and closure-only intents. Covering completed purge evidence, current backup inventory and explicit expiry confirmation for other copies are required. Older backups, missing consent or decryption failure prevent deletion. Closure objects are removed before covering purge proof.
- A real detached blocking child survived CLI termination before the fix. After tracked group cleanup, termination kills and reaps it; internal tool deadlines also reap children. Raw synthetic transport secrets and database diagnostics remain suppressed.

## Limits

Policy `2026-10-15` was approved for implementation and synthetic testing; production activation was not authorized. No production data, variables, infrastructure, schedules, bucket policy or lifecycle was changed. These tests do not verify hosted durability/IAM, actual lifecycle deletion or all native/ad hoc backup copies, real key custody, independent human recovery, complete web journeys, every populated data category, due-job/provider reconciliation, current production artifact freshness or disaster-scale performance. No production RPO/RTO is established. Use the [quarantined recovery procedure](BACKUP_RESTORE.md) for separately authorized actual-data recovery; older 0024 snapshots also need an explicitly reviewed isolated additive upgrade before retention replay.
