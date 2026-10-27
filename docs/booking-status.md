# Loynara Termin – slice status notes

Local run for every slice: start the throwaway cluster (`pg_ctl -D <scratch>/pg/data -o "-p 54433" start`), then
`DATABASE_URL=postgresql://looplocal:looplocal_local_only@127.0.0.1:54433/looplocal_test BETTER_AUTH_SECRET=<32+> BETTER_AUTH_URL=http://localhost:3000 PUBLIC_BASE_URL=http://localhost:3000 BILLING_FIXTURE_MODE=true BILLING_FIXTURE_SECRET=<32+> npx drizzle-kit migrate && npx vitest run src/lib/booking`.
Dev server: `.claude/launch.json` entry `loynara-booking` (port 3090, database `looplocal_dev` on the same cluster).

## Slice 1 – schema, availability engine, double-booking guard (2026-10-27)
- Works: migration 0042 (nine `booking_*` tables, btree_gist, two EXCLUDE constraints), availability engine, presets, 14 routes (5 customer, 9 owner), 41 tests incl. 50 concurrent bookings → one row, DST on 25 Oct 2026, points awarded once on „Fertig“, tenancy.
- Not yet: no UI, no push/consent/export routes, `booking_settings.enabled` is only set by slice 7's operator toggle, the monthly reschedule limit is approximated from `updated_at` (shortcut comment in appointments.ts).
- Run: see the command above; the full suite was not run in this slice.
- Next: slices 2 (wizard), 3 (customer flow), 4 (day view + cashier fusion), 6 (dashboard + export) in parallel.

## Slice 2 – owner setup wizard (88a28da)
- Works: /merchant/termine/einrichten, five steps with presets, goal text, services, hours, team, rules with the cost line per choice; saves and reloads; nav group „Termine“ (Heute, Einrichten); 409 when a person with open appointments is removed.
- Not yet: the stepper chips wrap to three rows at 390 px (existing component); shop hours are stored per person only.
- Run: `npx vitest run src/components/owner/booking-setup-helpers.test.ts src/components/owner/nav.test.ts`; dev server via launch config `loynara-booking`, then Einrichten.
- Next: slice 4 (day view) consumed the same nav group.

## Slice 3 – customer booking flow (270001e)
- Works: /card/<token>/termin, service → day → time → book in four taps at 390 px, name remembered on the device, terms and deadline before the button, SLOT_TAKEN offers the next free time, reschedule and cancel with honest late-cancel wording, „Nächster Termin“ on the card; e2e spec passes.
- Not yet: slots window is 14 days (shop allows 42); no shop brand colour on the booking page; Impressum links shown twice (fixed in slice 5).
- Run: start the dev server (`--webpack`, see launch config), then `E2E_BASE_URL=http://localhost:3090 npx playwright test e2e/booking-customer.spec.ts --project=desktop-chrome`.
- Next: slice 5 adds the reminder toggle to the success screen.

## Slice 4 – owner day view and cashier fusion (d0ae333)
- Works: /merchant/termine with requests, blocks, rows in the shop's zone; sheet with confirm, done (amount prefilled for points shops), no-show, cancel with reason, move, block/unblock card; „Zeit blocken“ lists affected appointments and needs an explicit „Alle absagen“; a counter award or plate tap completes the matching appointment with that ledger entry, the owner's later Fertig is STALE; 147 tests green incl. cashier and NFC suites.
- Not yet: the cashier line shows the phone's time zone (fixed in slice 5); move offers the same staff member only.
- Run: `npx vitest run src/lib/booking src/components/owner/booking-day-model.test.ts`.
- Next: slice 5 pushes shop cancellations and moves to the customer.

## Slice 6 – dashboard figures and export (4187a1f)
- Works: Ergebnisse euro section gains „Termine“ (heute, nächste 7 Tage, Ausfälle, Umsatz nach Listenpreis geschätzt, an der Kasse bestätigt, über Erinnerung neu gebucht); CSV „Termine für Excel“ on the settings page; the customer's own export lists their appointments.
- Not yet: the 30-day window is fixed whatever period the page shows; the JSON merchant export has no appointments.
- Run: `npx vitest run src/lib/booking/dashboard-export src/lib/merchant-analytics src/lib/merchant-csv-export`.

