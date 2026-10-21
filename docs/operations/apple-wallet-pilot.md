# Apple Wallet pilot operations

This candidate changes application behavior only. Providers remain OFF. No migration, mapping approval, provider request, secret rotation, or production deployment is part of engineering verification.

## Release with providers OFF

Release the reviewed SHA to web first, then worker, retaining both previous application artifacts. Keep `PASSFAST_ENABLED=false`, `APPLE_WALLET_ENABLED=false`, `GOOGLE_WALLET_ENABLED=false` and the existing NFC, delivery, billing, registration and invitation settings. Missing mappings are safe while disabled. Verify source identities, health, owner/cashier auth, customer card and returning join, queue handover, no Wallet actions and no provider traffic. Confirm schema 0020 and 21 canonical journal entries. Stop/roll back on any failed gate. Do not migrate or move a release branch implicitly.

## Approved scope

An owner must approve one real tenant UUID, location UUID, immutable published template UUID, App ID, merchant branding and language. Set the identical `PASSFAST_TENANT_TEMPLATES` JSON in web and worker:

```json
[{"tenantId":"<approved tenant UUID>","locationId":"<approved location UUID>","templateId":"<approved published template UUID>"}]
```

Since ENG-046 a further location needs no redeploy: on /operator, Geschäfte → „Vorlage setzen“ (dry run, then confirm) stores the binding in the database (`wallet_template_bindings`, audit in `wallet_template_binding_events`). A location's database binding wins over its env binding; the env variable stays the read-only fallback. It must keep at least one valid binding while PassFast is on (the startup check and the deployment-wide availability read it), so it cannot be emptied after the import. Add new shops only on /operator, never in the env: a template is checked against both sources only when it is set on /operator, and `config-check` cannot see the table. Copy the env bindings in once with `npx tsx scripts/operator-wallet-templates.ts import --target loynara-production --actor-user-id <operator id>` (dry run, then `--execute`); it never overwrites a location already set. The same rules hold for both sources: one template per location, no template shared, no fallback.

This is an illustration, not valid deployable configuration. Duplicate scopes and shared template IDs are rejected. There is no global template fallback, including development. Use `PASSFAST_WALLET_TYPES=apple`; retain both native providers OFF. Global PassFast enablement alone grants no customer access. UI/status/issue resolve the card's database tenant and programme location; browser-supplied tenant, location, template and pass IDs grant nothing. Google generation, reads, updates and voids are rejected when Google is excluded.

New managed projections store a binding fingerprint with the original stable serial in the existing provider ID column. It binds tenant/location/App/template and survives key rotation. A changed binding fails closed, without adopting another template or regenerating. Untagged legacy managed projections also fail closed: check the retained release evidence and perform a fresh approved read-only count before activation. Any legacy row needs a separately reviewed ownership reconciliation, not an automatic backfill. No schema migration is required.

Shared PassFast App assets can affect every template in the App. Application code does not write those assets. Merchant-specific template/App ownership, language, logos and permission to use Apple marks need owner approval; avoid shared asset edits while another merchant uses that App. Technical eligibility is not authorization to onboard paying merchants or proof of licensing/commercial compliance.

## Time limits and queue monitoring

Apple issue/status POSTs have a 15-second wall-clock deadline covering body, pool acquisition, rate limit SQL and transactions. They make no provider calls. Pending issuance returns 202 and authenticated card-scoped status produces a fresh 120-second, two-use ticket only after outbox completion. The browser polls no faster than five seconds, bounds individual requests to 20 seconds and the preparation wait to five minutes; another tap resumes the same identity rather than resetting failed jobs.

Download GET has a 65-second wall-clock deadline and fetches only an already prepared archive; the provider HTTP request is bounded to 45 seconds (including body reads). Redirects are disabled. It cannot create, synchronize or repair a pass. Expired tickets require a new protected status request. Closure, reissue, disablement or scope changes invalidate release of an archive.

Worker provider synchronization retains its 240-second budget and 45-second individual HTTP limit. The parent bounds a Wallet job to 270 seconds including claim, child loading, database stalls, provider requests, reaping and outcome/cleanup. Lease renewal is every 30 seconds, fenced by attempt and unexpired lease after locking. Monitoring runs independently, with dedicated pool and bounded network/SQL. Worker shutdown stops claims, aborts/reaps the child, and records an uncertain retry only while owned. Forced death closes IPC and the child exits; an expired claim is recovered by a new worker using the same serial and durable `creating` state. At most five claims with 60/240/960/3600-second backoffs; failed/blocked work requires operator review. A provider timeout does not prove remote failure: reconcile metadata by the original serial before any create retry. Never replace a serial to hide uncertainty.

