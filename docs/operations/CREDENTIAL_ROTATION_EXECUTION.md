# LOY-334 approved execution checkpoint

15 October 2026. **In progress; not a completion report.** The owner approved phases 1–4 of [the packet](CREDENTIAL_ROTATION.md). Provider/preview rotations and deletion of synced/operator copies remain separately gated. LOY-334 remains open.

## Railway project access — replaced and verified

The owner created `production-operator-2026-10-15` for the existing production environment. Its value was saved directly to `~/Developer/Loynara-secrets/production/railway-project-active.env`, without appearing in console output or the repository. Owner-only permissions, ownership, file type and absence of extended ACLs were verified.

The replacement's authenticated `projectToken` query returned the expected project and environment. Project/service-inventory reads succeeded. Independent administrator access also succeeded. The identified old project token was then revoked; authentication using that old value was rejected, and authentication using the replacement still succeeded. No runtime service restart was required. The private active-credential inventory points at the replacement.

Earlier urllib-based HTTP 403 responses did not establish token validity. Direct curl-based queries subsequently authenticated successfully. The separately saved `railway-api.secret` was not accepted for account/project access and remains unclassified; it is not counted as resolved. Original synced files are preserved pending cleanup approval.

## Tunnel — continuity prepared, token rotation pending owner submission

The original connector's hostname was matched against `/etc/hostname` from its running Railway container through the read-only console file browser. The image has no shell, and startup INFO logs are suppressed by its existing WARN configuration; no SSH key was created or logging level changed to obtain this proof. Only the 13-byte system hostname file was downloaded, privately compared and removed locally. No customer data was read.

Temporary service `loynara-tunnel-handover-20261015` (`c620ba60-d608-42fb-b5cb-d128e7828992`) was created only in the existing production environment. It uses:

- The original pinned `cloudflare/cloudflared:2026.9.3` image digest and exact original start command.
- One EU West replica, limited to 0.25 vCPU and 250,000,000 bytes memory.
- The existing tunnel token, injected privately before the first deployment.
- No public Railway domain, TCP proxy, DNS change, route change or volume.

The source patch was inspected before committing: it contained only this temporary service's pinned image. Its deployment `e9a4841a-d892-4233-8b83-8f23fe6fcc15` succeeded. Cloudflare then showed two healthy connectors. The second hostname was independently matched to the temporary Railway container using the same read-only procedure. Four curl health requests and one request using the established monitor client returned HTTP 200.

A private cleanup guard is running, targeting only this exact temporary service ID/name and production environment. Its scheduled cleanup is **15:29:02 UTC / 17:29:02 Berlin on 15 October 2026**, within 30 minutes of connector startup. The guard's identity checks passed four synthetic cases, including refusal to target the original service. It checks for earlier successful cleanup and exits when the normal handover has already removed the temporary service. It records cleanup success or failure privately. This is a scheduled safeguard, not evidence that cleanup has already occurred; verify the result.

At this checkpoint, **the production tunnel token has not been rotated**. The production Cloudflare page is prepared for the owner's required credential submission. After that submission: save the new token outside sync, update/redeploy the temporary connector with its same image, verify it, update/redeploy the original connector with its same image, verify it, then remove the temporary service and check public health. If the owner does not proceed before the cleanup deadline, rebuild the two-connector readiness state before rotating.

## Still pending

- Production tunnel token replacement and verification of the resulting original connector.
- Classification/resolution of the separate saved Railway API credential.
- R2 key replacement, independent recovery custody for the new backup identity, future recipient activation, and the next natural backup's acceptance checks.
- Three replacement heartbeat credentials and real worker/ops/backup activity on them.
- Provider/preview scope checks, the three cloud-only files, operator handoff and the separately approved cleanup of old copies.

No application source release, migration, production-data restore, branch merge or original-file deletion has occurred in this execution checkpoint.
