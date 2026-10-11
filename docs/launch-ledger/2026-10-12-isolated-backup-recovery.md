# October12 — actual encrypted backup local recovery

**LOY-195 / LOY-196; FOUNDER-SPRINT-20261012-RECOVERY.** Direct founder Section5 authorizes exactly ONE named-object local recovery test. Existing executor/reviewer retained; no model upgrade, new worktree, installation or scope change. Base **99b4564d62bf8f372e874a3d31b7d8e289787701**; immutable application **153928b10db55cbd0b40351116ee54515a6b107c**. This is a ledger-only receipt; exact finalized local/integrated/remote SHAs are preserved in native state and the completed strategic report.

## Verified outcome

**RETRIEVED:** only the authorized object loynara-rc-backups/loynara/2026/10/11/20261011T030225Z-19970f3c172a.dump.age. HEAD:175156bytes, lastModified2026-10-11T03:02:27UTC, ETag e00a64e7f2d1f2014dd9f5edf3d84314. Ciphertext SHA256 **2907f22ed330d59be55a13a4615f56b2e1dd1d1093ce97b355cffeb91dd58b0a**; single-part ETag equals calculated MD5. No trusted independently recorded SHA256 manifest was supplied/found in the specific object records.

**AUTHENTICATED DECRYPTION / ISOLATED POSTGRESQL18.6 RESTORE: PASS; one actual restoration.** Existing private identity reverified; owner-only mode600/inode/size/mtime unchanged. No private key/credentials/plaintext customer records were printed, uploaded, copied into evidence or hashed. The new local cluster used loopback, a non5432 port, private socket/data directory and SCRAM authentication; emptiness across all user schemas was checked immediately before the attempt.

Existing pinned restore-script guards were preserved. A temporary operation-local copy added only a fail-closed ciphertext SHA256/byte checkpoint immediately before decryption, bound to reviewed checkpoint content and exactly one insertion. Original script equality outside that insertion was verified; no repository executor or orchestration infrastructure added.

## Tests and review

- **21 canonical journal hashes/timestamps through0020 match.**
- **49 table/column definitions match**:45 application tables from0020 snapshot plus4 separately defined in committed auth.sql. Types/nullability/varchar lengths checked. Auth4PK, email/token uniqueness,2 cascading user FKs and3 canonical indexes verified.
- 583 constraints/76FKs; zero unvalidated constraints or invalid/not-ready indexes; enabled append-only ledger trigger and5 Wallet lifecycle columns verified.
- Aggregate counts only:1tenant,1location,1programme,4memberships,11ledger entries,3redemptions,21journal entries. No individual identity/contact/card/token/production row exported to AI or Git.
- **12 business invariant violation counts are zero**: tenant references, balance/ledger agreement, nonnegative balances, idempotency/locator uniqueness/format, reversal conservation and redemption ledger/version binding.
- Synthetic cross-tenant membership is refused by the exact tenant FK; ledger deletion is refused by the append-only trigger. Both transactions rolled back; aggregate counts unchanged.
- Corrupted ciphertext fails authentication;3 invalid target configurations and a populated local target refuse before restore. No second actual restoration.
- Synthetic safety checks:2 valid loopback forms,6 invalid identities, changed-target refusal before attempt,4 unsafe checkpoint variants and bounded parent/child process-group termination.

Initial preparation stopped on PostgreSQL's127.0.0.1/32 format. Strict parsing fixed it without weakening address/port/database/data-directory/emptiness gates. Initial snapshot-only schema validation refused four auth tables; fresh canonical auth.sql checks correctly established the complete49-table inventory. Initial sanitized failure is preserved; no arbitrary extra tables accepted or database schema/data altered. Minor fixture/serialization/default-sandbox process-inspection failures caused no restoration; normal escalation inspected only owned synthetic processes.

**INDEPENDENT READ-ONLY TECHNICAL REVIEW:** existing release123_review found no material findings in final source and sanitized results. Earlier fresh-target/key/script, timeout-descendant and checkpoint-binding findings were reproduced/corrected before execution. Reviewer read no keys, credentials, recovery artifacts/private logs or DB records and executed no recovery. This is technical source/evidence review, not independent production recovery acceptance.

## Cleanup and remaining gates

**TEMPORARY RESOURCES REMOVED:** only this test's new local cluster, ciphertext/plaintext/local password/private logs/probes were stopped and removed; local port no longer listens, original identity unchanged. Existing worktrees/services/resources untouched. Disk37GiB available before setup and36GiB afterward; no unrelated cleanup/install.

**LOY-195/196 remain open.** No production database connection, fresh production backup, deployment, migration, service interruption/configuration change, provider activation/customer send or physical NFC operation occurred. One-test authorization is exhausted. Independent production recovery acceptance, source-production count/history reconciliation, full physical-schema equivalence, offline custody, HTTP authorization and merchant readiness remain unverified. October11 recovery is not the required fresh post-drain cutover point; further actual recovery/cutover requires applicable separate founder authority.

Application source unchanged: preserve dated125184files/1685PASS/0FAIL/one existing optional Mailpit skip/build and12672PASS/typecheck/lint/review. No redundant application suite/build run. Deployable source remains **153928b10db55cbd0b40351116ee54515a6b107c**; last hosted792e218 observation is dated, not refreshed by this test.

Original native Goal01a125a6-7124-70f1-a0f7-8b6f83d9a191 stays **BLOCKED**,16624937tokens/92240seconds preserved; additional input/cached/output/browser/reviewer usage UNMEASURED, no reset/successor/bypass. Founder permits normal independent local work. Next: complete strategic review, then grounded MustLaunch task selected within15–20minutes; recovery task completion is not Goal/launch completion.

Sanitized evidence: native recovery-20261012-result.json, safety tests, restored-ciphertext binding, preserved initial schema check and source-only operation archive. No private recovery artifacts in this ledger.

Traceable evidence-validation amendment: the first default-sandbox formatting/validation call was refused before validation and the receipt was committed before that failed check was noticed. Full JSON/privacy/diff/source checks were rerun successfully under normal authorized access before any push; no accepted history rewritten or product source changed. This formatting amendment preserves the initial commit and all recovery evidence.
