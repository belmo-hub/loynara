# Owner dashboard – integration plan for Codex (after Gate 1)

## RC integration — 1 October 2026

Accepted release baseline: `a96fc12313fc6f8153cc7d21472bf9fe06877a01`.
Integration branch: `integration/owner-dashboard-v1`.
Frozen source: `652d214f2f572a6f82a6591d3e9641e791ad1d83`.
The baseline and frozen ref were clean and unchanged. The path intersection from
`5c51d992d18095211e169eeb9e5e9ebf8c565b8a` was empty; merge-tree completed without
conflicts. Release changes since the earlier forecast were documentation only.
No dependency or API-contract drift was found before integration.

Actual pick order: A `ddf8569`; B `b06dfba e841bb3`; C
`05ae27b 4c42053 30803a1 4c6bde0 c92c48c da6be7a`; D
`5e26930 7ab1c25 383a7fb 2f29edd 26edaab 09747f8 a375b79 652d214`.
The historical grouping below is superseded by this order: `4c6bde0` depends on
earlier C changes and was applied in C, never immediately after A.

### Temporary onboarding procedure

The supported temporary starting state is an **operator-provisioned authentication
identity only**: user and credential account, with no tenant, location, programme,
or staff assignment. Provision it through the separately authorized private
operator process; this integration does not execute that process, enable public
registration, or add a provisioning endpoint. Do not use the demo seed as an
onboarding procedure. The owner signs in and completes `/merchant/program`;
the existing atomic `createMerchant` flow creates the business and programme.

Retries for a completed single-location active owner return the same merchant
identifiers without changing business data, rewards, or billing. Concurrent
onboarding requests serialize on the existing authentication identity. A retry
does not reactivate revoked staff or promote managers/cashiers. Owners with
multiple locations are directed to their existing overview instead of selecting
an arbitrary location as an onboarding result.

An account already assigned to a tenant but missing a location or active programme
is an incomplete setup, not a new wizard candidate. It receives a German setup
error directing it to support. Revoked staff receive a German access error.
Only the explicit `/api/me` response with `tenantId: null` opens the wizard;
a generic 404 does not. Partial records are not repaired automatically.

This compatibility change is confined to the existing product service, owner
context/pages, and regression tests. No migration, auth-hook change, or signup
architecture change is involved. The user-reported absence of production tenant
data was not rechecked against production.

The release-relevant `scripts/record-full-platform-demo.mjs` still uses old
campaign labels and flow (for example `Titel`, `Zielgruppe auswählen`, and
`Termin für Planung`). `scripts/capture-merchant-screens.mjs` still expects
`.reward-manager-row`. Both were inspected and left unchanged: neither is needed
for regression. Demo re-recording remains a later publication task.

Gate 1 operations were not reopened. Historical redeploy provenance remains
**ACCEPTED-RISK — contained and superseded**. No deployment is authorized by this
integration record.

### Verification and final review

All 17 frozen commits were applied in the specified order without conflicts;
their patch IDs match the source commits. Slice A passed typecheck, scoped lint,
6 affected unit tests and 4 browser checks. B passed typecheck, full lint and
5 setup/brand/programme/owner-role checks. C passed typecheck, full lint,
324 unit/integration tests (the opt-in local email smoke was skipped at that
stage), and customers/campaigns/referrals/audiences browser checks. Its campaign
test needed the already-frozen exact-button selector correction from D in a
scratch test copy; the D commit was still applied only in its specified order.
D passed typecheck, full lint, build and 20 dashboard browser tests. Its opt-in
local billing fixture test was covered in the final supplemental run below.

The independent review found three dashboard defects: location-switch refresh
failure could leave a loading screen, three content links bypassed the edit
guard, and changing customer scope could reset the applied filters. Five new
browser regressions failed against the imported implementation and passed after
bounded fixes in owner components and the locations page. All findings were
addressed; there was no second independent review. Production operations and
the documented backend/provider and browser-Back limitations remained outside
the review's integration scope.

Final verification after these fixes:

