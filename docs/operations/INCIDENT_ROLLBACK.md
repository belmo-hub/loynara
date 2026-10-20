# Incident and application rollback

Prepared 15 October 2026 for LOY-197. These are operator procedures, not a record of production actions. The owner reports web and worker at `680266d7d627bd781a8633f419e49275e6c27294`, PostgreSQL through migration 0024. Deployment IDs, live variables, alert delivery and current backup freshness have not been inspected here. Earlier deployment checkpoints in the top-level runbooks are historical.

## Ownership and first response

Before release, assign an Incident Lead and alternate, Release Operator, Database/Backup Custodian, Privacy Lead and Merchant Communications Owner in the private on-call roster. One person may hold several roles; the alternate must be reachable. The Incident Lead records UTC detection/awareness times, impact, owner, next update time and changes in a restricted incident record.

1. Check independent uptime, worker, operations and backup monitors; separate a monitoring outage from an application outage. Treat missing/failed checks as unknown health. The deployment health endpoint alone does not test checkout or provider delivery.
2. Freeze unrelated releases and automatic deployment. Record each affected service's deployment ID, full source SHA and nonsecret configuration revision. Preserve minimal evidence before changes; do not copy bearer paths, credentials, email addresses, push endpoints or raw exception/query output into tickets or logs.
3. Contain the affected operation. For provider failure, pause admission/sending using the reviewed integration controls; for unsafe writes or uncertain database integrity, stop customer mutations and worker claims under the operator's containment procedure. Do not truncate jobs, edit the append-only ledger or retry an uncertain redemption/email.
4. If personal data may be affected, start [breach response](BREACH_RESPONSE.md) immediately. The Communications Owner prepares a factual merchant update and next update time; the assigned authorized sender sends it through the established support channel.

## Choose recovery

| Finding | Action |
| --- | --- |
| Bad application/configuration release, intact compatible database | Select the exact known-good historical deployment below. |
| Email/Wallet/push unavailable or budget exhausted | Use [service outage procedure](SERVICE_LIMITS.md); leave committed loyalty transactions intact. |
| Database unavailable or hard compute ceiling reached | Contain writes, check platform status/usage and approved limits; do not raise spending automatically. |
| Suspected data corruption/loss | Database Custodian assesses isolated recovery; a code rollback cannot restore lost data. |

## Exact historical deployment procedure

The Release Operator must fill this record **before** confirmation:

| Service | Current deployment ID / full SHA | Selected successful deployment ID / full SHA | Schema compatibility approved by |
| --- | --- | --- | --- |
| `loynara-web` | Required | Required | Required |
| `loynara-worker` | Required | Required | Required |

The owner-reported deployed baseline full SHA is **`680266d7d627bd781a8633f419e49275e6c27294`**. Owner attestation does not establish a retained image or compatibility with a later schema or deletion policy. After lifecycle activation, that baseline is not automatically an eligible rollback target; choose a reviewed artifact that preserves current closure and erasure protections. Select only the deployment whose details show that exact SHA, or another explicitly reviewed full SHA recorded above. Do not select by “previous”, branch name or time alone.

1. In Railway, select the exact project/environment, open the affected service → **Deployments**, open the chosen historical deployment and verify its deployment ID and full source SHA against the record. Review its custom variables, start command and pre-deploy command before action: rollback restores historical custom variables too. Prevent restored settings from enabling an unapproved integration or reusing a revoked credential. If the restored configuration is unsafe, stop and prepare a reviewed release with current safe settings.
2. Confirm the historical code can run against the database **as it now exists**, including every additive migration since 0024, with no down migration. Confirm web/worker mixed-version compatibility; otherwise quiesce both and use a reviewed coordinated maintenance window. Do not allow a historical pre-deploy command to modify schema implicitly.
3. On the **selected historical deployment's** three-dot menu, choose **Rollback**, verify the selection, then confirm. Record the resulting new deployment ID. Perform web and worker recovery in the reviewed order, with worker claims paused until both versions/configurations are checked.
4. If Rollback is unavailable because its image expired, **Redeploy on that same selected historical deployment** rebuilds its original source/configuration. Recheck the source SHA and build result. If the exact historical source cannot be verified or rebuilt, keep containment and prepare a separately reviewed release; do not substitute the latest branch head.
5. Verify both resulting deployment IDs/full SHAs, safe runtime switches, `/api/health`, operations and worker heartbeats, and the authorized bounded checkout checks. Reconcile queue ownership and uncertain provider outcomes before reviewed replay. Record the result and monitoring window before resuming traffic/claims.

Railway documents historical deployment selection, restored variables and the distinction between actions in [Deployment Actions](https://docs.railway.com/deployments/deployment-actions). **Restart** reruns the current deployment; **Deploy Latest Commit** deploys the default-branch head. Neither chooses a historical version. The CLI's latest `redeploy` command is not a substitute for the selected-deployment procedure. See [Railway rollback guide](https://docs.railway.com/guides/roll-back-bad-deploy).

## Exact commit through the API

When the approved recovery selects a full commit rather than a retained deployment, use this reviewed GraphQL operation in the restricted operator console. Bind the actual service and environment IDs and the approved full SHA separately; keep API credentials out of documents, shell history and tickets. Repeat for each approved service, record the returned deployment ID, and complete the same configuration, schema and post-deploy checks above.

```graphql
mutation RecoverService($serviceId: String!, $environmentId: String!, $commitSha: String!) {
  serviceInstanceDeployV2(serviceId: $serviceId, environmentId: $environmentId, commitSha: $commitSha)
}
```

Railway validates the SHA against the connected repository. Omitting `commitSha` does not select an arbitrary historical commit. The operation and distinction were rechecked on 15 October 2026 against [Railway's service API](https://docs.railway.com/integrations/api/manage-services). This is an operator instruction; no API mutation was executed during this work.

## Database recovery boundary

Keep additive tables and migrations when rolling application code back. Never run down migrations, restore over live data, disable integrity triggers or rewind migration history as incident improvisation. Such changes may destroy confirmed loyalty activity. A recovery decision must state the backup point, possible lost writes, reconciliation plan, custodian and explicit authorization.

Use [the backup/restore procedure](BACKUP_RESTORE.md) with an empty isolated target; [synthetic drill evidence](RESTORE_DRILL_EVIDENCE.md) describes its tested boundary. No web traffic or workers may connect to the target; external email, push and Wallet integrations stay disabled and credentials are withheld. Keep decryption keys outside the production runtime with primary/alternate custodians. Verify schema, complete backup-time inventory, ledger balances, reversal/redemption links and tenant constraints before considering a cutover. Apply every documented closure/erasure obligation before restoring service; an old backup must not reactivate retired credentials or deleted subjects. Policy2026-10-15 is approved for implementation/synthetic tests. The branch implements complete guarded erasure and an independently encrypted erasure archive, but production activation is not authorized here. A restore must use the current approved hold/closure checkpoint and erasure replay before traffic; see [lifecycle recovery](DATA_LIFECYCLE_RUNBOOK.md#restoring-without-resurrecting-deleted-subjects). Historical code that bypasses these protections is not a valid rollback target.

Close the incident only after service/queue checks pass, uncertain outcomes have explicit owners, merchant updates are complete and follow-up actions have owners/dates. Record actual recovery time and backup data-loss interval; no recovery-time or recovery-point guarantee is established by this document.
