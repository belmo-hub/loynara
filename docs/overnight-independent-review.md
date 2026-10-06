# Overnight completion independent review — 6 October 2026

This is a review-only application RC. No production connection, mutation, deployment, Railway/Cloudflare change, provider activation, payment activation or external message occurred. Local PostgreSQL and browser fixtures are synthetic. The Claude handoff was treated as an assertion to verify; the exact diff, live code paths, SQL, server guards and tests were independently inspected.

## 1. Provenance

- User-supplied production baseline: `c822d2381dc67544a0ba0c898bf2ddcf98035943`, schema 0019. Production health/schema were not freshly queried in this task. A fresh read-only baseline is a release prerequisite.
- `product/overnight-completion-v1` resolves exactly to `89022bd0ad6ae15771d8d2f76b8843eb43844bef`.
- Baseline is an ancestor; exactly 14 commits follow it, in the order below. The existing candidate worktree was clean before review.
- Original diff: 64 files. No migrations, database schema, dependency manifests/lockfiles, Docker, Railway, Cloudflare, provider credentials or infrastructure configuration changed.
- No added hidden/generated runtime files or secret signatures were found. Eleven tracked PNG changes are intentional synthetic QA screenshots. Review-generated credentials, environments, database files, logs and screenshots stay ignored; `.dockerignore` excludes `.env*`, `var`, `.next` and dependencies.
- Review fixes are on `codex/overnight-review-rc` in the attached independent worktree. The original candidate remains unchanged. The final immutable SHA is recorded in the accompanying deployment packet after the focused commits are created.

### Candidate commits, oldest first

```text
1d8825e3433deab6d8551334ac455260010bd063 feat(retention): honest card-retention states with overview insights and customer filters
34c1de0c8681851e3f0f8bae70cd1f17e5e9bc0d feat(campaigns): goal-led win-back, reminder and announcement drafts with honest delivery state
c68cbec0874e7e2a9465b75c9373af64ce89e32a feat(referrals): make 'shared' visibly different from 'qualified' for owner and customer
1619853bb6891744c9ea00d4aee5bbd04a2c4a0a feat(recovery): show correction impact and link corrections to the entry they undo
e0ed58da17bf424bb3b7bcae8ec5b92389089c27 feat(team): explain who can do what and show role and location per person
a2ea0fc21ff4b0aabc3f40e6b2b38acbd0f8cd2b feat(analytics): retention section and retention-aware deterministic adviser
87ebcfbcf8ac25eae117fe1ad7affd2f246c3ea7 fix(owner): allow more location reads so busy sessions keep location-aware views
92eb6f4e70449593f5bfcf501e25690db7e080e5 fix(ui): drop technical scan-code hint at the till; four campaign goals in one row
8f0c26081eb50d9733800bb79150fc368bcec9bf feat(automations): merchant-language triggers, honest delivery banner, card numbers in run log
a33650537a57fa9cc219c6fe6464f2d4dd8b4db1 fix(overview): present data export as a clear download, not a stray button
5d3adb10e05c094db09ed8b70cbc3b0178dcc8cd test(e2e): follow intentional copy changes; docs: overnight completion review notes
8ba429bf0c210d5512633d253938f48758160771 test(evidence): refresh e2e screenshots for the overnight UI
588a21dee7d8e305901225efbcede034f2f7bd54 fix(cashier): cap the quantity picker at the signed-in role's server limit
89022bd0ad6ae15771d8d2f76b8843eb43844bef feat(pilot): expose campaigns and audiences draft-only; fix dropped link parameters
```

## 2. Changed-file inventory

Inventory below is the exact original 64-file diff, with each file assigned once. Configuration means application policy/navigation, not external infrastructure.

### Backend (7)

- `src/app/api/merchant/customers/route.ts`
- `src/app/api/merchant/locations/route.ts`
- `src/app/api/merchant/retention/route.ts`
- `src/lib/award-limits.ts`
- `src/lib/loyalty.ts`
- `src/lib/merchant-members.ts`
- `src/lib/retention.ts`

### Owner UI (7)

- `src/app/merchant/staff/page.tsx`
- `src/components/owner/card-actions.tsx`
- `src/components/owner/customers-view.tsx`
- `src/components/owner/join-card.tsx`
- `src/components/owner/overview.tsx`
- `src/components/owner/owner.css`
- `src/components/owner/retention-insights.tsx`

