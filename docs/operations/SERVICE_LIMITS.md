# Service costs, limits and provider outages

Prepared 15 October 2026 for LOY-201. Application limits below are proposed release settings; no production activation, account inspection, purchase or live invoice verification is recorded here. Infrastructure approvals are historical owner decisions in [PRODUCTION_DEPLOYMENT.md](../../PRODUCTION_DEPLOYMENT.md), not proof of today's dashboard settings.

## Cost envelope and approval boundary

| Item | Documented approval / public price | What remains unknown |
| --- | --- | --- |
| Railway Stage A | Hobby: $5/month including $5 resource usage. Owner approved a $10 Compute warning and $16 Compute hard limit. | Current account settings, actual measured usage, invoice, tax and forecast. |
| Railway commercial stage | Pro: $20/month including $20 resource usage; separate owner approval required before upgrade. | Commercial capacity and measured monthly bill. |
| Resource rates | RAM $10/GB-month; CPU $20/vCPU-month; volume $0.15/GB-month; network egress $0.05/GB. | Actual service usage, connector/cron usage, snapshots and traffic. |
| Private EU R2 Standard backups | Billing activation previously approved. Included monthly: 10 GB-month, 1 million Class A and 10 million Class B operations. Beyond this: $0.015/GB-month, $4.50/million Class A, $0.36/million Class B; R2 egress free. | Actual total retained storage, request count and invoice. |
| Email, managed/direct Wallet, staff browser push | Existing enablement and provider-specific approvals still apply. Attempt caps below authorize no account upgrade or send. | Actual account plans, included quotas, contractual fees and billable unit mapping. Do not assume a zero bill. |
| Existing monitoring | Existing free-tier monitoring setup; no paid monitoring addition authorized by this change. | Current account quota, alert recipient coverage and delivered alerts. |

