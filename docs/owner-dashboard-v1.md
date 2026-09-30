# Owner dashboard v1 – implementation note (design branch)

Branch `claude/owner-dashboard-v1`, base `5c51d992d18095211e169eeb9e5e9ebf8c565b8a`. Presentation layer only.

## Navigation (5 destinations, max. 2 levels, no URL removed)
| Destination | Sub-pages (existing URL) |
|---|---|
| Übersicht | `/merchant` |
| Treueprogramm | Sammelregeln & Prämien `/merchant/program`, Kundenkarte `/merchant/program/card`, Empfehlungen `/merchant/referrals` |
| Kunden | Kundenkarten `/merchant/customers`, Zielgruppen `/merchant/audiences` |
| Aktionen | Kampagnen `/merchant/campaigns`, Automationen `/merchant/automations`, Ergebnisse `/merchant/analytics`, Beratung `/merchant/adviser` |
| Einstellungen | Geschäft `/merchant/settings`, Standorte `/merchant/locations`, Team `/merchant/staff`, Abrechnung `/merchant/billing` |

"Kasse öffnen" is a separate utility link to `/cashier`. Managers see only what the existing API allows them to use.

## First five workflows
1. New merchant: Overview checklist → programme setup → first reward → card → test stamp.
2. Change the card (name, colour, logo) with live browser/Apple/Google previews from one draft.
3. Edit a reward and see the effect before saving.
4. Find customers inactive for 30 days → open a prepared campaign draft.
5. Switch location without mixed data or lost/misapplied edits.

## Editable areas
`src/app/merchant/**` page composition, `src/components/owner/**`, `owner.css` (scoped under `.owner-app`), presentation helpers, frontend tests. Nothing under `src/lib`, `src/db`, `src/app/api`, migrations, Docker/deploy, cashier/customer pages, or `globals.css`.

## Backend gaps (recorded, not built)
- No persisted reward value/cost fields (economics helper is temporary, never shown as saved).
- Logo is not rendered on the browser card or the Apple pass generator.
- No draft/activation state for a programme; onboarding activates immediately.
- No persisted "setup step tested" flag – the checklist derives it from real awards.
- Analytics is owner-only; audience previews owner/manager; no all-locations aggregate metrics.
- Billing is fixture-only; there is no integrations status endpoint.
