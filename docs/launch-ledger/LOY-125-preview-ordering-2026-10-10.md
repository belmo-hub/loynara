# LOY-125 / LOY-127 audience-preview response ordering — local evidence

Base 2c73a11ca693d43fdc087ff4fa9df32d0cf53247. Isolated exact-lock Node 26.3.0 / Next 16.3.6 worktree, synthetic localhost PostgreSQL :55433 and Chrome-intercepted APIs. Date: 2026-10-10 Europe/Berlin. No production credentials/provider activation.

## Reproduced gap and correction

Three controlled deferred-response browser tests fail on unchanged base: old audience A success overwrites B's completed counts; old A error overwrites B success; old composer A success appears in a new composer B. Soft visual assertions fail, while subsequent draft-save payload assertions pass with audience B. This demonstrates misleading eligibility feedback, not a reproduced server audience mutation. Delivery remains disabled in these preview tests.

Preview success/error now updates only for the current request and submitted composer generation/edit revision. Closing, replacing or editing the composer supersedes the old response; a newer request also supersedes earlier requests. Current failures remain visible and retry works. No server audience, authorization, consent, suppression, scheduling policy or schema changes.

## Verification

- Unchanged base: 3 expected browser failures, no failure in subsequent current-audience save assertions.
- Corrected production-build Chrome: 9 PASS, including four preview scenarios (three reproduced races plus current error/retry), four prior draft-save cases, and audience numeric validation. Controlled request completion and rendering frames synchronize responses without fixed sleeps.
- Focused integration/component suites: 50 PASS /5 files, covering segments, draft persistence/idempotency, owner/tenant authorization, scheduling and disabled-delivery safety.
- ESLint, typecheck, default Next production build and diff check: PASS.
- Independent read-only review: no Critical/Important findings; reviewer did not independently execute tests.
- Frozen NFC policy plus campaign/diagnostic ancestry: verified.

## Outstanding acceptance and limits

Local engineering evidence only. LOY-125/126 and LOY-127/128 remain independently unaccepted. No live sends, provider activation, deployment, migration or protected merge. Preview remains a point-in-time estimate; server dispatch must recheck current eligibility. Multi-tab server draft revisions and unrelated scheduling-response races remain separate unverified work. Historical full integration at d733234 (1392 PASS /1 pre-existing Mailpit skip) is not a new-SHA global claim.
