# LOY-334 approved execution checkpoint

Updated 16 October 2026. **In progress; not a completion report.** The owner approved phases 1–4 of [the packet](CREDENTIAL_ROTATION.md). Provider/preview rotations and deletion of synced/operator copies remain separately gated. LOY-334 remains open.

## Railway project access — replaced and verified

The owner created `production-operator-2026-10-15` for the existing production environment. Its value was saved directly to `~/Developer/Loynara-secrets/production/railway-project-active.env`, without appearing in console output or the repository. Owner-only permissions, ownership, file type and absence of extended ACLs were verified.

The replacement's authenticated `projectToken` query returned the expected project and environment. Project/service-inventory reads succeeded. Independent administrator access also succeeded. The identified old project token was then revoked; authentication using that old value was rejected, and authentication using the replacement still succeeded. No runtime service restart was required. The private active-credential inventory points at the replacement.

Earlier urllib-based HTTP 403 responses did not establish token validity. Direct curl-based queries subsequently authenticated successfully. The separately saved `railway-api.secret` was not accepted for account/project access and remains unclassified; it is not counted as resolved. Original synced files are preserved pending cleanup approval.

## Tunnel — replaced, verified and temporary connector removed

The original connector's hostname was matched against `/etc/hostname` from its running Railway container through the read-only console file browser. The image has no shell, and startup INFO logs are suppressed by its existing WARN configuration; no SSH key was created or logging level changed to obtain this proof. Only the 13-byte system hostname file was downloaded, privately compared and removed locally. No customer data was read.

Temporary service `loynara-tunnel-handover-20261015` (`c620ba60-d608-42fb-b5cb-d128e7828992`) was created only in the existing production environment. It uses:

- The original pinned `cloudflare/cloudflared:2026.9.3` image digest and exact original start command.
- One EU West replica, limited to 0.25 vCPU and 250,000,000 bytes memory.
- The existing tunnel token, injected privately before the first deployment.
- No public Railway domain, TCP proxy, DNS change, route change or volume.

The source patch was inspected before committing: it contained only this temporary service's pinned image. Its deployment `e9a4841a-d892-4233-8b83-8f23fe6fcc15` succeeded. Cloudflare then showed two healthy connectors. The second hostname was independently matched to the temporary Railway container using the same read-only procedure. Four curl health requests and one request using the established monitor client returned HTTP 200.

A private cleanup guard was started, targeting only this exact temporary service ID/name and production environment. Its scheduled cleanup is **15:29:02 UTC / 17:29:02 Berlin on 15 October 2026**, within 30 minutes of connector startup. The guard's identity checks passed four synthetic cases, including refusal to target the original service. It checks for earlier successful cleanup and exits when the normal handover has already removed the temporary service. It records cleanup success or failure privately. The subsequent verified removal marker caused the guard to exit; its process was confirmed no longer running.

The owner completed the provider rotation and saved the current installation token through a hidden-input local helper. The replacement is at `~/Developer/Loynara-secrets/production/cloudflared-active.token`; owner-only storage, expected account/tunnel identity and a difference from the historical token were verified without printing the value.

The temporary service was updated first and redeployed from its existing build. Deployment `5a2a6f99-137d-4e52-8260-75954216c3fb` reached SUCCESS with one running replica. Cloudflare showed a fresh connector replacing its old connection, and three public health checks returned HTTP 200. The original service was then updated and redeployed from its unchanged original build: deployment `cd3b71ad-bcf9-47ec-8f29-498be3f14beb` reached SUCCESS with one running replica. Cloudflare showed its fresh connector `6d0e9e32-c4fc-4730-a59f-c845aec9e5ff` and a healthy tunnel. Both identified old connector IDs disappeared. Four public health checks returned HTTP 200 before temporary removal.

