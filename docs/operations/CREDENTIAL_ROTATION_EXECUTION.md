# LOY-334 approved execution checkpoint

15 October 2026. **In progress; not a completion report.** The owner approved phases 1–4 of [the packet](CREDENTIAL_ROTATION.md). Provider/preview rotations and deletion of synced/operator copies remain separately gated. LOY-334 remains open.

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

A private cleanup guard is running, targeting only this exact temporary service ID/name and production environment. Its scheduled cleanup is **15:29:02 UTC / 17:29:02 Berlin on 15 October 2026**, within 30 minutes of connector startup. The guard's identity checks passed four synthetic cases, including refusal to target the original service. It checks for earlier successful cleanup and exits when the normal handover has already removed the temporary service. It records cleanup success or failure privately. This is a scheduled safeguard, not evidence that cleanup has already occurred; verify the result.

The owner completed the provider rotation and saved the current installation token through a hidden-input local helper. The replacement is at `~/Developer/Loynara-secrets/production/cloudflared-active.token`; owner-only storage, expected account/tunnel identity and a difference from the historical token were verified without printing the value.

The temporary service was updated first and redeployed from its existing build. Deployment `5a2a6f99-137d-4e52-8260-75954216c3fb` reached SUCCESS with one running replica. Cloudflare showed a fresh connector replacing its old connection, and three public health checks returned HTTP 200. The original service was then updated and redeployed from its unchanged original build: deployment `cd3b71ad-bcf9-47ec-8f29-498be3f14beb` reached SUCCESS with one running replica. Cloudflare showed its fresh connector `6d0e9e32-c4fc-4730-a59f-c845aec9e5ff` and a healthy tunnel. Both identified old connector IDs disappeared. Four public health checks returned HTTP 200 before temporary removal.

The temporary service was deleted only from the production environment and independently verified absent from the project's service inventory at approximately 15:21 UTC, before its deadline. The private success marker was written for the cleanup guard. Three more public health checks returned HTTP 200 after removal; Cloudflare showed exactly one healthy connector belonging to the original service. No route, DNS, application deployment or source image changed. An isolated live old-token registration test was omitted because no route-free validation environment was established; provider rotation confirmation and the actual fresh authenticated connections are the recorded evidence, rather than a claimed live negative test. The original synced token file remains preserved pending separate cleanup approval.

## R2 — replacement created and synthetic checks passed

The owner created `loynara-production-backup-2026-10-15`. The provider's result and subsequent token inventory confirmed Object Read & Write access only to `loynara-rc-backups` in the EU jurisdiction, matching the predecessor's scope. Its S3 credentials and corresponding provider API token were saved directly to `backup/r2-active.env` and `backup/r2-active-api.token` in the protected folder. Readback and private-file checks passed; both S3 credential values differ from their historical counterparts. No values were printed or committed.

Using only the new S3 pair and the existing EU endpoint, a unique synthetic object under `credential-checks/` passed encrypted upload, HEAD size verification, GET ciphertext byte comparison, decryption with the prepared future identity, deletion and a subsequent missing-object HEAD check. The temporary local files were removed. Existing backup objects were not read or changed. Production backup variables and the old R2 key remain unchanged. Independent recovery custody and the next natural backup acceptance gate are still outstanding; this is not a completed R2 rotation. Before activation, verify how a same-build cron deployment applies variables without causing an immediate extra dump. The documented schedule alone does not establish deployment-time behavior; do not assume a generic redeploy is a schedule-only change. See [Railway cron semantics](https://docs.railway.com/cron-jobs).

## Monitoring — baseline verified, replacement forms prepared

The signed-in project has five checks on the free Hobbyist plan, whose current limit is twenty. The three privately saved old ping URLs match the expected live worker heartbeat, outbox and encrypted-backup checks. Their Simple schedules are respectively 1 minute / 5 minutes grace, 5 minutes / 10 minutes grace, and 1 day / 3 hours grace. The existing email integration is assigned to all five checks and reports Ready to deliver; its last notification is recorded as delivered. No test notification or manufactured success ping was sent.

Three matching replacement forms are prepared, awaiting the owner's required browser credential-creation submission. No replacement ping URLs have yet been created or injected. No monitoring API key was created: project API access is currently unset, and this operation does not need broader management credentials. Old checks and production service artifacts are unchanged.

## Still pending

- Classification/resolution of the separate saved Railway API credential.
- R2 key replacement, independent recovery custody for the new backup identity, future recipient activation, and the next natural backup's acceptance checks.
- Three replacement heartbeat credentials and real worker/ops/backup activity on them.
- Provider/preview scope checks, the three cloud-only files, operator handoff and the separately approved cleanup of old copies.

No application source release, migration, production-data restore, branch merge or original-file deletion has occurred in this execution checkpoint.
