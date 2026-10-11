# LOY-317 — campaign draft save identity acknowledgment

2026-10-11 / LOY-ENG-20261011-092. Base `0e9ae91a8cf32edd3ac2c87d0ba33b90b706a773` → code and local integration `6fc9cf097defb0ba40a3c1ffbc505538f093ec24`. The final ledger receipt SHA is recorded in durable state after integration.

The composer previously marked an existing draft saved and clean after HTTP 200 returned an empty object or another campaign ID. Two genuine unchanged-source Chrome failures reproduced this after the actual authorized API had committed the edit. A small response helper now requires a nonempty identity and, for edits, the submitted identity. Existing `id`, `campaignId` and `campaign.id` forms remain compatible. Invalid acknowledgments use the existing unconfirmed-save message and retain edits. Generation/revision fencing, consent, scheduling, API authorization and provider behavior remain unchanged.

Changed components: campaign composer and new acknowledgment helper/unit tests; new campaign browser regression and QR-download failure browser regression. No database schema or migration change. Coordinator contract authorized one fallback because the primary QR behavior was already correct. No third investigation.

The primary QR workflow fetches SVG, validates it, then generates the supported `anmeldeschild.html` Blob. Three actual browser cases passed on unchanged source: HTTP503, truncated200SVG and connection reset each yield visible failure, no download or automatic retry, then an explicit retry yields complete correct-merchant HTML. No membership, award or outbox was created. No QR production defect, new format or physical acceptance is claimed. The accepted normal decoding/enrollment089 work was not repeated.

Validation:

- Browser: 2 actual authenticated application/database edit cases and 4 existing mocked save-race cases passed in14.5s. Explicit same-draft retry persists latest edits, one draft remains, and recipients/attempts/outbox stay empty. New create-failure browser coverage was not added; helper tests cover accepted create response forms and invalid identities.
- Focused: 61 tests in5files passed3.15s; integrated candidate61 passed3.23s.
- Full configured suite: FIRST run174files,1616PASS,0FAIL,1existing optional MailpitSKIP,159.20s. This includes the later091 operator regression as well as12 new helper cases.
- Type generation, typecheck, changed-file zero-warning lint, production build and diff check passed.
- One independent read-only sensitive static review found no material issue. Reviewer did not rerun tests. Initial sandbox-only write/connect permission failures were recovered through authorized escalation; neither application tests nor assertions were weakened.

Execution: Mac, one existing isolated engineer; coordinator requested `gpt-6.1-sol` Medium discovery, High implementation and Medium review. Effective switching control unavailable; existing executor retained. Effective configuration, input/cached/output and browser/reviewer usage remain unmeasured. Native Goal ACTIVE with11,801,016 cumulative reported tokens/62,891seconds and no native remaining budget; historical accounting preserved without reset.43GiB free,13 retained registered worktrees; no new tree, install or cleanup. Exact affected paths had no concurrent overlap; Desktop status remained UNKNOWN from earlier bounded stalls and was not rescanned or changed.

YouTrack317 created beneath127, progressed InProgress→InReview→Done, with comment7-153/readback08:58:54UTC.147 receives truthful primary evidence comment7-154/readback08:59:07UTC, remains Backlog/unresolved. Parent127/128 and147/148 full acceptance remains OPEN. One Gmail search found0 matching317 messages; notification generation, delivery and receipt remain UNVERIFIED. These are the only external actions besides the authorized coordinator review.

IMPLEMENTED, TESTED and LOCAL INTEGRATED. Not PUSHED, DEPLOYED, INDEPENDENTLY ACCEPTED or COMMERCIALLY READY. Frozen32b27ec3 exact, e1aae658/9848e759 ancestry, migration0024, branches and cleanup archives preserved. Owned092 browser database removed only after stopping its app and asserting zero connections. Remote push remains parked under185/186 trigger-safety uncertainty; all existing founder/provider/physical/legal holds remain unchanged.

Next candidates, refreshed live and not presumed defects:163 owner returning/visit/inactivity/retention accuracy beyond169 snapshot;155 location visibility/authorization under established policy, park159 semantics;43 precise export gaps within existing approved scope, park209 legal/category decisions. No launch completion claim.

[Sanitized evidence and log hashes](LOY-317-campaign-save-identity-2026-10-11-evidence.json).
