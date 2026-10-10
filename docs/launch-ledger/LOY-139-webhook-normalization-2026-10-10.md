# LOY-139 — authenticated Mailgun failure normalization

2026-10-10 Europe/Berlin. FEATURE-G-CAMPAIGN-RELIABILITY. IMPLEMENTED and locally TESTED; not DEPLOYED or externally ACCEPTED. Base `1cf32d3b3a91780002773e900fabe64d11e9e7bc`, isolated `codex/loy139-webhook-normalization`. Result is the commit containing this entry; exact post-commit SHA recorded in canonical native-goal state and authorized tracker evidence. Frozen `32b27ec3fe478ce57d4fd9d58b35aca1dbd6e388`, campaign `e1aae658` and diagnostics `9848e759` ancestry preserved.

## Requirement → code → verification

| Requirement | Code | Evidence |
|---|---|---|
| Actual failed/severity webhook support | transactional-email.ts discriminated schema and normalization after existing HMAC/timestamp verification | Temporary/permanent canonical event logging and correct delivery/suppression state |
| Documented empty custom variables | Only empty array converts to empty record; no inferred job IDs | Message-ID fallback; malformed/nonempty arrays rejected |
| Tenant-safe delivery correlation | Bracket-independent message IDs, provider-scoped OR of supplied job/message identifiers; deterministic job-ID lock order; reject multiple/conflicting matches | Two tenants sharing recipient; ambiguous message ID; pending job with null provider ID; legitimate early failure |
| Authentication and idempotency | Existing dedicated key/HMAC/15-minute window and unique event/token reservations retained | Forged/stale events, invalid/missing severity, duplicate/concurrent/replayed event and signature token |
| Failure ordering and retry separation | Existing canonical state transitions and permanent suppression retained | Temporary→permanent, late accepted/temporary/delivered cannot downgrade permanent; delivered not downgraded by temporary; real temporary failure clears sender429 retry and never resends |

No schema or provider configuration changes. Existing temporary_fail/permanent_fail representations remain supported. New real failed events require a recipient; absent/invalid severity is rejected rather than guessed. Canonical event names are stored without provider body/address/credentials. Same event ID or signature token cannot mutate state twice. Message-ID lookup accepts bracketed API and unbracketed header forms but does not choose among ambiguous tenants. A valid supplied job ID is not silently replaced by a different message-ID match. Early webhooks can correlate a pending job before the API response when no competing known message match exists.

Primary specification checked: https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhook-payloads and https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks (2026-10-10). Webhook subscription names differ from failure event payload names. Provider's temporary delivery retry is distinct from Loynara's explicit HTTP429 sender-throttle retry.

## Verification and independent review

- Unchanged base adapter/route/429 baseline:34tests PASS. Initial sandbox connection EPERM; authorized sanitized loopback execution passed, no test relaxation.
- New documented-payload tests first:5FAIL/8PASS/8existing skipped against unchanged implementation (expected red).
- First focused implementation:47PASS. Added terminal/paused-sending/throttle cases; cross-feature145PASS.
- Independent read-only SolMedium source reviewer found the null provider-ID cross-tenant edge. Added actual early-send reproducer:1expectedFAIL/25skipped, then corrected OR correlation/lock ordering. Reviewer rechecked and reported no remaining critical/important changed-slice findings.
- Final:147tests in8files PASS, including26adapter cases,23explicit429 tests, route3, campaign/production-safety,20reward, unsubscribe and49configuration rejection cases. Fake provider functions and synthetic .test recipients only; disposable loopback PostgreSQL. No production credentials or external requests used by tests.
- Final targeted ESLint and diff check PASS. Final typecheck has5diagnostics identical to verified unchanged base: jsqr, web-push imports and staff-push unknown error. Initial candidate had two missing generated LayoutProps, resolved by local build type generation.
- Local webpack build fails at inherited missing jsqr/web-push modules, matching unchanged-base checks. Broad suite was not repeated; no globally green build/test/release claim.

Reviewer diagnosis was corrected before commit. Routine model routing requested SolMedium; no switching experiments or parallel coding workers. Independent agents performed read-only reviews only.

## Open scope and authorization

LOY-139/140 provider acceptance remains open: separately authorize an approved synthetic opted-in recipient session after sender/consent gates, capture actual receipt and authenticated permanent/temporary provider events, sender429 behavior, withdrawal/suppression/quiet-hour outcomes and reviewer/environment/exact SHA. Local fake capture cannot pass live acceptance. No sends, deployments, hosted mutations, activation, production migration, protected merge or tag change occurred.

LOY-133 catalogue dispatch race is separately reproduced and held: isolated failing test retained at base1cf32d3b, no failing-test commit or speculative architecture fix. Existing delivery holds database locks during provider I/O; a sound separately scoped authorization boundary is needed to satisfy coordinator's no-I/O-locking constraint. Inherited suppression serialization and >500 reward audience capacity remain open. This webhook change does not resolve them. Completed ChatGPT005 selected this bounded slice; final checkpoint follows commit.

Native Goal cumulative checkpoint597854tokens/2537seconds; input/cached/output breakdown and ChatGPT/browser inference unmeasured. Prior CLI counts remain separate. Six-hour deadline1791654628 and2.5Mreported-token ceiling unchanged; native hard-limit configuration unavailable, checkpoint enforcement only. No reset on coordinator rotation. New coordinator6aca2cc5-a964-83eb-8fce-0b09cf1281bf acknowledged continuity; previous URL preserved in native-goal state. Remaining full launch scope, including referrals/merchant management/UX, remains in view; unknown is not complete.
