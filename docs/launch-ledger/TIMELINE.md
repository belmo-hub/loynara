# Development evidence timeline

Append chronological events; retain historical records. Git author timestamps below are source timestamps, not independently verified execution timestamps. Historical agent/model and usage categories remain unknown unless their linked record establishes them. No entry implies deployment or acceptance.

| Git date | Result SHA | Evidence | Local event |
| --- | --- | --- | --- |
| 2026-10-10T14:09:14+02:00 | `1cf32d3b3a91780002773e900fabe64d11e9e7bc` | [LOY-133-reward-reminders-2026-10-10.md](LOY-133-reward-reminders-2026-10-10.md) | feat(automations): add consent-safe catalogue reward reminders |
| 2026-10-10T14:34:05+02:00 | `76821a310567a6084bb75bf766c7e64e106a848d` | [LOY-139-webhook-normalization-2026-10-10.md](LOY-139-webhook-normalization-2026-10-10.md) | fix(email): normalize authenticated Mailgun failure events |
| 2026-10-10T14:56:22+02:00 | `fb73e0798cc042ffdfda8c0760352535471b1269` | [LOY-145-setup-validation-2026-10-10.md](LOY-145-setup-validation-2026-10-10.md) | fix: validate merchant setup review before onboarding |
| 2026-10-10T15:17:08+02:00 | `75e07514c78b54e887d14a0bab5d0beb793c8734` | [LOY-119-verified-referral-duplicates-2026-10-10.md](LOY-119-verified-referral-duplicates-2026-10-10.md) | fix: hold duplicate verified referral identities for review |
| 2026-10-10T15:23:23+02:00 | `1c2345367a8b2fa9fce7293790d1a163b799f2ac` | [2026-10-10-integrated-test-configuration.md](2026-10-10-integrated-test-configuration.md) | docs: record configured integration failure classification |
| 2026-10-10T15:33:50+02:00 | `667aafbe107aa0c2e54c88c220da50d19800ebd8` | [LOY-153-invitation-serialization-2026-10-10.md](LOY-153-invitation-serialization-2026-10-10.md) | fix(staff): serialize invitation role assignment per account |
| 2026-10-10T15:42:54+02:00 | `3156a4039c44bdb08ce67273a1057cb1d73f25a0` | [LOY-157-checkout-revocation-ordering-2026-10-10.md](LOY-157-checkout-revocation-ordering-2026-10-10.md) | fix(loyalty): order checkout commits against staff revocation |
| 2026-10-10T15:57:45+02:00 | `d733234b4d8637760efe34176153b002e60c36bc` | [2026-10-10-full-configured-integration.md](2026-10-10-full-configured-integration.md) | docs: record configured full integration results |
| 2026-10-10T16:09:45+02:00 | `154821c14630566f0462cee5506a8088cd3758ac` | [LOY-127-campaign-audience-validation-2026-10-10.md](LOY-127-campaign-audience-validation-2026-10-10.md) | fix: validate campaign audiences before preview and save |
| 2026-10-10T16:17:18+02:00 | `2c73a11ca693d43fdc087ff4fa9df32d0cf53247` | [LOY-127-draft-save-race-2026-10-10.md](LOY-127-draft-save-race-2026-10-10.md) | fix: acknowledge only submitted campaign draft revisions |
| 2026-10-10T16:24:54+02:00 | `aae6dcc6f4428e6058651382011d8b9b29da3ce7` | [LOY-125-preview-ordering-2026-10-10.md](LOY-125-preview-ordering-2026-10-10.md) | fix: discard superseded campaign audience previews |
| 2026-10-10T16:40:19+02:00 | `95e97934d52a53d2e67543d37b84344ab567636a` | [LOY-49-redemption-catalogue-ordering-2026-10-10.md](LOY-49-redemption-catalogue-ordering-2026-10-10.md) | fix: serialize selected reward booking with catalogue changes |
| 2026-10-10T16:53:32+02:00 | `9552b3773e6df8581127b230abb0535150e6fa50` | [LOY-49-purchase-rule-snapshot-2026-10-10.md](LOY-49-purchase-rule-snapshot-2026-10-10.md) | test(loyalty): characterize purchase rule snapshot concurrency |
| 2026-10-10T16:59:09+02:00 | `e03dc685e9330cd2ce099c116b705232e1ff1006` | [2026-10-10-current-integrated-regression.md](2026-10-10-current-integrated-regression.md) | docs(launch): record current integrated compatibility results |
| 2026-10-10T17:12:55+02:00 | `7e5da56d8de0a157dfb0242c494161c43cc6e9a3` | [2026-10-10-recovery-mailpit-capture.md](2026-10-10-recovery-mailpit-capture.md) | docs(recovery): record real local Mailpit capture verification |
| 2026-10-10T17:28:59+02:00 | `cd38bdcdcb72135e236fd533ad5c921712347246` | [LOY-43-customer-export-snapshot-2026-10-10.md](LOY-43-customer-export-snapshot-2026-10-10.md) | fix: export customer activity from one database snapshot |