The temporary service was deleted only from the production environment and independently verified absent from the project's service inventory at approximately 15:21 UTC, before its deadline. The private success marker was written for the cleanup guard. Three more public health checks returned HTTP 200 after removal; Cloudflare showed exactly one healthy connector belonging to the original service. No route, DNS, application deployment or source image changed. An isolated live old-token registration test was omitted because no route-free validation environment was established; provider rotation confirmation and the actual fresh authenticated connections are the recorded evidence, rather than a claimed live negative test. The original synced token file remains preserved pending separate cleanup approval.

## R2 — replacement and retirement verified

The owner created `loynara-production-backup-2026-10-15`. The provider's result and subsequent token inventory confirmed Object Read & Write access only to `loynara-rc-backups` in the EU jurisdiction, matching the predecessor's scope. Its S3 credentials and corresponding provider API token were saved directly to `backup/r2-active.env` and `backup/r2-active-api.token` in the protected folder. Readback and private-file checks passed; both S3 credential values differ from their historical counterparts. No values were printed or committed.

Using only the new S3 pair and the existing EU endpoint, a unique synthetic object under `credential-checks/` passed encrypted upload, HEAD size verification, GET ciphertext byte comparison, decryption with the prepared future identity, deletion and a subsequent missing-object HEAD check. The temporary local files were removed. Existing backup objects were not read or changed. The replacement passed the natural-run acceptance gate and the old R2 token was subsequently revoked and rejected, as recorded below.

### Recovery custody and backup activation

The owner reports that both historical and future private identities were saved and checked in secure storage on their phone. This is owner-confirmed custody, not an independently observed retrieval drill. Both Mac copies remain preserved, and both corresponding key pairs passed fresh synthetic age encryption/decryption round trips before activation.

Read-only API schema inspection identified `deploymentRedeploy(id: ..., usePreviousImageTag: true)` for explicit previous-image reuse. The generic redeploy connector did not supply that option in the earlier worker/ops handover. The ops service's execution history confirmed its replacement's first run was the natural 15:40 UTC run, with no intervening deployment-triggered execution. The backup's latest execution was still the natural 15 October 03:02 UTC run.

Exactly four backup variables were updated privately with `skipDeploys: true`: the R2 pair, public future age recipient and backup heartbeat URL. The exact previous backup deployment was then submitted through the API with `usePreviousImageTag: true`. Resulting deployment `493cec2e-dde9-4d24-826b-2861c33f99da` reached SUCCESS. Final metadata matched **both the original commit and original image digest**. The `0 3 * * *` schedule, start command, restart policy and region remained unchanged. All four variable values matched the prepared replacements on private readback. No private recovery identity was placed in Railway. Execution history still showed no extra backup run.

The independent signed-in Railway browser session remains available. The separate saved CLI administrator credential was refused during this phase; the replacement environment-scoped project credential authenticated and performed the approved reads/mutations. The CLI credential must be reconciled before relying on it as emergency operator access. No broad replacement token was created to work around that refusal.

### Natural-run acceptance and retirement — passed

The natural 16 October backup ran from **03:03:27.739 to 03:03:32.455 UTC / 05:03 Berlin** on deployment `493cec2e-dde9-4d24-826b-2861c33f99da`. Railway reports success, no service issues and no pending deployment work. Private readback confirms the four replacement variables remain configured.

The replacement backup check is up, with real Started and OK events at 03:03 UTC and its existing email notification method ON. Using only the replacement S3 pair, a prefix-limited LIST found exactly one encrypted `.dump.age` object for 16 October. Its last-modified time is 03:03:29.200 UTC and size is **188,095 bytes**; HEAD returned the same size. No backup contents were downloaded or restored. This verifies scheduled execution and upload metadata, not a production-data restore drill.

A bounded HEAD using the old S3 pair still authenticated before revocation, establishing its pre-retirement baseline. After all acceptance gates passed, the owner deleted the identified `loynara-stage-a-backup-writer` token and removed the superseded `Loynara RC encrypted backup` check through the prepared provider confirmations.