### Cashier UI (2)

- `src/app/cashier/page.tsx`
- `src/components/loyalty-ui.tsx`

### Campaigns / audiences (6)

- `src/app/merchant/audiences/page.tsx`
- `src/app/merchant/automations/page.tsx`
- `src/components/owner/campaigns-view.tsx`
- `src/lib/automations.ts`
- `src/lib/campaigns.ts`
- `src/lib/segments.ts`

### Analytics / adviser (3)

- `src/app/merchant/adviser/page.tsx`
- `src/app/merchant/analytics/page.tsx`
- `src/lib/adviser.ts`

### Referrals (5)

- `src/app/merchant/referrals/page.tsx`
- `src/components/card-referral.module.css`
- `src/components/card-referral.tsx`
- `src/components/owner/referral-summary.tsx`
- `src/lib/referrals.ts`

### Tests / evidence (31)

- `docs/overnight-product-completion.md`
- `e2e/cashier-quantity-cap.spec.ts`
- `e2e/merchant-analytics.spec.ts`
- `e2e/merchant-automations.spec.ts`
- `e2e/merchant-campaigns.spec.ts`
- `e2e/merchant-insight-links.spec.ts`
- `e2e/merchant-referrals.spec.ts`
- `e2e/pilot-nfc-policy.spec.ts`
- `screenshots/platform-after-adviser.png`
- `screenshots/platform-after-audiences.png`
- `screenshots/platform-after-automations.png`
- `screenshots/platform-after-billing.png`
- `screenshots/platform-after-offline-accepted.png`
- `screenshots/platform-after-offline-mobile.png`
- `screenshots/platform-after-offline-pending.png`
- `screenshots/platform-after-offline-rejected.png`
- `screenshots/platform-after-referral-analytics.png`
- `screenshots/platform-after-referrals.png`
- `screenshots/platform-after-staff-audit.png`
- `scripts/seed-demo-activity.ts`
- `src/components/owner/nav.test.ts`
- `src/components/owner/overview.test.ts`
- `src/lib/adviser.test.ts`
- `src/lib/automations.integration.test.ts`
- `src/lib/award-limits.test.ts`
- `src/lib/campaign-draft-only.test.ts`
- `src/lib/campaigns.integration.test.ts`
- `src/lib/pilot-surfaces.test.ts`
- `src/lib/promotion-policy.test.ts`
- `src/lib/referrals.integration.test.ts`
- `src/lib/retention.integration.test.ts`

### Configuration (3)

- `src/components/owner/nav.ts`
- `src/lib/pilot-surfaces.ts`
- `src/lib/promotion-policy.ts`

## 3. Security and cashier limits

No P0/P1 security or data-loss defect was found. Server authorization still resolves an active staff role in the tenant/location. Request bodies cannot choose a privileged role. Shared manual caps are cashier 10, manager 100 and owner 1000; unknown/null roles fall back to 10. The owner picker remains conservatively capped at 100. Direct requests over the server limit fail. Award-limit, HTTP/service authorization, cashier browser and full regression tests pass.

All changed production files were reviewed, including development-only automation wording and synthetic seeding. Existing same-origin/ingress controls, owner-only campaign APIs, correction authorization and reissue authorization remain intact. Merchant-visible mismatches were treated as P2 and corrected, rather than dismissed as cosmetic.

## 4. Retention and overview

Retention is based on recorded, unreversed `staff_online`/`staff_offline` award events. Referral bonuses, synthetic awards, corrections and redemptions do not become visits. A reversal removes the original checkout from retention/referral qualification. Closed cards are excluded from actionable retention. Active-program, membership tenant and explicit location scope are checked in the queries and service authorization.

The 14/30/60/90-day boundaries pass integration and browser checks. Customer filtering now uses the same elapsed 24-hour cutoff as the summary, avoiding calendar/DST disagreement. The customer destination carries exact location IDs, or an explicit all-location scope, plus minimum age 7 where the insight counts older never-active cards. Query-only Next navigation updates the view rather than keeping stale local filters. Cross-location and cross-tenant requests are denied.