## Slice 7 – plan gate (8e06162)
- Works: operator console switch „Termin + Treue“ per location writes booking_settings.enabled; owner billing page shows the plan line when on; customer GET /booking flips accordingly.
- Not yet: charging stays on the stored plan; the plan-code CHECK and Stripe are untouched (founder's decision); the marketing site's plan card and salon page are behind `bookingLive` (off) in marketing-site/src/claims.ts.
- Run: `npx vitest run src/lib/operator-booking`.

## Slice 8 – demo salon (a808494)
- Works: `npm run seed:booking-demo` creates Nagelstudio Lumi with two staff, the preset, ~30 cards and a week of appointments in every status; prints owner login, a customer card with an upcoming appointment and the day-view URL; `docs/booking-pitch-addendum.md` holds the salon pitch text.
- Not yet: re-running skips (fresh week needs a fresh database); seed after 10:00 on pitch day so this morning's done appointments lie in the past.
- Run: with the dev DATABASE_URL, `npm run seed:booking-demo`, then open the printed URLs on the dev server.

## Slice 5 – reminders and rebooking push (fcd09bd)
- Works: two outbox jobs per confirmed appointment (24 h, 2 h) with quiet hours 21:00–08:00, no-ops after move or cancel; shop cancellations and moves push a notice; nightly rebook scan per service interval, only with the card's own opt-in, inside the 2-per-7-days cap shared with Wallet messages; service worker, „Erinnerungen aktivieren“ and the opt-in on the booking page; iPhone without Home-Screen install gets the hint; rebook link pre-selects service and staff.
- Not yet: no Wallet pass field or Wallet message (PassFast blocked); the generic win-back is not suppressed after a rebook push (the cap limits it); a real device subscribe was not exercised (headless Chrome cannot).
- Run: `npx vitest run src/lib/booking/notify.integration.test.ts`; the worker (`npm run worker`) needs the VAPID trio, otherwise jobs complete as suppressed.
- Next: founder decisions (CHECK edits, Wallet kind), then merge.

## Review 2026-10-27 – independent code and security review of the branch
- Four read-only reviewer agents (engine and data; routes, push and worker; UI, seed and e2e; security). Security: no high-confidence findings. Code: 42 candidates, 27 fixed in one commit, the rest left open on purpose (below).
- Fixed: a customer cannot cancel after the start (TOO_LATE; the shop decides done or no-show); card closure forgets push devices, releases open appointments and erases the booking name and phone; a purchase programme credits only the amount the team typed (no list-price default; 0 € or too little = done without a credit); the cashier award window is 30 min before the start to 90 min after the booked end, shared with the tap list; the rebook cap counts uncertain Wallet sends as Wallet does; the monthly move limit counts the moves of that month (`rescheduled_at` log, migration 0043, plus a unique index on the done ledger entry); the move option is hidden when the shop allows 0 online moves; a move sees its own time as free and keeps the booked staff member; OWN_OVERLAP instead of SLOT_TAKEN when a card overlaps itself; the day view takes the shop's today from the server and shows an error with retry when the set-up read fails; push: a second device can join, device-in-use and not-configured have their own lines, and the card pages carry a per-card manifest so the iPhone Home-Screen path can work; German error lines instead of server text; honest copy (default terms, deadline 0, billing line without the 69 €, export hint, dashboard label „Listenpreise erledigter Termine … geschätzt, nicht kassiert“); older reminder jobs are suppressed on a move; booking reads have their own rate buckets; merchant booking routes carry the neighbours' limits; a staff row may link only to a login of this shop.
- Open on purpose: owner „Fertig“ followed by a cashier stamp still credits twice (today's double-stamp risk; needs a product rule); the customer export keeps its scope label although appointments carry name and phone (changing it touches the download validator and three e2e specs); `bookingStaffScope` runs getMerchantContext's dashboard counts on every call; the rebook scan re-runs its candidate query per claim (≤ 500 per 5 min); no e2e for move, the owner UI or a same-tenant second location.
- Run: `npx vitest run src/lib/booking src/lib/card-lifecycle.integration.test.ts scripts/migration-upgrade.test.ts` (34 files, 384 tests green), `npx tsc --noEmit`, e2e as in slice 3; apply migration 0043 to local databases first.
- Next: the founder's decisions (push and PR, CHECK edits, bookingLive) are unchanged.

## Review round 2 2026-10-27 – same four reviewer roles, fresh agents, fix commit first
- Security: no high-confidence findings in the fix commit or on the five main surfaces. Code: 34 candidates, 27 fixed, 7 left open.
- Fixed regressions from round 1: the done screen and „Meine Termine“ no longer call every cancel late or say „Verschieben ging bis“ when a shop allows no online moves; the push panel stays on the booking page once subscribed, so „ausschalten“ and the rebook opt-out are always reachable; each card registers its own service-worker scope, so two cards on one phone keep separate reminders; the slot retry during a move keeps the appointment id; „Fertig“ works at 0 € (done without a credit, as the server allows).
- Fixed new findings: quiet hours are re-checked at send time (reminder dropped, shop change and rebook wait for 08:00); the rebook push goes out only where the card can still book (booking on, programme active, card open and not paused, service live); a closed card releases only appointments not yet started, and the shop's „Fertig“ completes a started one without a credit; a no-op shop move sends nothing and the move text names the staff member; a deactivated login never blocks a set-up save; „neu gebucht“ no longer counts cancelled rebooks; noindex and no-store cover every card URL; the customer export's scope label now says it carries the booking name and phone; the card manifest has icons (Loynara mark); the rebook link counts only for its own service; the day view keeps the shop's zone during reloads; the confirm step no longer repeats rules the shop's terms already state.
- Tests added or hardened: month limit anchored on a real-month touch, reminder suppression asserted, quiet-hours retry, rebook gates, closed-card finish, staff-login check, done-entry unique index, slots route with appointment id, manifest route, e2e move step.
- Open on purpose: `rebookPushesWithin` counts a queued rebook before it is sent (over-cautious by at most one message); a booking that reads the card in the same instant as its closure can land on the closed card (needs a row lock in cardScope); a purchase shop completes without a credit when the merchant context is missing; saved default terms freeze at the wording of their save (no shop has saved yet); no component tests for the client fixes.