Fresh verification confirmed the old S3 pair is rejected with **HTTP 401**, while the replacement can still HEAD the expected encrypted backup object. A new unique synthetic encrypted object then passed upload, HEAD size verification, GET byte comparison, age decryption, deletion and missing-object verification with the replacement pair. Neither production backup contents nor customer rows were read. Local synthetic temporary files were removed.

The provider token inventory contains only the new named backup token, active with the expected EU bucket Object Read & Write scope. The monitoring inventory has five expected checks: the exact old backup check is absent and the replacement remains healthy with email notifications assigned. All three operational heartbeat replacements and their predecessor removals are now verified. Two public health requests returned HTTP 200 afterward. Both recovery identities and original synced files remain preserved; this milestone does not authorize their deletion.

Recovery after retirement requires a newly valid R2 credential if access fails; the revoked S3 pair cannot restore service. Preserve both private age identities for the backups that use them. An image rollback does not restore variable values. Do not restore the invalidated production tunnel token or revoked Railway project token.

## Monitoring — worker and outbox replaced and predecessors removed

The signed-in project has five checks on the free Hobbyist plan, whose current limit is twenty. The three privately saved old ping URLs match the expected live worker heartbeat, outbox and encrypted-backup checks. Their Simple schedules are respectively 1 minute / 5 minutes grace, 5 minutes / 10 minutes grace, and 1 day / 3 hours grace. The existing email integration is assigned to all five checks and reports Ready to deliver; its last notification is recorded as delivered. No test notification or manufactured success ping was sent.

The owner saved all three matching replacements. Their ping URLs are stored at `monitoring/heartbeats-active.env` in the protected folder; private-file checks passed, and each differs from its predecessor. The existing email integration reports Ready to deliver and is assigned to all eight checks. No monitoring API key was created.

Worker deployment `1e63e0bd-85b9-41c2-ba1c-9a34e3b749e2` reached SUCCESS, and its replacement check received a real heartbeat. Outbox deployment `4b6e6aa8-3e56-4c02-8a7d-11c9ecd2fb8e` reached SUCCESS and completed the natural 15:40 UTC run at 15:40:15.867 UTC; its replacement check is up with real pings. Two public health checks returned HTTP 200. Only the corresponding worker and ops variables changed at that checkpoint; the backup URL was subsequently activated with the backup phase above.

**Deployment limitation:** the connector described redeploy as reusing the existing build, and initial metadata carried the previous digest. Final metadata showed that Railway rebuilt the original source commit and produced a different image digest for both services. Commit hashes remained identical, and service commands/configuration were preserved; do not describe these as exact image reuse. The later backup phase above used the explicit API image-reuse option and verified the unchanged digest and absence of extra execution.

After replacement activity was verified, only the superseded worker-heartbeat and outbox checks were paused to prevent stale alerts. The owner subsequently removed both old checks. A fresh inventory verified both exact predecessor check IDs absent, all three replacements still present, and continuing real worker/outbox pings within their periods. Six expected checks remain. This verifies removal through the provider inventory; no synthetic success ping was sent to either old endpoint. The old backup check was subsequently removed and verified absent after its natural-run acceptance; unrelated checks are unchanged.

## Additional confirmed exposure

Private comparison confirmed that the synced device-test file's `MAILGUN_EU_API_KEY` and `MAILGUN_EU_WEBHOOK_SIGNING_KEY` exactly match production web and worker configuration. Both need the separately gated provider rotation plan. No provider credential changed. Other inspected local auth/database/PassFast values had no exact same-name match, which does not establish separate provider/account scope.

## Still pending

- Classification/resolution of the separate saved Railway API credential and reconciliation of the refused CLI administrator credential.
- Provider/preview scope checks, the three cloud-only files, operator handoff and the separately approved cleanup of old copies.

No application source release, migration, production-data restore, branch merge or original-file deletion has occurred in this execution checkpoint.
