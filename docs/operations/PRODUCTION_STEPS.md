# Production operator steps — release and activation gates

Prepared 15 October 2026. **No production action, real-data read, deployment, migration, configuration change or deletion was authorized or performed in this work.** These are reviewable instructions for a future separately approved operator session. The owner reports web/worker at `680266d7d627bd781a8633f419e49275e6c27294` and PostgreSQL through 0024; this has not been inspected here.

The owner approved all five [retention-policy decisions](RETENTION_POLICY_PROPOSAL.md) for code and synthetic tests, policy version **`2026-10-15`**. Production activation remains gated by the actual controller/processor roles, legal contact/notice review, named custodians, statutory accounting classification and the independent security/release review. Do not describe the approved implementation policy itself as pending.

## Required release record

Record owner/window/incident authority; reviewed full release SHA and immutable artifact; web/worker/ops/backup/scheduler deployment identities; exact private database/environment/origin; nonsecret configuration revision; independent review findings; [validation](VALIDATION.md) and [restore evidence](RESTORE_DRILL_EVIDENCE.md); fresh verified encrypted backup identity; private role/contact roster; approved caps and monitoring recipients. Missing evidence or an unresolved blocking finding stops release.

The additive manifest is:

| Migration | Change |
| --- | --- |
| `0029_operational_resilience.sql` | Aggregate operational counters and shared monthly provider attempt accounting |
| `0030_customer_export.sql` | Scoped one-use, ten-minute export proof challenges; only credential/contact hashes |
| `0031_data_retention.sql` | Closure/receipt/inactivity/hold/classification metadata, guarded retention functions and narrow immutable-history DELETE authority (the only DELETE allowed on 0025's append-only `reward_versions`/`redemptions` is by the purge owner) |

These follow `0025_data_integrity_guards.sql` (main release), `0026_plates.sql` and the reserved 0027 and 0028, which must be applied first. On this branch the journal through 0031 contains 30 entries (0027 and 0028 not yet present). Recompute and approve every migration's hash/timestamp from the **exact reviewed release**, including historical entries; do not substitute this count for the complete manifest. These schema changes do not authorize deleting real data. A later scheduled activation executes the policy's irreversible work.

## 1. Complete preparation without production access

1. Finish the full synthetic suite, typecheck, changed-file lint, production build, independent review and isolated encrypted restore/reconciliation tests. Use the current [validation record](VALIDATION.md); do not infer success from an old count or historic drill.
2. Review [lifecycle operations](DATA_LIFECYCLE_RUNBOOK.md), [customer requests](CUSTOMER_DATA_REQUESTS.md), [rollback](INCIDENT_ROLLBACK.md), [breach response](BREACH_RESPONSE.md), [backup/restore](BACKUP_RESTORE.md) and [service limits](SERVICE_LIMITS.md). Assign Incident Lead/alternate, Release Operator, Privacy Lead, Backup/Erasure Custodian/alternate and Merchant Communications Owner privately.
3. Record the owner's concrete release/activation approval. Have the owner/accountant define the per-merchant genuine statutory-record classification procedure and restricted archive process. Unclassified closed tenants must fail closed; do not mark all tenants `no_statutory_records` as a deployment shortcut.
4. Review rollback against the current deletion/closure protections, fixed role authority and current erasure checkpoint. A historical artifact is not compatible merely because its queries run on an additive schema. Do not deploy old code that can revive a deleted subject or bypass the policy.

## 2. Authorized operator verifies live prerequisites

1. Select and record the exact project/environment/services/private database. Confirm the reported full SHAs and migration manifest using authorized aggregate/schema-only checks, without copying customer rows into development evidence.
2. Keep automatic deployments disabled. Preserve private ingress, exact HTTPS origins, restricted callbacks, log redaction and existing integration approvals. Record current deployment IDs and safe configuration revisions privately, without environment values/connection URLs in tickets.
3. Verify current encrypted backup freshness and private key custody, and the independently tested isolated restore procedure. Keep the existing approved daily 03:00 UTC backup and 14-day backup-prefix lifecycle unless separately changed. No production backup is copied into a development checkout.
4. Verify the approved platform spending policy/headroom; Stage-A's documented Compute warning $10/hard limit $16 and Hobby plan are not a total invoice cap. No ceiling/plan increase is authorized here.
5. Verify independent web, worker, ops and backup freshness checks and private alert destinations. Arrange a separate retention monitor before scheduling deletion. An unhealthy/unknown baseline stops activation.

## 3. Apply reviewed additive migrations under administrator authority

1. Use a separately approved one-shot migration artifact with an exact-target secret-injected `MIGRATION_DATABASE_URL`. Migration 0027 requires an authorized database administrator able to create/verify NOLOGIN roles and repair function ownership/grants; application runtime credentials are unsuitable. Preserve production guard settings (`NODE_ENV=production`, `PRODUCTION_ENVIRONMENT=loynara-production`, reviewed ingress/origins and existing required configuration).
2. Run only the approved one-shot command:

   ```sh
   PRODUCTION_MIGRATION_APPROVED=true npm run production:migrate
   ```

3. Verify complete journal names/hashes/timestamps and expected structures from the approved artifact. A refusal is a stop condition; inspect sanitized state before any retry. Never seed, rewind migration history, disable append-only guards or run down migrations on live data.
4. From the same trusted artifact, under the authorized administrator identity, verify/repair narrow function authority:

   ```sh
   psql -X -v ON_ERROR_STOP=1 -f scripts/provision-retention-roles.sql
   ```

   The script deliberately does not grant LOGIN memberships or ordinary business-table privileges. Existing unsafe roles/memberships fail closed; do not weaken the check or alter another role to make it pass.

## 4. Provision distinct private logins and ordinary runtime privileges

Use the restricted administrator console, not the application. Select dedicated actual login names; the examples below name the intended roles explicitly and must be checked for collisions before execution. Do not reuse an existing owner/superuser login. Supply private passwords interactively or through the approved secret manager; never commit them or put them in shell arguments/history.

```sql
CREATE ROLE loynara_web_login LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE loynara_maintenance_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
CREATE ROLE loynara_restore_login LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
GRANT loynara_runtime TO loynara_web_login;
GRANT loynara_maintenance TO loynara_maintenance_login;
GRANT loynara_restore TO loynara_restore_login;
```

In `psql`, `\password loynara_web_login`, `\password loynara_maintenance_login` and `\password loynara_restore_login` prompt without displaying a password. Grant CONNECT only on the intended database(s) using the actual approved identities. Restrict the restore identity to its isolated target; it is never an application/scheduler credential. Never grant membership in `loynara_purge_owner`, or overlap runtime/maintenance/restore membership. Do not grant CREATE on the public schema or ownership of business tables/functions to these logins.

Review this explicit ordinary application allowlist against the exact release before granting it. Immutable history receives SELECT/INSERT, with its existing guards still active. Private holds/classification/auth-subject metadata and erasure functions are excluded; the provisioning script grants only the narrower specific interfaces needed for them.

```sql
GRANT SELECT,INSERT,UPDATE,DELETE ON
  public.locations,public.staff_roles,public.staff_invites,public.programs,public.rewards,
  public.membership_contacts,public.contact_verification_challenges,public.customer_export_challenges,
  public.card_recovery_challenges,public.secure_tags,public.tap_requests,public.staff_push_subscriptions,
  public.offline_award_leases,public.offline_award_events,public.outbox_jobs,public.email_deliveries,
  public.email_provider_events,public.email_suppressions,public.campaigns,public.campaign_recipients,
  public.campaign_attempts,public.campaign_daily_usage,public.automation_rules,public.automation_runs,
  public.wallet_passes,public.apple_devices,public.apple_registrations,public.referral_settings,
  public.referral_codes,public.referrals,public.subscriptions,public.billing_location_plans,
  public.billing_handoffs,public.billing_invoices,public.billing_webhook_events,public.demo_requests,
  public.rate_limits,public.operational_counters,public.service_usage,public.inactivity_reviews,
  public."user",public."session",public."account",public."verification"
TO loynara_runtime;
GRANT SELECT,INSERT,UPDATE ON public.memberships,public.tenants TO loynara_runtime;
REVOKE DELETE,TRUNCATE ON public.memberships,public.tenants FROM loynara_runtime;
GRANT SELECT,INSERT ON public.ledger_entries,public.program_rule_versions,public.reward_versions,
  public.staff_audit_events,public.card_security_events,public.consent_events,public.purchase_awards,public.redemptions
TO loynara_runtime;
```

Do not replace that review with `GRANT ALL ... ON ALL TABLES/FUNCTIONS`. Check actual effective privileges and role memberships: runtime cannot read private hold reasons/classification or execute purge/replay/setter functions; maintenance/restore cannot perform arbitrary DML; ledger UPDATE/DELETE is refused outside narrow eligible private functions. Verify against an isolated synthetic fixture first, then use only separately authorized nonsecret privilege/schema checks on the real target. A future application query requiring another privilege must receive a reviewed narrow grant.

## 5. Prepare the independent archive before deploying closure code

1. The Custodian provisions two private independently protected EU namespaces, separate from the backup `loynara/` prefix and 14-day lifecycle. Closure and purge archives must use **different buckets** and independently scoped credentials; a prefix alone is not the permission boundary. Runtime may write only closure records, never prepared/completed purges. Assign public age recipient and off-runtime private-key custodians. Review writer versus custodian/read/prune storage privileges. Record namespace identity, retention and verified access privately; no deletion scheduler is enabled yet. Both card and merchant closure require a durable encrypted closure intent before database commit; the namespace must therefore be ready before deploying the new web/worker artifact. Archive refusal rolls the closure transaction back and reports failure, with retry/assisted operator access.
2. Secret-inject the exact `ERASURE_S3_ENDPOINT`, `ERASURE_S3_BUCKET`, `ERASURE_S3_PREFIX`, `ERASURE_NAMESPACE_ID`, `ERASURE_AWS_ACCESS_KEY_ID`, `ERASURE_AWS_SECRET_ACCESS_KEY` and public `ERASURE_AGE_RECIPIENT`. Also configure the separately scoped closure settings in step 3 before running either initialization. From the reviewed custodian environment, only after confirming both new namespaces:

   ```sh
   ERASURE_INITIALIZE_CONFIRMED=new-protected-namespace python3 scripts/erasure_manifest.py initialize
   ERASURE_INITIALIZE_CONFIRMED=new-protected-namespace python3 scripts/erasure_manifest.py initialize-closures
   python3 scripts/erasure_manifest.py check-namespace
   ```

3. Configure the separate closure bucket with `ERASURE_CLOSURE_S3_ENDPOINT`, `ERASURE_CLOSURE_S3_BUCKET`, `ERASURE_CLOSURE_S3_PREFIX`, `ERASURE_CLOSURE_NAMESPACE_ID`, `ERASURE_CLOSURE_AWS_ACCESS_KEY_ID` and `ERASURE_CLOSURE_AWS_SECRET_ACCESS_KEY`; use its reviewed `ERASURE_CLOSURE_S3_ENDPOINT` and public `ERASURE_CLOSURE_AGE_RECIPIENT` (or fallback `ERASURE_AGE_RECIPIENT`). The commands in step 2 initialize each namespace separately; `check-namespace`/`verify` require both stores. Verify both namespaces and bucket-scoped permissions before deployment. Runtime needs the nonsecret `ERASURE_S3_BUCKET` name to verify bucket separation, but must never receive purge-bucket credentials.
4. **Capture pre-existing closures before activation.** Under the separately authorized source-read/custodian session, keep writers and pruning paused and inventory every already-closed tenant plus closed memberships whose tenant remains open. Legacy closure at 0024 did not create the new archive. For each subject, submit a strict JSON object to `python3 scripts/erasure_manifest.py record-closure` through private stdin: `scope` (`tenant` or `member`), `tenant_id`, nullable `member_id`, the actual UTC `closed_at` as `cutoff_at`, and an existing deletion-receipt UUID or a newly generated random UUID as `intent_id`. Use the initialized closure-only writer configuration and approved policy; never include email, bearer, ledger contents or a fabricated completion status. Require a successful verified upload for every inventory entry, then have the custodian decrypt/verify both namespaces and reconcile the subject/cutoff inventory before enabling schedules or declaring old backups recoverable. Record aggregate counts/checkpoint privately, not identifiers in tickets. This records closure obligations; it does not purge rows or contact Wallet providers. A missing or unreconcilable historical closure/erasure obligation blocks activation and restore signoff.
5. Review durable closure-before-commit, encrypted intent-before-purge, prepared-intent recovery and current hold checkpoint procedures. Missing archive/identity/evidence must stop erasure. Current backups remain protected by current independent closure and purge replay; do not rely on the backup's older manifest.

## 6. Deploy exact artifacts and activate only approved operations

1. Secret-inject the restricted runtime `DATABASE_URL` into web, worker and ops. Remove administrator/migration/maintenance credentials and private age identities from their environments. Supply the verified public `ERASURE_CLOSURE_AGE_RECIPIENT` (or fallback `ERASURE_AGE_RECIPIENT`), approved closure endpoint, `ERASURE_POLICY_APPROVED=2026-10-15` the nonsecret `ERASURE_S3_BUCKET` name, and **closure-only** `ERASURE_CLOSURE_*` namespace/writer configuration to web/worker. Never supply purge-bucket credentials or the private age identity to those services. Supply matching reviewed `SERVICE_EMAIL_MONTHLY_LIMIT`, `SERVICE_WALLET_MONTHLY_LIMIT`, `SERVICE_PUSH_MONTHLY_LIMIT` to every caller and ops; proposed defaults are 1000/5000/10000 attempts per UTC calendar month. Caps do not enable providers. Preserve all separate provider approvals/switches.
2. Deploy web/worker/ops from the exact reviewed full SHA/artifact and record each deployment ID. Verify private ingress, safe start/pre-deploy commands, `/api/health`, worker freshness and one bounded `npm run production:ops-check`. Do not use a moving branch head or implicit historical migration command.
3. Deploy the retention job from the same artifact only after separate irreversible-policy activation approval. Configure runtime `DATABASE_URL` plus **separate** maintenance `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` and private credential injection, `ERASURE_POLICY_APPROVED=2026-10-15`, `PRODUCTION_ENVIRONMENT=loynara-production`, public encryption settings, separate purge-archive authority, closure-only writer configuration for inactivity, and independent `RETENTION_HEARTBEAT_URL`. The job invokes `SET ROLE loynara_maintenance`; no private decryption key/admin credential belongs there.
4. Before any lifecycle mutation, the job compares actual `current_database()`, `inet_server_addr()` and `inet_server_port()` from runtime and maintenance connections. Missing or different identities refuse the run. Use direct private connections; a pooler/proxy that prevents identical verified server identities requires operator review, not bypassing the check. The reviewed job command is `npm run retention:prune`. Propose every five minutes with monitored early failure/staleness. Each batch reviews up to 50 inactive-zero cards and 50 nonzero flags/cleanup rows, prunes 100 rows per table/category, and fetches at most 50 total card/tenant purge candidates. It repeats bounded batches until work is drained, with a 240-second overall work budget. Each purge child gets 45 seconds of work, then TERM and a two-second cleanup grace before KILL; a new child requires 47 seconds remaining. Inactivity receives the same cycle deadline and requires 62 seconds before another closure archive. Each card closure commits independently. Budget exhaustion, remaining backlog, a failed stage or unknown target produces no success heartbeat. Overlap skips without a success heartbeat. Configure early failure/staleness alerts against the five-minute schedule and measured backlog; at least daily category retention is mandatory, and 24-hour erasure needs shorter failure detection.
5. Verify the existing backup service's current trusted artifact/namespace check without changing its approved schedule. Missing independent erasure namespace must block backup/restore readiness rather than producing a misleading recovery PASS. Observe actual scheduled results and alert delivery under separate authorization.

## 7. Verify, hand over and retain rollback protections

Use only separately authorized bounded synthetic fixtures for functional production checks. Real customer closure/export, actual messages/pushes/Wallet changes and deliberate quota exhaustion are not smoke tests. Where no approved fixture exists, record **NOT RUN** and keep that functional gate open.

Verify exact artifacts/journal/roles, independent monitor acknowledgments, provider caps, queue state, erasure/hold/classification alerts and current backup freshness. Record actual next scheduled runs and timestamps; no local drill proves production delivery/custody. Keep accounting classification and operator/legal launch gates explicit. Owner acceptance of a technical deployment is not commercial launch approval.

If a gate fails, contain the affected operation and follow [incident rollback](INCIDENT_ROLLBACK.md). Keep 0026–0028 structures/journal and consumed provider accounting. Do not restore over live data or roll back to code that bypasses deletion protections. An old 0024 backup stays quarantined until validated against its historical manifest, additively migrated from the trusted current recovery release, re-provisioned, reconciled with **current** holds and independently durable closure/erasure intents (including closures not yet purged), and revalidated before any web/worker start. See [lifecycle restore procedure](DATA_LIFECYCLE_RUNBOOK.md#restoring-without-resurrecting-deleted-subjects). Schema removal and real-data recovery require separate authorization; erased data is not recovered by an application rollback.
