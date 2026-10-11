# Assignment 127 — Fail-closed restore-target emptiness

Date: 2026-10-12 Europe/Berlin. Coding child LOY-325 under LOY-195; independent acceptance LOY-196 remains open.

## Objective and authorization

Reject occupied isolated PostgreSQL recovery targets across user schemas and non-table objects. Founder’s October 12 local engineering directive and completed coordinator assignment LOY-ENG-20261012-127 authorize this correction. The separate one actual production-backup test was already consumed; this assignment used synthetic data only.

## Source and changes

Base: fb02f5b626b0f8f95f82a20db00039f221506c4f. Implementation/test commit: 3276de303d9e51cac9fb60e946136129f6a20fa6.

scripts/production-restore-check.sh replaces privilege-filtered public base-table counting with PostgreSQL catalog checks. It rejects custom schemas, public namespace dependencies, large objects and custom extensions. Only the built-in plpgsql extension in pg_catalog is allowed as the fresh-database baseline. Existing host/name/consent-to-isolation/key-mode guards remain intact. Unknown, ambiguous or failed metadata refuses before retrieval, decryption or restore.

scripts/production-restore-target.test.py creates its own loopback-only disposable PostgreSQL 18 cluster. Real catalog queries exercise the canonical script. Synthetic transport/decrypt/restore doubles and a non-key placeholder identity prevent R2 access or real decryption. The downstream mocked success is evidence of control flow only, not an additional actual recovery test.

## Verification and review

Unchanged-source RED: 15 occupied-target failures, zero fixture errors after cleanup correction. An earlier test run also had eight fixture-reset errors; the preserved initial run is not used as acceptance evidence.

First correction review: independent read-only reviewer identified namespace-free large objects and extensions installed in pg_catalog. Three additional real synthetic RED cases reproduced these omissions before correction. Final GREEN: seven test methods, including 17 object variants, three metadata-failure variants, five unsafe target identities and limited-privilege table visibility. Populated public/nonpublic tables, empty custom schemas, sequences, views/materialized views, partitions, types, routines, collations, extensions, foreign tables and large objects refuse before external effects. Fresh template0 catalogs and baseline plpgsql pass.

Bash syntax, Python AST/compile, existing synthetic production backup transport, typecheck and git diff whitespace checks passed. Shellcheck is not installed; no tool was installed. No application TypeScript/Next source changed, so the previously accepted application regression/build was preserved as dated evidence rather than rerun or represented as testing this tooling change.

Independent final read-only review: no further material findings within the tested catalog scope; earlier findings closed. Reviewer inspected source/sanitized RED/GREEN evidence, did not execute another restore and accessed no production credentials or records.

## Status and limitations

IMPLEMENTED / TESTED / independently technically REVIEWED. Local integration and push receipts are recorded separately with their exact resulting SHAs. NOT DEPLOYED, NOT independently production ACCEPTED, NOT commercially ready.

The guard does not establish exclusion of concurrent writers or absence of arbitrary superuser changes to PostgreSQL’s system catalogs. Fresh-target ownership and writer exclusion remain separate prerequisites. A nonempty or customized database must not be reused by exempting its objects. No database repair, schema migration, new key, production backup retrieval, service interruption, provider activation or hosted mutation occurred.

Synthetic resources created by the seven-test run were stopped and removed by its owned-cluster cleanup. Existing worktrees, recovery identity, encrypted production object, frozen NFC references and immutable reviewed application 153928b10db55cbd0b40351116ee54515a6b107c are preserved.

## Execution and accounting

Codex existing effective executor; requested gpt-6.1-sol/high and existing independent reviewer. No supported model setter was used; no model upgrade, additional coding worker, dependency install or worktree was created. Original Goal 01a125a6-7124-70f1-a0f7-8b6f83d9a191 remains BLOCKED; last measured cumulative usage 16,624,937 tokens / 92,240 seconds. This task’s input, cached subset, output, browser and review usage is unmeasured.

Durable sanitized RED/GREEN receipts: primary var/native-goal-20261010/assignment-127-red.txt, assignment-127-red-verified.txt, assignment-127-review-red.txt and assignment-127-final-green.txt. Canonical tests reconstruct the correction without conversation memory.

## Next dependencies

LOY-195/196 remain open for independent production recovery acceptance, final fresh recovery-point procedure, writer shutdown/drain and separate cutover authorization. Reviewed application release remains 153928b; production last observed generation remains 792e218a17287009067ce0993c33eda3bfc3f4b7 / schema 0020. Migrations 0021–0024, same-generation web/worker deployment and hosted acceptance are not executed. After integration, one coordinator completion review selects the next grounded independently executable requirement; no speculative feature is authorized by this record.