Near-reward means up to one quarter of the cheapest effective active reward, rounded up to whole units. Reward-ready means current balance can afford that reward; it does not assert that the customer has never redeemed. The exact cheapest reward ID now survives overview/audience links into the composer, so a larger second reward cannot inflate its preview count. Combined-program summaries and searched/all-location customer lists no longer offer a misleading campaign shortcut targeting just the active programme.

“Was jetzt zählt” renders at 1440 and 390 with the requested production feature flags. It uses database values and is not dependent on campaign visibility. Goal/day/reward parameters reach the destination. Counts are reconciled against customer/preview queries. Language describes recorded activity and current eligibility; it does not guess why a customer was away or promise causation.

SQL uses tenant/program/location predicates, membership/time ledger indexes and the unique reversal relationship. No unbounded cross-tenant scan or interpolated request SQL was introduced. The aggregate queries still read scoped ledger history, so larger-pilot query plans/load measurement remain useful. The week-ago comparison uses historical activity/closure under the currently active programme/reward catalogue; it is not a historical catalogue snapshot.

## 5. Campaign draft-only safety

Owner campaigns and scoped audiences are visible; automations remain hidden by navigation and direct page gate. The real production-build browser flow passes: insight → composer audience preview → content → review → saved draft. Recently-active `withinDays` and near-reward `rewardId` are preserved. The composer and paused-campaign detail no longer expose datetime/reschedule controls when delivery is disabled. There is no schedule/send action in this configuration.

Real API/service/local-DB tests prove:

- Parallel duplicate creation returns one draft with the same ID.
- Preview and draft creation add zero campaign recipients and zero campaign dispatch/email jobs; browser draft save leaves the entire outbox count unchanged.
- Direct scheduling returns HTTP 400 `EMAIL_DISABLED`; client-supplied delivery flags cannot override server configuration/body validation.
- Manager and cashier create/edit/preview/list/detail requests return 403.
- Injected existing dispatch and recipient jobs return blocked before recipient generation or provider/local-mail calls.
- False approvals win even with a complete synthetic Mailgun configuration; global fetch and provider/local sender spies record zero calls.

`src/lib/campaign-draft-only.test.ts` alone is insufficient: its four checks cover mode/visibility and incomplete configuration, not SQL writes, idempotency, API authorization or worker execution. The new `campaign-production-safety.integration.test.ts` exercises those boundaries with real queries and services; only synthetic session identity and network/provider observation are mocked. The production browser test adds real authentication/navigation under closed registration. Neither test represents permission to enable sending.

Outcome reporting is observational: unique contacted cards with a legitimate unreversed checkout strictly after their recorded `sent_at`. EXISTS avoids double counting repeated visits, and synthetic/referral/correction events do not count. Text says a return was observed after contact, not that the campaign caused revenue or a return. Historical completed recipients are seeded only in the isolated test to verify the relationship.

## 6. Manager audience verdict: KEEP

Managers can inspect programme audiences in their assigned location. Both programme lookup and retention/customer services enforce tenant and assigned-location scope. Changing URL/body scope cannot escape it. Managers have no campaign navigation or campaign create/edit/preview/list/detail capability; owner APIs remain owner-only. Read-only audience inspection is useful and does not expose cross-location/tenant identities. No security or serious UX reason to hide it was found.

## 7. Referrals

Native `navigator.share` receives the public referral signup URL, never the private card bearer token. Cancellation is handled without a surprise clipboard write; explicit copy copies that referral URL. The browser test spies on native sharing/clipboard, so no actual external message is sent. A real OS share sheet was not exercised.

Sharing, signup and bonus qualification are distinct. Customer progress contains only aggregate counts for its own referrer card/tenant, not referred identities. The owner uses random `K-XXXXXX` locators where displayed. Rejected bonus reviews remain real signups: the customer signup count now includes them, matching the owner funnel. “Qualified” copy explicitly means a credited bonus, which avoids implying every historical/reviewed qualification is an additional physical visit. Existing qualification, abuse review and reversal logic was not changed.

## 8. Correction and reissue

Correction arithmetic is now explicitly the effect of the selected entry, with a warning that undoing a first checkout may also withdraw referral bonuses. It no longer promises an inaccurate final balance. The server confirms the final balance. Reason length, authorization, idempotency, append-only compensating ledger rows and `reversalOfId` history linkage remain unchanged. Correction integration covers concurrent reversals, scope, redemption restoration and referral withdrawal.

