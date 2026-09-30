# Owner dashboard – integration plan for Codex (after Gate 1)

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

## Dashboard e2e list (run against a warmed dev server, per spec with the local peer rate-limit reset used by `scripts/test-e2e-local.mjs`)
merchant-adviser, merchant-analytics, merchant-audiences, merchant-automations, merchant-billing, merchant-brand, merchant-campaigns, merchant-customers, merchant-locations, merchant-navigation, merchant-program-browser, merchant-referrals, merchant-setup, merchant-sign, merchant-sign-error, owner-dashboard, http-boundaries (team audit UI).

## Outside the diff but affected
`scripts/capture-merchant-screens.mjs` and `scripts/record-full-platform-demo.mjs` use old selectors (`.reward-manager-row`, old headings). They are demo tooling and were not changed here. `src/app/globals.css` still contains now-unused `.reward-manager*`, `.app-header*` and `.program-*` rules; removing them belongs to a separate cleanup that touches a shared file.
The e2e suite writes `screenshots/platform-after-*.png`; revert those tracked files after a run (`git checkout -- screenshots`).