| Command/check | Result |
|---|---|
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `MAILPIT_SMOKE=true COMPOSE_PROJECT_NAME=loynara npm test` | 62 files, 334 tests passed, 0 skipped; 41.02s |
| `node var/owner-integration/run-specs.mjs e2e/*.spec.ts` | All 27 files; 45 passed, 1 conditional local-billing skip |
| `BILLING_FIXTURE_BROWSER=true node var/owner-integration/run-specs.mjs e2e/merchant-billing.spec.ts` | 2 passed, 0 skipped with the guarded local fixture server; covers the skipped test, giving 46 distinct browser tests passed |
| `npx playwright test --config var/owner-integration/playwright.config.ts var/owner-integration/specs/responsive-accessibility.spec.ts` | 8 passed |
| `LOOPLOCAL_NEXT_DIST_DIR=.next-device-test npm run build` | Production Turbopack build, exit 0 |

Browser coverage includes dashboard navigation, setup, customers, campaigns,
referrals, audiences, analytics, cashier, HTTP/security boundaries and tenant
isolation. Layout checks visit 15 merchant routes at 1440/1024/390/360px and
200%/300% zoom-equivalent viewport widths; they verify reflow, not the browser's
native zoom control. The wizard's four steps were checked at all six widths.
Keyboard checks cover the skip link, dialog focus cycling, Escape and focus
restoration. Reduced-motion media behavior was checked in Chromium. Back
interception still depends on the Navigation API as documented in the frozen
dashboard handoff; this is not a cross-browser accessibility certification.

Tests ran against a byte-verified source snapshot under
`/tmp/loynara-owner-integration-20261001` because Desktop filesystem reads stalled.
Existing dependencies were reused with the identical lockfile. Databases and
email were local synthetic fixtures; the optional billing run used only the
existing loopback fixture and moved no money. Logs and scratch runners are
retained in the checkout's ignored `var/owner-integration/` directory.

Outside the dashboard UI/tests/docs and expected legacy-component removal, only
`src/lib/product.ts`, `src/lib/product.integration.test.ts`, and
`src/lib/onboarding-compat.integration.test.ts` changed for the authorized bridge.
There are no outstanding integration blockers. Deployment remains subject to
explicit approval; `railway-rc` and the frozen Claude branch remain unchanged.

## Frozen branch handoff (historical)

Branch `claude/owner-dashboard-v1`, base `5c51d992d18095211e169eeb9e5e9ebf8c565b8a`. Nothing is merged or pushed.
Frontend-only: no change to `src/lib`, `src/db`, `src/app/api`, migrations, Docker/deploy, package files, `globals.css`,
cashier or customer pages, or `src/components/loyalty-ui.tsx`.

## Conflict status today
`git merge-tree --write-tree railway-rc claude/owner-dashboard-v1` (railway-rc at `92db2ee`) merges cleanly. Since the base,
railway-rc changed only `PRODUCTION_DEPLOYMENT.md`, `PRODUCTION_RELEASE_TEST.md`, `V1_RELEASE_GATES.md`. Re-run the command after Gate 1.

## Slices in dependency order (cherry-pick in this order, do not squash)

### A – shell, navigation, overview
| SHA | Purpose | Depends on |
|---|---|---|
| `ddf8569` | scoped shell, five destinations, location switcher, unsaved-changes guard, overview (new/active), Geschäft settings | – |
| `4c6bde0` | heading weight, segmented wrapping, 1024px overflow fix | B1 CSS classes |

Files: `src/app/merchant/{layout,page}.tsx`, `src/app/merchant/settings/page.tsx`, `src/components/owner/{nav.ts,owner-context.tsx,owner-shell.tsx,owner-ui.tsx,owner.css,overview.tsx,join-card.tsx,card-preview.tsx,use-load.ts}`, `docs/owner-dashboard-v1.md`.
Expected conflicts: `src/app/merchant/page.tsx` (replaced) if Gate-1 work touches the old dashboard; `src/app/merchant/layout.tsx` is new.
Tests after pick: `tsc --noEmit`, `eslint src/components/owner src/app/merchant`, `vitest run src/components/owner/owner.test.ts` (needs slice B/C helpers, so run it after C), e2e `merchant-navigation`, `merchant-sign`, `merchant-sign-error`.