Public rates checked 15 October 2026: [Railway plans and resource rates](https://docs.railway.com/pricing/plans), [R2 Standard pricing](https://developers.cloudflare.com/r2/pricing/). Prices are USD, exclude tax/FX and are not a quote. The previous resource assumptions of 0.8–1.8 GB continuously used RAM, 0.05–0.4 average vCPU and 1–3 GB volume imply **$9.15–26.45/month in resource usage**, before other items. These are arithmetic planning estimates, not measurements; the Hobby minimum is $5, not $5 added again to included usage. Retained backup storage is the sum of recovery objects, not just database size; a 14-day set may exceed R2's included tier.

The owner accepted Stage A's possibility of service shutdown at its Compute ceiling. Railway takes workloads offline at that hard limit; the warning only notifies. Neither the ceiling nor these application caps guarantees a total invoice, protects uptime or caps an external provider's bill. Do not raise limits, replicas, plans or buy add-ons automatically. Check the exact workspace and current usage before an authorized operator action. [Railway cost controls](https://docs.railway.com/pricing/cost-control).

## Proposed application attempt ceilings

| Shared service budget | Environment key | Initial monthly ceiling | Review warning at 80% |
| --- | --- | ---: | ---: |
| Email | `SERVICE_EMAIL_MONTHLY_LIMIT` | 1,000 | 800 |
| Wallet | `SERVICE_WALLET_MONTHLY_LIMIT` | 5,000 | 4,000 |
| Staff push | `SERVICE_PUSH_MONTHLY_LIMIT` | 10,000 | 8,000 |

The reviewed release reserves a shared database-backed allowance immediately before each actual external email POST, Wallet provider request and staff push send across web and worker processes. The Wallet pool includes managed-provider requests, direct-provider OAuth and API calls, reads, writes, downloads and Apple device notifications. It counts calls rather than logical jobs. Limits accept decimal integers from 0 through 10,000,000; zero stops new attempts and malformed configuration refuses the operation. An omitted key uses the initial default above. A UTC calendar month is a different accounting period. Retries and uncertain outcomes consume allowances conservatively, with no refunds; reservations are not evidence of provider delivery or invoice units. One customer operation can require multiple provider calls or devices. Never estimate cost by equating attempts to issued cards or delivered messages.

Accounting/configuration/database failure must refuse the optional outbound operation. It must not undo a loyalty transaction already committed or bypass authorization, consent, tenant scope, endpoint validation or provider idempotency. Existing per-location promotional limits and customer cooldowns still apply independently. A budget is neither a permission to send nor an external provider rate/contract limit.

Apple device notifications reserve the first device's allowance before reading signing credentials or opening the APNs connection, then reserve separately for every further device. A refused first reservation opens no connection. Failed preparation and uncertain transport attempts are not refunded.

At warning level the operator reviews recent growth, provider quota/status and the remaining UTC month. At exhaustion, stop additional admission/scheduling for that integration and investigate. Keep jobs and uncertain identities for reviewed reconciliation; do not reset counters, change the clock, split deployments or raise limits to evade a refusal. A raised limit needs an owner-approved rationale, specific service/new ceiling, cost exposure and review date, then coordinated configuration of every caller.

**Wallet safety caveat:** the hard budget can also block remote void/revocation calls. Retired server credentials must remain invalid immediately; a local closure is not proof of remote revocation or removal from a device. Escalate outstanding revocations with original identities and a deadline. The operator may approve a higher ceiling after incident review to perform bounded cleanup; do not bypass the budget or silently claim erasure completed. See [incident response](INCIDENT_ROLLBACK.md) and the approved [retention policy](RETENTION_POLICY_PROPOSAL.md).

## Monitoring and outage response

These proposed operations thresholds require the reviewed code, migration and scheduled check to be deployed; they are not proof of live alerts. The operations check should fail for:

- At least one recorded application error, or at least 100 recorded rate-limit refusals, in the current and four preceding minute buckets.
- Any failed/blocked outbox job; pending/retry work more than 15 minutes overdue; processing whose lease expired more than two minutes ago.
- Any temporary/permanent failure or ambiguous email delivery updated within 24 hours, or any delivery still marked sending more than 15 minutes after its last update, regardless of its age.
- Any recorded Wallet or staff push failure in the current and four preceding minute buckets.
- An application service budget at its warning threshold, or unavailable accounting/monitoring/database checks.

Run the operations check every five minutes and alert independently on a missed run. Independent web uptime, worker freshness and backup freshness monitors remain mandatory and separate from this aggregate check. Verify actual alert delivery before relying on a monitor. Request telemetry is bounded, best-effort aggregation with fixed allowlisted event names and no request dimensions; a process crash may lose the latest second. Counters cover instrumented paths and do not establish that every exception or edge response is captured. A failed monitor is unknown health, not a success.

| Dependency outage | Operator action and customer effect |
| --- | --- |
| Email | Pause affected sends/campaign admission. Reconcile uncertain acceptance using original delivery identity before any replay. A timeout is not proof that nothing was sent. Existing consent, suppression and unsubscribe checks remain mandatory. |
| Wallet | Pause issuance/admission as needed; retain stable pass/object identities and reconcile the provider before retry. Browser checkout uses the server ledger; an already committed award remains committed while the displayed pass may be stale. Track voids separately. |
| Staff push | Staff use the authorized foreground cashier flow. Push is only a wake-up; it does not confirm an award/redemption. Do not extend an expired pending request to recover a missed notification. |
| PostgreSQL | Optional budgets fail closed and checkout must not claim success without a committed transaction. Contain writes/claims and assess database recovery; do not switch to an untracked local balance. |
| Hosting / Compute ceiling | Check official platform status and the actual approved usage controls. Communicate service impact; restore under the incident procedure and explicit spending authority. |
| Monitor / backup destination | Investigate failed/missing heartbeats and latest verified backup independently. An uploaded object with no verified success/restore evidence is not full recovery assurance. |

Before resuming a provider, confirm configuration and quota, resolve uncertain outcomes, authorize one bounded check and review queue growth. Replay only specifically reviewed jobs using the existing worker replay command; never reset states directly in SQL or bulk replay ambiguous email. Record the selected job, approver, reason and result in the restricted operations record without message content or credentials.

Readiness and telemetry each use a separate single-connection pool with one-second connection and client/server query deadlines; allow for these connections in capacity planning. Application pool acquisition is bounded to five seconds and server statements to 15 seconds. A budget reservation uses a five-second client query deadline and discards that direct-query connection on timeout. General application transactions do not use a blanket client read timeout: the installed transaction adapter does not safely discard a timed-out checked-out client. Network partitions remain an incident requiring containment; readiness and worker monitors provide independent outage signals.
