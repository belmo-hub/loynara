# Owner dashboard v1 – design and status note

Branch `claude/owner-dashboard-v1`, base `5c51d992d18095211e169eeb9e5e9ebf8c565b8a`. Presentation layer only.
Integration plan: `docs/owner-dashboard-integration.md`.

## Navigation (5 destinations, max. 2 levels, no URL removed)
| Destination | Sub-pages (existing URL) |
|---|---|
| Übersicht | `/merchant` |
| Treueprogramm | Sammelregeln & Prämien `/merchant/program`, Kundenkarte `/merchant/program/card`, Empfehlungen `/merchant/referrals` |
| Kunden | Kundenkarten `/merchant/customers`, Zielgruppen `/merchant/audiences` |
| Aktionen | Kampagnen `/merchant/campaigns`, Automationen `/merchant/automations`, Ergebnisse `/merchant/analytics`, Beratung `/merchant/adviser` |
| Einstellungen | Geschäft `/merchant/settings`, Standorte `/merchant/locations`, Team `/merchant/staff`, Abrechnung `/merchant/billing` |

"Kasse öffnen" is a separate utility link to `/cashier`. Managers see only what the existing API lets them use.

## Surface status: SUPPORTED / LIMITED / BACKEND_BLOCKED
| Surface | Status | Note (what the UI says about it) |
|---|---|---|
| Shell, navigation, location switch, unsaved-changes guard | SUPPORTED | Back is guarded only where the Navigation API exists (see below). |
| Overview – per-location numbers, next actions | SUPPORTED | Audience counts are programme-scoped. |
| Overview – 30/90 day metrics | LIMITED | Analytics is tenant-wide, so period metrics show only for single-location owners; multi-location owners are pointed to Ergebnisse. |
| Setup wizard | LIMITED | Onboarding activates the programme immediately (no draft/activation state). The review step says the programme starts on saving. |
| Rule editor and worked example | SUPPORTED | Uses `src/lib/points.ts`; states that balances are not recalculated. |
| Reward editor | SUPPORTED | Value/cost is BACKEND_BLOCKED: the cost helper is labelled "wird nicht gespeichert". |
| NFC policy | SUPPORTED | Policy only; tag provisioning is separate and stated. |
| Card studio | SUPPORTED for name/colour/logo | Logo on browser card and Apple pass is BACKEND_BLOCKED (studio says so); Google needs PNG + approved asset origin (LIMITED). Apple contrast warning because the generator uses white text. |
| Customers | LIMITED | List is tenant-wide and exposes only a location name; the view narrows by name only when unique and otherwise says it shows all locations. |
| Audiences | SUPPORTED | |
| Campaign builder | SUPPORTED | Scheduling is accepted by the API even when the channel is disabled (BACKEND_BLOCKED): the review step shows the channel state and the "gesonderte Freigabe" warning. Preview needs promotional limit env vars; without them the API answers "Internal error" and the UI shows that message with a retry. |
| Automations | SUPPORTED | |
| Ergebnisse, Beratung | LIMITED | Tenant-wide; both pages say "alle Standorte zusammen". |
| Referrals | SUPPORTED | Owner only. |
| Locations, Team | SUPPORTED | Team invites apply to the active location and say so. |
| Billing | BACKEND_BLOCKED | Fixture only; page states there is no live payment, tax or invoice. |
| Integrations page | BACKEND_BLOCKED | No status endpoint; not built. |
| `/api/me` without merchant | Backend quirk | Returns 200 without a location; the shell treats that as "no merchant yet". |

## Browser Back decision
Next's router has no supported way to veto a history traversal (its popstate handler dispatches the traversal itself; the docs
only cover `Link onNavigate`). A sentinel-`pushState` trick would fight Next's own history bookkeeping, so it was not used.
Implemented instead: where `window.navigation` exists (Chromium), a cancelable `traverse` event is intercepted only while edits are
unsaved and the same confirm dialog is shown; confirming traverses to the requested entry. Verified in Chrome. Other browsers
have no Back guard; in-app navigation, location switching, reload and tab close are guarded everywhere.

## Frontend code removed / retained
Removed: `RewardManager`, `MerchantBrandEditor` (+ CSS module), and the per-page CSS modules of the converted pages.
Retained on purpose: `MerchantSetupView`, `MerchantDashboardView`, `AppHeader`, `MetricCard` inside `src/components/loyalty-ui.tsx`
(unused by the merchant area, but the file is shared with cashier and customer views; deleting from it raises conflict risk with
Gate-1 work), and `.reward-manager*`/`.app-header*` rules in `globals.css` (shared file).

## Known limits
- Legacy demo scripts (`scripts/capture-merchant-screens.mjs`, `scripts/record-full-platform-demo.mjs`) use old selectors.
- Dev-server e2e needs warm route compilation (see classification below).

## Verification record (local, synthetic data only)
- `tsc --noEmit`, scoped ESLint (`src`, `e2e`), 13 presentation unit tests, isolated `next build --webpack` (separate dist dir): pass.
- Dashboard e2e (17 spec files, 21 tests incl. `owner-dashboard`): all green in one controlled run against the isolated dev server and
  disposable database, with a per-spec reset of the local peer rate-limit rows (as `scripts/test-e2e-local.mjs` does per shard) and
  generous Playwright timeouts for on-demand compilation. The config lives outside the repo (`.review/`, git-excluded). This is NOT a
  full project e2e pass; unrelated provider/cashier/customer specs are classified below.
- Failure classification of earlier runs:
  - APPLICATION_REGRESSION: none found by e2e. Real bugs were found by walkthroughs and screenshots (two-column layouts not stacking
    on phones, fixed).
  - TEST_FIXTURE_CONFIG: specs asserting the old markup (updated); `getByRole("button", { name: "Zurück" })` also matched the
    "Kunden zurückholen" goal button when the page was slow (fixed with `exact: true`); strict-mode duplicates of business/location
    names now shown in the shell (scoped to `main`).
  - RATE_LIMIT_TEST_INTERFERENCE: sign-up specs against a production build hit Better Auth's built-in production limiter (429);
    dev mode has it off. Not loosened; production-build e2e was therefore not used for sign-up based specs.
  - DISABLED_PROVIDER_EXPECTATION: the campaign scheduling step expects the local Mailpit channel, which a production build disables.
  - COLD_SERVER_TIMEOUT: dev-server compile on first request (worst under machine load from iCloud daemons); `local-journey`,
    `merchant-referrals`, `merchant-automations` failed once each on timeouts and passed on warm reruns.
- Overflow at 1440×900, 1024×768, 390×844, 360×800 for 14 merchant pages, active and new merchant; 200 % and 300 % zoom; reduced
  motion; keyboard (skip link, dialog focus trap and restore, Escape keeps edits).
- Walkthroughs A (new merchant), C (rule edit), D (reward edit), E (card studio), H (mobile) scripted; B covered by the campaign e2e;
  F (location switch with unsaved form) and G (simulated failed save) covered by `owner-dashboard` e2e.
