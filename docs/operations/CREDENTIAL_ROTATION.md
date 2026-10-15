# Credential storage and replacement — LOY-334

Prepared 15 October 2026. **Production replacement and cleanup are not approved or complete.** This is the execution packet for that approval, not evidence of rotation. See [preparation evidence](CREDENTIAL_STORAGE_EVIDENCE.md), [implementation plan](CREDENTIAL_STORAGE_PLAN.md) and [the ticket](https://loynara.youtrack.cloud/issue/LOY-334).

## What was checked again

The Desktop checkout is still synced through iCloud. Mode 0600 protects against other local users; it does not prevent syncing. The current Railway API inspection reports seven services, no reported failures, online web/worker/Postgres and one online tunnel replica. The backup completed its 15 October 03:00 UTC scheduled run; the ops check also completed. These observations supersede the early setup checkpoints in `PRODUCTION_DEPLOYMENT.md`; they do not establish that old credentials are safe.

The Git base for this preparation is `a822f833f657e440f202b2a5f1c28ab768d41fbe`, including the merged 15 October audit fixes. This is **not** a claim that those fixes are deployed. Credential changes must preserve each service's currently deployed artifact; do not deploy the branch head as a side effect.

## Inventory and consumers

Paths in the source column are relative to `~/Desktop/Loynara`, unless stated otherwise. Destination paths are relative to `~/Developer/Loynara-secrets`. Only names and dependencies are recorded; no secret values or fingerprints belong here or in tickets.

| Source | Private destination | Dependency / scope still to verify |
| --- | --- | --- |
| `var/cloudflared-production.token` | `production/cloudflared.token` | Production Cloudflare tunnel; Railway `cloudflared` variable `TUNNEL_TOKEN`; app and restricted mail/unsubscribe callback routes. Inventory all Cloudflare connector IDs before replacement. |
| `var/railway-stage-a.env` | `production/railway-project.env` | `RAILWAY_TOKEN`; historical local scripts use `Project-Access-Token`. Verify the actual environment scope through a read-only authenticated query before replacement. |
| `var/railway-production-auth.secret` | `production/railway-api.secret` | Separate Railway credential; current consumer and account/workspace/project scope unconfirmed. Do not assume it is the same token. |
| `var/r2-stage-a-backup.env` | `backup/r2.env` | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; backup service and historical retrieval/verification scripts; private EU bucket `loynara-rc-backups`. |
| `var/loynara-rc-backup-age-identity.txt` | `recovery/backup-age-identity.txt` | Private backup decryption identity; used by historical restore scripts. This is exposed recovery material as well as the bucket access keys. **Retain while any backup needs it.** |
| `var/loynara-rc-backup-age-recipient.txt` | `recovery/backup-age-recipient.txt` | Public encryption recipient corresponding to the identity; production `BACKUP_AGE_RECIPIENT`. Public material, preserved for recovery consistency. |
| Newly generated outside sync; no original source | `recovery/backup-next-identity.txt`, `recovery/backup-next-recipient.txt` | Prepared future backup key pair. Synthetic round trip passed. **Not activated in production.** |
| `var/healthchecks-stage-a.env` | `monitoring/heartbeats.env` | `BACKUP_HEARTBEAT_URL`, `OPS_HEARTBEAT_URL`, `WORKER_HEARTBEAT_URL`; backup, ops and worker respectively. Ping URLs are bearer credentials. |
| `var/cloudflared-device-test.token` | `preview/device-tunnel.token` | Device-test tunnel; establish whether still needed before revocation. |
| `var/integrated-preview-nfc-20261005/preview-connector.token` | `preview/integrated-tunnel.token` | Integrated preview connector and historical preview start/deploy scripts. |
| `var/device-test.env` | `preview/device-test.env` | Local preview runtime; includes Mailgun API and HTTP signing keys, unsubscribe/auth secrets and database configuration. Current production equivalence has **not** been established. |
| `var/device-test-access.json` | `preview/device-test-access.json` | Preview account access; classify account ownership and continued need privately. |
| `var/demo-access.json` | `local/demo-access.json` | Demo account access; classify before retirement. |
| `.env.local` | `local/local.env` | Local app configuration; do not source it or start an app until the database/provider targets are privately classified. |
| `var/demo-prep-20261012/passfast.env` and `passfast.env.template` | `providers/passfast-demo.env` and `providers/passfast-template.env` | Both files have `PASSFAST_API_KEY`, app and template identifiers. A `.template` suffix is not proof that a file is safe. Production web/worker also have this provider key name; equality and scope are unconfirmed. |
| `.env`, `var/preview.env`, `var/preview-access.json` | Pending reconciliation | Cloud-only placeholders at inspection time. Their contents were not read or copied. Do not assume `.env` equals `.env.local`. |
| `~/Loynara-operator-keys/{credential,owner,cashier}.json`, `transport-private.pem`, `transport-public.pem` | Already outside known synced roots | Private operator handoff files; preserve until the recipients confirm access and the associated account credentials are replaced where needed. Delete only the individually approved files. |
| `~/.loynara-secrets/google-wallet-demo-20261009.json` | Already outside known synced roots | Google Wallet demo service account; no evidence in this inventory that its private file was synced. No automatic rotation. |
| `~/.config/loynara/nfc-custody/age/identity.txt` and its custody records | Already outside known synced roots | NFC custody identity; distinct from the backup identity. Preserve. |

Railway injects production service variables directly: its running services do not depend on Desktop file paths. Web and worker have Mailgun and PassFast variable names; web also has `PROMOTIONAL_UNSUBSCRIBE_SECRET`. Backup has the R2 pair, public age recipient, database variables and backup heartbeat. Ops and worker have their own heartbeats. Never copy a private age identity into Railway.

No database password or application auth key is included in the initial production change set merely because the name exists in Railway. Privately compare/classify exposed preview credentials before deciding whether these also require replacement. Access through a potentially exposed broad Railway credential increases the investigation scope; this packet does not claim to rule out compromise.

### Local tooling transition

Use the reviewed `scripts/operator-secrets.py` from the operations worktree. Its private `preparation.json` maps source files to destinations. It copies resident files, verifies bytes without printing them, refuses unsafe permissions/ACLs/symlinks/repositories and never overwrites differing copies. It cannot certify the absence of arbitrary third-party sync software or protect against arbitrary code running as the same Mac user.

```sh
python3 -B scripts/operator-secrets.py verify \
  --manifest "$HOME/Developer/Loynara-secrets/preparation.json"
```

This verification is for **pre-rotation copies**. After rotation, original and replacement bytes should differ: preserve the preparation record and maintain a separate private active-credential inventory. Do not overwrite new credentials by rerunning preparation.

For an independently authorized restore, the existing restore tool accepts `BACKUP_AGE_IDENTITY_FILE`; set that to the relevant private recovery path. No code change is needed in the hosted backup job. Do not run a real production-data restore for this task; key validation uses synthetic plaintext only.

Historical deploy scripts in `var/railway_gate1.py`, `var/*/deploy-once.py`, backup retrieval scripts and `var/integrated-preview-nfc-20261005/start-preview.py` still refer to old paths. Treat these as retired execution entry points; do not edit archived evidence or run them to rotate secrets. The tracked device-test scripts also expect `var/device-test.env`; keep those previews stopped until their need is decided. Restarting a preview requires a separate path migration and synthetic-only provider/database configuration. No symlink back into Desktop or new copy under `var/` is an acceptable workaround.

## Production targets and readiness gates

Railway project `loynara-rc`: `b07a3919-b3fc-4637-8b91-d0b4418d2856`; production environment: `a3ba3a4a-3d4c-4149-91c4-735e8bae3447`.

| Service | ID | Approved-change candidate |
| --- | --- | --- |
| cloudflared | `131ff3f7-3eb8-4837-a9f9-694db14f623b` | `TUNNEL_TOKEN`, same pinned image and ingress |
| backup | `78ee0c58-c306-4f3a-95c0-1c94e72e793c` | R2 pair, public `BACKUP_AGE_RECIPIENT`, `BACKUP_HEARTBEAT_URL` |
| opscheck | `c3189719-e305-4c4c-b8ca-4d0b0335c25f` | `OPS_HEARTBEAT_URL` |
| worker | `3bfad7e8-c638-41bd-8f50-743e68c0633f` | `WORKER_HEARTBEAT_URL` |
| web | `5c1303ad-42c2-4094-a996-3ac6140d088d` | No initial variable change; provider changes require the separate scope gate below |

Immediately before executing an approved phase:

1. Confirm the owner approval covers that phase, its revocations and any temporary resources. Confirm no other operator is deploying. Re-read live service status, deployed artifact, start command, ingress configuration, variable references, backup schedule and spending limits. No source updates or migrations are part of this packet.
2. Keep an independent signed-in administrator session and the recovery identity available outside sync. Confirm Cloudflare account/tunnel ID, R2 token IDs, Railway token IDs/scopes and Healthchecks access privately. Missing access stops that phase; do not request a token in chat.
3. Record baseline public health/status only, worker/ops heartbeat times and backup completion metadata. Do not retrieve customer rows or unredacted production logs. Stop on an existing outage or unexplained connector; use the incident runbook rather than silently extending this authorization.
4. Capture exact prior deployment IDs and configuration names in the private execution journal. Public evidence records status, timestamps and operation IDs only. Do not use `env`, shell tracing, verbose HTTP, token-bearing command arguments or raw exception output.

## Rotation order, checks and recovery

Complete each phase's acceptance gate before revoking that phase's old credential, **except the tunnel token**: its rotation immediately prevents new connections with the old token, before the replacement can be tested. Existing connections bridge that interval; an unexpected disconnect can interrupt service. For other phases, a failed check means keeping the known-working deployment and old still-valid credential, diagnosing privately and stopping subsequent phases. After revocation, recovery means another new credential, not restoring a revoked value. An artifact rollback does not restore an old environment value automatically.

### 1. Railway control credentials

Create a replacement environment-scoped project token for routine project operations. Store it directly outside sync with mode 0600. Use `Project-Access-Token` for a read-only `projectToken` query and verify the project/environment IDs above; test only the minimum required read operations. Establish separately what `railway-production-auth.secret` authenticates and whether a broader replacement is actually needed. Do not substitute a broad account token for a scoped token just to bypass a permission error.

Point current approved operator invocations at the new files. Confirm independent administrator access still works, then revoke the identified old tokens and make a bounded read-only request with each old token to confirm rejection. Recheck new-token access afterward. No Railway runtime restart is needed merely to replace an operator API token. If new-token checks fail, leave old access valid while correcting scope; after revocation, use the independent admin session to mint another scoped token. [Railway authentication](https://docs.railway.com/integrations/api).

### 2. Production tunnel

There is one Railway connector replica. A seamless handover cannot be promised by restarting it alone. Approval must include **one temporary connector, no more than 30 minutes, within existing spending limits**, with identical private ingress and the current pinned image:

`cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c`

Inventory Cloudflare connector IDs and their ownership first. Start the temporary service using the existing token, without public domains, TCP proxies, new routes or DNS edits; confirm two healthy known connectors before rotation. If the stored token is no longer current or the temporary connector fails, stop before rotating. Rotate the tunnel token in Cloudflare; securely store the new token and update the temporary connector first. Existing connected connectors can remain active after token rotation, but cannot reconnect using the old token. During this rolling update, continuity relies on the original connection staying alive. Wait for the updated temporary connector to be healthy and verify public health through the existing routes. Then update the original Railway service's `TUNNEL_TOKEN` and redeploy its **same image**, verify its new connector ID and health, and remove the temporary service after stable original-service checks.

Retire only identified old connector IDs using the `client_id` filter; do not issue an unfiltered delete-all-connections operation. Verify an old token can no longer register using a bounded connector validation that has no origin route and no traffic forwarding. If such a validation cannot be isolated, rely on provider token-version/revocation evidence and record that the live negative connection test was omitted. Unknown connectors require an incident decision; continuity is not a reason to leave a suspected hostile connector active.

Stop if the new connector does not become healthy. Preserve the existing connection, correct the token/configuration, or mint another new token; rotating back to the invalidated token will not recover it. If both connectors fail, restore the original image/ingress with a newly valid token through independent admin access. Do not expose the private origin publicly as a workaround. [Token behavior](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/), [replica guidance](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/remote-tunnel-permissions/), [selective connector removal](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/subresources/cloudflared/subresources/connections/methods/delete/).

### 3. R2 backup access and future encryption

Create a bucket-scoped Object Read & Write key for `loynara-rc-backups`, preserving the existing EU endpoint and lifecycle rules. Save the new ID and secret outside sync immediately. Using only the new key, upload, HEAD, retrieve and delete a small synthetic encrypted canary under a distinct `credential-checks/` prefix; compare synthetic bytes locally without printing them. Never read, overwrite or delete existing backup objects to test access. Ensure canary cleanup succeeds and no broad account permission was needed.

The **new backup age identity** for future backups is prepared outside sync at the `backup-next-identity.txt` path above; its synthetic encryption/decryption round trip passed. Verify custody and the prepared pair again before activating its public recipient; do not regenerate or overwrite it casually. Record the custodian privately. Preserve the old identity for every historical backup it decrypts. Changing the recipient cannot revoke a previously copied identity or make old ciphertext safe again. Historical backup retention remains unchanged; do not re-encrypt or delete production objects as part of this operation.

Replace only the backup service's `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` and public `BACKUP_AGE_RECIPIENT`, plus its heartbeat when phase 4 is ready. Redeploy the same current backup artifact at a time that avoids its 03:00 UTC cron. Confirm the configuration and schedule, then observe the next **natural** successful backup and its object/heartbeat metadata. Do not trigger a production dump as a test. A production-data restore remains outside this task's test authorization.

Keep the old R2 key valid until these checks pass. Then revoke it, confirm a read-only bucket metadata request using it is denied and recheck the new key. A scheduled failure before revocation permits restoring the previous variable values with the same artifact; preserve both encryption identities regardless. After revocation mint a replacement key if needed. [R2 scoped access](https://developers.cloudflare.com/r2/api/tokens/).

### 4. Heartbeat credentials

Create replacement worker, ops and backup checks with the same verified schedules, grace periods and alert contacts. Check free-plan capacity first; no subscription or limit increase is approved by this packet. A check UUID cannot be rotated in place, so preserve the old checks during overlap. Store the new ping URLs outside sync and inject only the matching service variable. [Healthchecks API](https://healthchecks.io/docs/http_api/).

Redeploy worker and ops using their currently deployed artifacts; coordinate the backup update with phase 3. Verify worker activity from its real heartbeat and ops/backup from their next natural successful runs. Do not manually send success pings to manufacture health. Retire old checks only after their replacements have reported real activity and alert contacts are verified. If the new check fails, revert the still-valid old URL using the same artifact and investigate. Existing independent HTTPS monitoring stays unchanged. Record evidence of disabled/deleted old ping endpoints, never their URLs.

### 5. Preview credentials and provider scope gate

Read provider/account configuration privately and determine whether the preview Mailgun and PassFast credentials match or grant access to production. Decide whether each preview tunnel is still needed. Approval to replace the core credentials above **does not** authorize arbitrary provider-wide changes.

For a retired preview: stop its identified connector, revoke its tunnel token, verify no active connectors remain and retire associated test account access. For a retained preview: replace its token with the same handover checks as production and move its start/configuration paths outside sync before restarting. Do not run a preview using a production database or production sending keys.

For Mailgun, a domain sending key and the account-wide HTTP webhook signing key are different credentials. A sending-key replacement can overlap while web/worker are updated and a separately approved controlled send is verified. A signing-key rotation needs coordinated callback verification and an old/new acceptance design or an explicitly approved interruption window; current single-key handling does not establish uninterrupted acceptance. No sending test is authorized by merely preparing this packet. [Mailgun key types](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/keys/get-v1-keys), [webhook signing](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks).

PassFast rotation scope, overlap support and affected passes must be confirmed in the actual provider account before proposing the exact mutation. Do not revoke the existing key or invalidate passes while these are unknown. Likewise, exposed auth, unsubscribe or database credentials require their own dependency and session/link impact checks if found to be production credentials. Record unresolved scope as a remaining launch blocker, not a completed rotation.

## Cleanup gate

After replacement checks and explicit cleanup approval:

1. Privately reconcile the three cloud-only files; downloading them must not expose their contents in tool output. Classify any additional credentials, add them to the private inventory, rotate as needed and preserve necessary recovery material before deleting their copies.
2. Inspect historical scripts, generated archives and logs for embedded copies without printing matches. Record only affected filenames and credential categories. File naming alone is not an exhaustive secret scan.
3. Remove only the approved original files whose replacements/revocations are verified. Verify their absence on this Mac. Review iCloud Drive and Recently Deleted for these specific files and confirm cleanup on other signed-in devices; never empty unrelated trash or delete broad directories. Local removal is not proof that all cloud/device copies are gone.
4. Confirm operator handoff and working replacement account access before deleting the specifically named files in `~/Loynara-operator-keys`. Preserve NFC custody and backup identities. Agree a separate offline recovery copy/custodian for backup identities; a single private folder is not a disaster-recovery strategy.
5. Keep the old backup identity in private recovery custody until every backup needing it has expired under the existing retention policy and there is no preservation obligation. Do not delete it with API-token cleanup.
6. Record replacement times, service/deployment IDs, successful positive/negative checks and remaining exceptions. Close LOY-334 only when actual replacement and all required cleanup are verified. If cloud-copy cleanup cannot be proven, keep the issue open with the owner action listed.

## Approval requested after preparation

The concrete initial production package is phases 1–4: scoped Railway operator access replacement; tunnel-token replacement with a temporary connector capped at 30 minutes and no limit increase; bucket-scoped R2 access replacement; a new public backup recipient while retaining the old private identity; and three replacement heartbeat checks. Use existing service artifacts, schedules and routes. Revoke old Railway, R2 and heartbeat credentials only after their phase's checks pass. Tunnel rotation invalidates the old token for reconnection immediately; approval includes this limited handover risk despite the temporary connector. The backup phase may take until the next 03:00 UTC run.

Provider/preview changes and deletion of synced/operator copies remain separately gated on the private scope/handoff checks above and an explicit reviewed cleanup list. No application deployment, schema migration, DNS change, public origin exposure, customer-data test, paid upgrade or branch merge is included.