### B – programme, reward editor, card studio, setup wizard
| SHA | Purpose | Depends on |
|---|---|---|
| `b06dfba` | card studio (browser/Apple/Google previews), rule editor with worked example, reward editor, NFC policy card, programme page | A |
| `e841bb3` | four-step setup wizard with editable presets | A, `b06dfba` |

Files: `src/app/merchant/program/{page.tsx,card/page.tsx}`, `src/components/owner/{card-studio,program-*,tap-policy,wallet-previews}.tsx`, `program-helpers.ts`.
Expected conflicts: `src/app/merchant/program/page.tsx` (fully replaced; the old page also held the setup submit and NFC form). The wizard posts the unchanged onboarding payload.
Tests: e2e `merchant-setup`, `merchant-brand`, `merchant-program-browser`, `purchase-rewards` (API level).

### C – customers, campaigns, referrals summary, colour helpers, unit tests
| SHA | Purpose | Depends on |
|---|---|---|
| `05ae27b` | customers view | A |
| `4c42053` | goal-first three-step campaign builder | A (adds `timezone` to the location type in `owner-context.tsx`) |
| `30803a1` | referral summary, `color.ts`, 13 unit tests | B (`card-*` refactor) |
| `c92c48c` | e2e specs updated for A–C | A–C |
| `da6be7a` | further e2e specs adapted to the shell | A |

Expected conflicts: `src/app/merchant/{customers,campaigns,referrals}/page.tsx` and their `*.module.css` (later deleted in D); `e2e/merchant-*.spec.ts` if Codex edits those specs.
Tests: e2e `merchant-customers`, `merchant-campaigns`, `merchant-referrals`, `merchant-audiences`.

### D – remaining pages, Back guard, dead code, polish
| SHA | Purpose | Depends on |
|---|---|---|
| `5e26930` | docs: verification record | – |
| `7ab1c25` | audiences, automations, results, adviser, locations, team, billing (+fixture), referrals, CSV preview in the shared system | A–C |
| `383a7fb` | delete unused `RewardManager`, `MerchantBrandEditor` | B |
| `2f29edd` | browser Back guard (Navigation API) + `e2e/owner-dashboard.spec.ts` | A |
| `26edaab` | restrained polish pass | D1, B, C |

Expected conflicts: the seven legacy pages and their deleted CSS modules; `src/components/owner/owner.css` is one file shared by all slices, so cherry-pick in order.
Tests: full dashboard e2e list below.

### Trailing commits (apply last)
| SHA | Purpose | Depends on |
|---|---|---|
| `09747f8` | e2e: exact button names (`Zurück`, `Weiter`) so the goal shortcut "Kunden zurückholen" cannot be matched | `c92c48c` |
| `a375b79` (this doc set) | surface status, Back decision, integration plan, verification record | – |

## Dashboard e2e list (run against a warmed dev server, per spec with the local peer rate-limit reset used by `scripts/test-e2e-local.mjs`)
merchant-adviser, merchant-analytics, merchant-audiences, merchant-automations, merchant-billing, merchant-brand, merchant-campaigns, merchant-customers, merchant-locations, merchant-navigation, merchant-program-browser, merchant-referrals, merchant-setup, merchant-sign, merchant-sign-error, owner-dashboard, http-boundaries (team audit UI).

## Outside the diff but affected
`scripts/capture-merchant-screens.mjs` and `scripts/record-full-platform-demo.mjs` use old selectors (`.reward-manager-row`, old headings). They are demo tooling and were not changed here. `src/app/globals.css` still contains now-unused `.reward-manager*`, `.app-header*` and `.program-*` rules; removing them belongs to a separate cleanup that touches a shared file.
The e2e suite writes `screenshots/platform-after-*.png`; revert those tracked files after a run (`git checkout -- screenshots`).
