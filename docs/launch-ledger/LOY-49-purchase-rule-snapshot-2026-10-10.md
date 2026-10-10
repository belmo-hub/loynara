# LOY-49 purchase-rule snapshot evidence — 2026-10-10

Base 95e97934d52a53d2e67543d37b84344ab567636a; result is the commit containing this document. Isolated codex/loy49-earning-snapshot. Test-only characterization; production code unchanged. Full launch and independent acceptance remain open.

## Requirement and decision

Live LOY-37/38 remain Backlog, Scope Decision Required, with exact purchase/points/catalogue/programme variants requiring written founder decisions. Cached canonical articles likewise record the hold. No canonical transaction-start versus commit-time earning-rule semantics was found. Existing code rejects a stale version at validation, stores immutable purchase audit/rate/version, and preserves exact booking replay. A completed catalogue update before an already validated award commits is not automatically a demonstrated policy violation.

| Requirement | Measured local evidence | Remaining gate |
| --- | --- | --- |
| Validated earning snapshot | Rule A/rate 3, amount 499, floor 14 points, ledger delta and balance remain consistent while owner commits B/rate 4 | Founder effective-time semantics, independent acceptance |
| Owner change first, still uncommitted | Award reads committed A; both transactions pause at real Wallet queue inserts; audit retains A/rate 3/14 | Whether pending update must block earning is not decided |
| Update between programme read and version validation | Old request A rejects STALE_RULE; no purchase audit, ledger or balance change | Other possible version/rate combinations unverified |
| Replay after completed update | Exact request returns original entry/14/duplicate; new key with A rejects STALE_RULE; ledger, balance and queued jobs unchanged | Physical/retry acceptance remains open |

Three deterministic PostgreSQL characterization tests PASS on unchanged production source; no expected policy assertion was weakened and no correction attempted. Synchronization observes actual pg_stat_activity lock waits, using dedicated loopback looplocal_test database and synthetic identities. No customer/provider I/O occurs.

## Verification

- 28 unique tests PASS across five suites: purchase-rule-snapshot 3, loyalty 8, redemption-catalogue 5, staff-revocation 5, offline-earning 7. New three rerun PASS after strengthening post-replay ledger/balance/queue assertions.
- Exact cached lockfile installation; Next route type generation, TypeScript, targeted ESLint and diff checks PASS. No production code changed; prior base default build and two authenticated browser checks are preserved, not claimed as a fresh build/browser execution. A new production build is unnecessary for a test/document-only result.
- Independent read-only review: no Critical/Important introduced finding; successful snapshots are consistent but do not establish founder effective-time intent. No independent test execution. Mixed-read coverage is request A only. Review suggestion to recheck ledger/balance/outbox after stale request implemented and rerun.
- Initial focused command named a nonexistent staff-revocation-ordering file; Vitest actually ran three suites/16 tests. Correct staff-revocation plus offline suites subsequently ran 12 PASS. Count reflects actual five files, not the initial argument list.

## Boundaries and follow-up

No speculative programme lock or changed rule-effective-time policy. Programme locks could affect merchant/checkout ordering; provider-I/O and LOY-133 architecture remain excluded. Selected reward and user-before-staff revocation fixes preserved. LOY-38 founder action must define whether validated A may complete after B commit or must be revalidated/serialized, and how an unresolved B transaction affects earning. Do not infer this from automated review. LOY-49/50 and independent device, physical/provider/legal/commercial gates remain open.

Measured native Goal usage at evidence preparation: 1,913,659 reported tokens /10,935 seconds, no reset; since checkpoint017 reported1,816,259/10,219: +97,400 tokens/+716 seconds. Input/cached/output split and browser inference unmeasured. Original2.5M ceiling and19:50:28Berlin deadline unchanged; existing-goal native cap unavailable, checkpoint accounting enforced. Prefer one configured global compatibility run next after the recent campaign and financial changes.