These HTTP bounds fit published general Cloudflare 125-second and Railway 300-second limits. Before activation, verify the actual Cloudflare Tunnel route and Railway settings, health monitor freshness/restart policy and shutdown grace accommodate this deployed build. Do not substitute a long customer-facing sync request. An in-flight provider request may still complete remotely after local cancellation; lease fencing prevents stale database completion, while stable identity and absolute state reconciliation handle the remote uncertainty.

## Cap and quota

Before enabling a pilot, record an owner-approved issuance cap, provider account quota and alert/stop threshold. No automatic commercial quota claim or new billing feature is included. Enforce this initial supervised cap operationally: authorize a bounded cohort, review counts before admitting the next customer, and disable PassFast before exceeding the cap. If unattended issuance is required, approve a transactional admission cap as a separate prerequisite; rate limits are not an issuance quota.

Use an approved read-only operator connection to count all attempts/reservations, including pending and revoked projections, for the pilot location:

```sql
SELECT wp.status, count(*)
FROM wallet_passes wp
JOIN memberships m ON m.id = wp.membership_id AND m.tenant_id = wp.tenant_id
JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
WHERE wp.tenant_id = $1 AND p.location_id = $2
  AND wp.provider = 'apple' AND wp.provider_object_id LIKE 'passfast:%'
GROUP BY wp.status;
```

Inspect Wallet pending/processing/retry/failed/blocked totals and lease age through existing operator queue tools. Compare app counts with PassFast's account dashboard usage and the account's actual published quota; include uncertain creates, updates and voids, which can consume quota. Do not assume only completed local projections consume quota. Alert on stale heartbeat, rising retries, uncertain generation or unexpectedly broad account usage. Disable admission promptly and investigate the original identities; do not reset attempt counts blindly.

## Account-wide credentials and rotation

Separate API keys still have full-account authority. Scope binding protects application access, not a compromised key or provider account. Keys belong only in the server runtime secret store for web/worker, never browser code, source files, tickets, logs, screenshots, command arguments or outbox payloads. No dashboard API is exposed by the application. Restrict provider/account access to approved operators and review dashboard usage for unrelated changes.

Rotation needs explicit owner authorization. Disable admission; drain/reap active requests and note uncertain identities. Create a new uniquely named key in the authenticated dashboard; inject it through the approved secret mechanism into both web and worker without displaying/logging values. Verify both runtime revisions load the replacement using nonsecret metadata. Reconcile any uncertain original serials under an approved read-only/provider workflow. Revoke only the specifically identified old key and verify its dashboard status. If read-only API validation is additionally approved, prove the old key is rejected and the new one succeeds without logging headers; do not improvise calls or revoke a key by guessed prefix. Remove old secret versions according to the owner's retention policy. A dashboard disappearance alone is insufficient if the wrong key could have been selected. Account compromise requires provider assistance and review of account-wide effects, not merely a local mapping edit.

## Disablement and rollback

`PASSFAST_ENABLED=false` disables customer issuance and worker provider calls, including outstanding voids. Native Apple/Google must stay OFF. Pending/uncertain/blocked jobs, original serials and local revocations must be retained; rolling back the app is not provider-side revocation. Never truncate the outbox or generate replacement passes during rollback.

If provider voids are required, obtain separate approval for an explicit existing synthetic/pilot pass list. Retain the exact old scope bindings and usable approved server credential for the controlled cleanup worker; keep customer admission unavailable, reconcile original serials, void the approved passes and verify provider outcomes, then disable the provider and revoke cleanup credentials. The current global switch cannot keep voids enabled while disabling customer issuance independently; a controlled cleanup needs a separately reviewed procedure or narrow admission switch. Do not remove/change mappings first, as that blocks safe ownership reconciliation.

## Activation sequence requiring owner approval

1. Review and release this exact candidate with providers OFF; verify health, source identities, unchanged schema/journal, ordinary loyalty and zero provider calls.
2. Approve the one scope/template/App, merchant assets and language, customer cohort/cap, quota thresholds, account-wide key risk and support/rollback owner. Verify no legacy managed rows require recovery.
3. Verify deployed ingress bounds, independent monitor/restart behavior and process drain grace. Configure identical approved mappings/App, secure credentials and `PASSFAST_WALLET_TYPES=apple` on web/worker while all providers remain OFF.
4. Obtain explicit activation approval. Enable PassFast on worker then web without enabling native Apple, Google or NFC. Check scoped UI/API with approved operational checks: the pilot location alone is available, another location and tenant are unavailable, Google is unavailable. Do not perform unapproved real issuance.
5. Admit only the approved cohort, monitor queue/provider quota and reconcile uncertainty. Disable promptly on a failed gate; apply the approved retained-job/void/key-revocation procedure. The completed isolated physical Wallet acceptance is not repeated.