Current documentation task: [permanent-record requirement](2026-10-10-permanent-build-launch-record.md), resulting commit is its containing commit until a later index records its exact SHA. Earlier history remains an explicit reconstruction gap; preserve Git and source documents.

2026-10-10: [LOY-165 bounded evidence](LOY-165-reporting-evidence-2026-10-10.md), base5a58f247; result is its containing commit. Four existing analytics fixtures PASS; no runtime discrepancy reproduced; staff/location breakdown and export scope gaps remain open.

2026-10-10 exact post-commit references: permanent ledger requirement5a58f247fa84e3c9e47e944b11b9c13483b7a7a0; LOY165 evidence9085a2b22366d4944d3a233f75ab167ec5badfb2. [Remaining-work checkpoint](2026-10-10-remaining-work-checkpoint.md) preserves cached all-lane inventory and human actions without a repeated audit; result is its containing commit.

2026-10-10 [owner-export characterization](LOY-165-owner-export-characterization-2026-10-10.md), base38e3990; one corrected temporary fixture and final1PASS, no tracked test/source changes.


2026-10-10 amendment: [Founder-authorized continuation, local integration and tracker reconciliation](2026-10-10-founder-continuation.md). Historical internal resource hold superseded by direct founder instruction; cumulative accounting preserved. Latest sourcea71d782 local suite1416PASS/0FAIL/1existingSKIP. No deployment, remote push, independent acceptance or scope completion. LOY-133 real-PG race remains open.


2026-10-10: [LOY-43 redemption/reversal export snapshot coverage](LOY-43-redemption-export-snapshot-2026-10-10.md) adds two durable real-PG cases; actual fixed source passes, read-committed control fails. No application/policy change or external acceptance. LOY-133 dispatch cutoff queued for founder decision; independent engineering continues.


2026-10-10: [LOY-273 campaign audience pagination](LOY-273-campaign-audience-pages-2026-10-10.md), related125/129: realPG499/500/501/1001 boundaries and interruption/replay; finalglobal153files1422PASS/0FAIL/1existingSKIP, build/type/lintPASS. Sending quotas retained. FirstWallet-hook timeout preserved with current/base9PASS comparisons. No deployment/provider acceptance or fullscope completion.

2026-10-10: TESTED LOY-157 saved audience cursor after real staff departure/reassignment,15focusedPASS; negativeguardcontrol1expectedFAIL,source restored; build/type/lintPASS. [Entry](LOY-157-audience-cursor-lifecycle-2026-10-10.md). Referral contract gap preserved; no deployment/acceptance.

2026-10-10: TESTED LOY-157 real credential-change/old-session/fresh-login cashier authorization;14focusedPASS, no app defect; type/lint/buildPASS. [Entry](LOY-157-credential-session-authorization-2026-10-10.md). Reset-email and independent acceptance remain open.
