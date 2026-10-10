# LOY-127 draft-save response ordering — local evidence

Base 154821c14630566f0462cee5506a8088cd3758ac. Isolated exact-lock Node 26.3.0 / Next 16.3.6 worktree, synthetic localhost PostgreSQL :55433, Chrome with intercepted synthetic APIs. Date: 2026-10-10 Europe/Berlin. No production credentials or external delivery.

## Reproduction and correction

Two controlled deferred-response tests fail against unchanged base code:

1. Save submits message A, merchant changes to B before completion, response persists A: UI clears dirty and enables scheduling while displaying B.
2. Merchant abandons an in-flight save and starts a new composer: previous response attaches A's saved ID to B, turning B's next save into an edit of A.

Backend schedules the persisted campaign by ID; no display revision is supplied. The focused UI correction tracks composer generation and edit revision. Save acknowledges only its submitted generation; newer edits stay dirty, while the returned ID supports a later update. Start/close invalidate stale success/error responses. Scheduling also rejects a dirty builder draft. Success feedback explicitly distinguishes the saved snapshot from newer unsaved edits. No schema, authorization, consent, provider or scheduling policy changes.

## Verified results

- Base controlled browser reproduction: 2 expected failures, respectively enabled scheduling and leaked saved identity.
- Final production-build synthetic browser: 5 PASS (two reproduced races; audience edits while saving; failure/retry retaining current content; prior numeric audience validation). Payload assertions verify A was submitted first and B/current audience only in the later update; abandoned composer creates a new draft instead of updating A. No schedule request is made.
- Focused campaign suites: 46 PASS /4 files, including draft persistence/idempotency, owner authorization, tenant isolation, scheduling and disabled-delivery safety.
- ESLint, typecheck, default Next production build, diff check: PASS.
- Independent read-only review: no Critical/Important findings; reviewer did not independently run tests.
- Preserved NFC policy/campaign/diagnostic ancestry: verified.

## Remaining gates

Local engineering evidence only. Merchant/operator/provider acceptance and LOY-128 stay open. No live sends, deployment, migration, activation or protected merge. Multi-tab/concurrent-server draft revision behavior is not covered by this UI correction. Unrelated stale audience-preview and scheduling-response races remain unverified candidates. Historical global result at d733234 (1392 PASS /1 pre-existing Mailpit skip) is not a full-suite claim for this SHA.