Reissue entitlement confirmation, accepted verification methods, reason requirements and server role/scope checks are unchanged. Old bearer/scan access is invalidated; locator, balance and ledger history survive. Eight card-reissue integration cases pass. The existing browser regression additionally checks the complete correction/reissue flow, denied cashier endpoints and dialog reachability from 320 through 1440 pixels.

## 9. Team/roles

The permission explanation now distinguishes manager read-only access to rules/rewards from owner editing. Cashier: checkout operations in the assigned location, cap 10, no customer correction/reissue/owner pages. Manager: assigned-location customers, correction/reissue and read-only programme/rewards/audiences, cap 100; no campaigns, team management or owner-only analytics/settings. Owner: tenant administration and configured capabilities, cap 1000 on the server. UI copy does not promise delivery, NFC, Wallet or payment capability. Staff roles/location labels reconcile with server checks.

## 10. Location-read rate limit: ACCEPT

Owner shell/full navigations repeatedly load locations; 60/user/15 minutes exhausted during busy legitimate use, dropping location-dependent views. The change permits 240/user/15 minutes and adds a 480/IP/15-minute ceiling. Authentication, owner scope, trusted-ingress validation and write limits are unchanged. This is acceptable for the pilot, with bounded read exposure. A shared shell fetch/cache or request deduplication should reduce repeat reads later; it need not block this release.

## 11. Empty campaign-limit environment value

Missing/empty/whitespace `PROMOTIONAL_MONTHLY_LOCATION_LIMIT` means the safe default 100, rather than zero. Invalid non-empty values, unsafe integers, zero, negative or excessive values fail validation. The cooldown defaults to 24 hours and is likewise bounded. No unlimited mode is introduced. Promotional delivery is independently disabled by the production approval/configuration chain.

## 12. Production-equivalent QA and NFC off

The final `next build` was run through `next start` on loopback port 3027 using:

```text
NODE_ENV=production
PRODUCTION_ENVIRONMENT=loynara-production
TRUSTED_INGRESS=cloudflare_tunnel
PUBLIC_REGISTRATION_ENABLED=false
STAFF_INVITE_SIGNUP_ENABLED=true
NFC_ENABLED=false
APPLE_WALLET_ENABLED=false
GOOGLE_WALLET_ENABLED=false
LIVE_BILLING_ENABLED=false
BILLING_FIXTURE_MODE=false
EXTERNAL_EMAIL_ENABLED=false
TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED=false
PROMOTIONAL_EXTERNAL_EMAIL_ENABLED=false
MAILGUN_SEND_APPROVED=false
MAILGUN_PROMOTIONAL_SEND_APPROVED=false
```

Provider credentials and NFC keys are empty in the local web fixture. Production-equivalent feature/auth/ingress decisions are exact; the database and origins remain isolated loopback, not production TLS/database endpoints. The unchanged startup guard correctly refuses local demo credentials/HTTP/loopback production deployment settings; it was not weakened. Direct `next start` is only the local QA harness. Production guard/config tests passed in the full suite. This QA is not a live production infrastructure verification.

The previously failing NFC-policy expectation is corrected to follow actual capability/`hiddenSurfaces`. Under NFC off, programme controls and the cashier confirmation panel are absent, even if a staff-confirmed policy is stored. Automatic policy API requests fail `TAP_AUTOMATIC_NOT_ALLOWED`; the stored test policy is restored to disabled. Both 1440 and 390 production-build tests pass. No NFC provider, key, hardware or feature activation occurred.

Overview, customers, analytics, referrals, team, cashier, campaigns and audiences render at both widths without horizontal overflow. The saved draft and customer-referral path were visually inspected. Synthetic screenshots are in the accompanying evidence directory.

## 13. Verification results

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build`: PASS (Next 16.3.6; final source).
- Full Vitest: 101 files passed; **821 passed, 1 skipped, 822 total**. This includes tenant/role isolation, campaign safety, retention, referrals, corrections, card reissue and production/NFC configuration CLI guards.
- Relevant existing browser suite: **26 passed, 1 skipped** across 11 files (cashier cap, logout, adviser, analytics, audiences, campaigns, customers, insight links, referrals, owner dashboard and NFC policy).
- Additional correction/reissue browser suite: **3 passed** (full flow, denied-role endpoints and five viewport sizes).
- Production-equivalent safe browser suite: **2 passed**, one at each width; NFC off, all eight surfaces, real authentication, closed registration, scoped manager, draft save, direct schedule refusal and referral-sharing path.
- Query-only insight navigation regression: PASS.
- `git diff --check`: PASS.

The unit skip is optional `MAILPIT_SMOKE=true` recovery capture; Mailpit/Docker is unavailable. The existing browser skip requires enabled NFC hardware/capability and is intentionally inapplicable with NFC off. All applicable final checks are green. There is no unexplained red test.

Resolved setup failures are documented to avoid hiding them: symlinked dependencies were rejected by Turbopack and replaced by a real installed-package copy; Next route types were generated; localhost-only billing test guards required the exact localhost test DB URL; CLI subprocess dotenv loading required separate unit `.env` and web `.env.local`; repeated shared-peer fixtures hit deliberate signup/read throttles, handled by bounded local-only fixture counter resets. The correction/reissue legacy fixture also needed local ingress rather than a Cloudflare header requirement. No production guard or application rate limit was weakened to make QA pass.

## 14. Focused fixes

1. Align retention/customer/adviser links by location, age, elapsed days and reward; sync query-only navigation; suppress misleading campaign shortcuts from combined/searched scopes; correct activity/eligibility copy.
2. Preserve audience goal parameters and hide paused rescheduling controls while delivery is disabled; add independent real API/DB/provider safety tests.
3. Correct referral signup/bonus reporting, correction preview language and manager read-only permission wording, with regressions.
4. Correct the stale NFC-off browser assertion and add production-build desktop/mobile draft-only QA.

No migration, infrastructure, external provider, payment, NFC or Wallet source configuration changes are part of these fixes. Fresh tests above cover the final source.

## 15. Remaining limitations

No release blocker remains. Nonblocking follow-ups: measure retention query plans with larger tenant history; deduplicate shell location reads; consider an authoritative transaction-wide correction preview; clarify the current-catalogue basis of week-ago comparisons if historical catalogue changes become common. Optional Mailpit capture and a real OS share sheet were not run. Live production baseline/health, worker heartbeat and retained synthetic smoke remain release-time checks requiring separate authorization.

## 16. Minimal next-RC release procedure — proposed only

No schema change: keep 0019. Do not run a migration or repeat the earlier V5 database procedure. Build/deploy from the exact reviewed tracked SHA, using the existing Docker/startup guard and existing worker command/configuration. Keep the current approved origin and all disabled feature/provider flags.

1. Fresh read-only production baseline: confirm current web/worker application identity, schema 0019, health/auth, approved-origin/ingress policy, disabled features/approvals, worker heartbeat and queue/recipient/send totals. Read only allowlisted non-secret flags. Stop on unexplained baseline drift.
2. After separately authorized execution, release the exact reviewed SHA to web only. Use existing deployment/service configuration; no Railway/Cloudflare/env edits, seed/migrate commands or provider activation.
3. Verify web health/database connectivity, current approved origin, closed public registration, invite gate, authenticated role/tenant scope and disabled capability surfaces. Campaigns/audiences must be visible as reviewed; automations/NFC/Wallet/billing remain withheld.
4. Release worker at the same exact SHA using existing settings and reviewed heartbeat. Verify queue status and blocked disabled-provider behavior. Do not replay/purge historical jobs or enable sends.
5. Use retained approved synthetic identities for targeted owner/manager/cashier smoke: checkout caps, customer/retention links, referrals, team, correction/reissue with entitlement and append-only audit, desktop/mobile surfaces. No broad seed/reset or real customer mutations.
6. Follow insight → audience → compose → preview → save draft; repeat the identical save and verify one draft. Check recipient/job deltas are zero and direct scheduling remains `EMAIL_DISABLED`. Inspect provider/send evidence read-only: zero external promotional and transactional sends.
7. Record final web/worker identity, health/queue/heartbeat, unchanged schema/configuration and synthetic evidence. If behavior fails, stop and roll back web and worker to the previous immutable baseline image/SHA. No database rollback is needed; preserve ledger writes/evidence and queues.

## 17–18. Owner review and recommendation

Owner review approval is requested for the exact final RC and this proposed application-only procedure. This packet grants no production execution permission. Recommendation: ready for owner release review. The accompanying deployment packet records the focused child commits, final immutable SHA and clean-tree verification.
