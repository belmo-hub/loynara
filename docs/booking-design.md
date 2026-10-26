# Loynara Termin – design doc (checkpoint 1)

2026-10-26. Branch `feat/booking` from `railway-rc` 7d344ec. **Design only, no production code.** Plan „Termin + Treue“ 69 €/month; loyalty-only stays 49 € (39 € founding, first ten shops).

**Stack correction.** The brief says Kotlin/Quarkus/Vue. The repository is Next.js 16 (route handlers in `src/app/api`), Drizzle on Postgres 18, Stripe (built, off in production), PassFast Apple Wallet, Google Wallet (pending), Web Push for cashier phones (VAPID live), one worker (`scripts/worker.ts`: outbox plus nightly message scans). Everything below is designed for that stack.

**Evidence.** `knowledge/pitch-log.csv` has a header and no rows: no field evidence about salons yet, so every decision is theory or product rule, labelled in §11. The four skills and the notes live on branch `knowledge/sales-psychology`, not on `railway-rc`.

**Two decisions left to me.** (a) Auto-confirm follows the preset: on for Barber, off for Nagelstudio and Kosmetik; the wizard shows the cost of each choice in one line and the owner can flip it. (b) Prices are always shown; a service may carry an „ab“ flag so nail studios need not lie about variable prices.

## 1. Who uses it and the one job each has

| Who | One job | Where |
|---|---|---|
| Customer | Book in under 60 s from the card; reschedule or cancel inside the rules; get reminded | `/card/<token>/termin`, same card token, no login |
| Owner / staff | See today, confirm, mark done or no-show, block time, keep services and hours current | `/merchant/termine` (day view, actions sheet), `/merchant/termine/einrichten` (wizard), cashier phone for „fertig“ |
| Loynara (worker) | Reminders 24 h and 2 h before; points on completion; rebooking push per service; honest numbers | outbox jobs plus the nightly scan next to win-back |

## 2. Entities and rules

All new tables, prefix `booking_`, every row scoped by `tenant_id` and `location_id` (test C9 pattern). No existing table is altered in slices 1–6; §12 lists the two one-line changes slice 7 needs.

| Entity | Fields beyond ids and timestamps | Rules |
|---|---|---|
| **Service** | name, duration_min (5–480, step 5), price_minor, price_from, buffer_min (0–60), rebook_after_days (0 = off; presets nails 21, hair 35, cosmetics 42), sort, archived_at | Archive, never delete. Buffer invisible to the customer. |
| **StaffMember** | name, user_id (nullable: staff without login), working_hours jsonb `[{weekday, start, end, breaks}]` in the location's timezone, archived_at | „Egal wer“ picks the first free. Archive refused while open appointments exist (§8). |
| **StaffService** | staff_id, service_id | Empty = offers all services. |
| **Appointment** | membership_id, service_id, staff_id, `during tstzrange` (start, end incl. buffer), status, customer_name (≤60), customer_phone (optional), source (card / staff), reschedule_count, cancelled_at, cancel_reason, done_ledger_entry_id, rebook_sent_at | requested → confirmed → done / no_show / cancelled_by_customer / cancelled_by_shop; requested may also end in the three end states. Each transition is one UPDATE with `WHERE status = <expected>`; a stale tap gets 409, never a second award. |
| **BlockedTime** | staff_id (nullable = whole shop), during, reason | Overlapping open appointments are listed to the owner, never cancelled silently. |
| **ShopBookingSettings** | one row per location: enabled, shop_type, lead_time_min (120), max_days_ahead (42), cancel_deadline_hours (24), max_reschedules_per_month (2), auto_confirm, no_show_block_after (3; 0 = never), max_open_per_card (2), terms_text | Written by the wizard; `enabled` only by the plan gate (slice 7). |
| **BlockedCustomer** | membership_id, blocked_at, blocked_by_user_id, reason | Manual or automatic after N no-shows in 12 months; lifted in one tap. Stamps keep working; the block touches booking only. |
| **CustomerPushSubscription** | membership_id, endpoint (unique), p256dh, auth, failure_count | Mirrors `staff_push_subscriptions`, same VAPID keys and `web-push` dependency; dropped after 3 failures or on card closure. |
| **PushLog** | membership_id, kind (reminder_24h / reminder_2h / rebook / shop_cancel), sent_at | Counted with `wallet_message_recipients` toward the per-customer cap (§5). |

Reminders and the rebook scan are `outbox_jobs` rows (`kind` is a free varchar there): no new queue.

## 3. Concurrency: no double booking, ever

1. `CREATE EXTENSION IF NOT EXISTS btree_gist` (contrib, trusted since Postgres 13, so no superuser; the repo's first extension, confirmed on Railway in slice 1).
2. On `booking_appointments`: `EXCLUDE USING gist (staff_id WITH =, during WITH &&) WHERE (status IN ('requested','confirmed'))`. Two open appointments of one staff member can never overlap, whatever the application does. Ranges are half-open `[start, end + buffer)`, so back-to-back slots touch without colliding.
3. A second constraint on `(membership_id WITH =, during WITH &&)` with the same predicate: one customer cannot hold two overlapping slots.
4. Blocked times live in another table, so the booking transaction checks them after `pg_advisory_xact_lock(hashtextextended('booking:' || location_id, 0))`, the pattern `lib/wallet-messages.ts` already uses per tenant. The lock serialises bookings and block creation per location; the constraints remain the backstop for any path that forgets it.
5. `23P01` maps to `409 SLOT_TAKEN` with the next free slot in the body: „Der Termin ist gerade weg. Nächster freier: 10:45“, one tap takes it.
6. Availability (hours − breaks − blocks − open appointments) is read-only and advisory; the insert is the truth. The integration test fires 50 concurrent inserts at one slot and asserts exactly one open row. Rescheduling is one UPDATE of `during` under the same constraints.

## 4. Time

Stored: `timestamptz` and `tstzrange` only (UTC instants). Wall-clock values exist in two places, `working_hours` and quiet hours, both read in `locations.timezone` (an existing column, `Europe/Berlin` everywhere). Slot generation walks calendar days in that zone and turns each wall time into an instant with `Intl.DateTimeFormat` parts, as `lib/happy-hour.ts` and the quiet-hours code do (both carry DST tests for 25 Oct 2026). Consequences: an appointment is the instant computed at booking, so „Dienstag 10:00“ stays 10:00 across a change; spring-forward's missing hour gets no slot, fall-back's repeated hour yields its first occurrence (no preset shop is open then; the test proves both); „24 h before“ is instant arithmetic, 23 or 25 wall hours on a DST night, which is right for a reminder; display always uses the location's zone, never the server's (Railway runs UTC).

## 5. Fusion with loyalty

- **Entry points.** „Termin buchen“ on the card (`components/card-client.tsx`, under the balance, hidden while booking is off) and a back-of-pass link with the same URL (one back field; the existing `wallet.refresh` job pushes it). The URL carries the card token: same identity, no login. Name and optional phone are asked once per booking and stored on the appointment, not the membership; the loyalty join stays consent-only (protected property).
- **Points on completion, never on booking.** „Fertig“ calls `awardInTransaction` (`lib/loyalty.ts`) inside the status update, `source: "staff_online"`, `idempotencyKey: "booking:" + id`: stamp programmes award 1, points programmes pre-fill the service price as the amount (cashier corrects, the euro lands in `purchase_awards` as confirmed). A double tap is a duplicate, not a second stamp. Reuse of the cashier flow: a customer with a confirmed appointment today (±90 min) who taps the plate or is scanned sees „Termin 10:00 · Haarschnitt“ on the confirm screen, and that confirmation marks the appointment done; whichever path runs first wins. Welcome, win-back, happy-hour and birthday bonuses apply unchanged because they hang on the award.
- **Rebooking push.** The nightly scan (next to `queueWinbackMessages`) finds cards whose last done appointment for a service is `rebook_after_days` old with no open appointment and sends one push, „Zeit für die nächsten Nägel? Dein Slot bei Lena: Termin buchen“, with a link that pre-selects service and staff. It is marketing: only with the opt-in recorded in `consent_events` (channel `push`, purpose `booking_rebook`), unticked by default, disclosed on the card. Caps are one counter across Wallet messages and push: 2 per 7 days per shop, 1 per day, quiet hours 21:00–08:00 (`lib/wallet-messages.ts` rules). A rebook push suppresses the generic win-back for that card for 14 days. Wallet-message delivery of the same text follows once PassFast v3 is unblocked (§12).
- **Reminders.** Two outbox jobs per confirmed appointment (24 h, 2 h), cancelled with it. Web Push where allowed; the pass is refreshed with „Nächster Termin: Di 10:00“ and a relevance date, which Apple shows on the lock screen without any message channel. Service messages: no marketing consent, not counted against the cap, but quiet hours hold (a 2 h reminder before 08:00 moves to 08:00 if still before the start, else is skipped). SMS and WhatsApp: later.
- **Dashboard** (existing „Ergebnisse“, euro section): today's appointments; „3 von 41 Terminen nicht erschienen, letzte 30 Tage“; „über Erinnerung neu gebucht“ = appointments from a rebook link within 14 days; „Umsatz aus Terminen deiner Loynara-Kunden: 1.240 € · nach Listenpreis, geschätzt“, with cashier-typed amounts shown separately as „an der Kasse bestätigt“. Never a word about what Loynara earned.

## 6. Owner control

Repeat no-shows are blocked automatically after N (default 3 in 12 months) or by hand from the actions sheet; the customer reads „Online-Buchung bei diesem Shop ist pausiert, ruf kurz an“. Reschedules are capped per month (default 2); the third becomes cancel-and-rebook inside the deadline. No commission, no per-booking fee, no Loynara branding on the confirmation beyond the card it lives on. CSV export of customers and appointments from the existing export page (`lib/export.ts` gets one more kind), reachable until contract end + 30 days; the list is the shop's. Prices, hours and staff change at any time and never touch booked appointments.

## 7. Out of scope this week

Online payments and deposits · waiting lists · group classes · multi-location calendars (each location sets up its own) · Google Calendar, Treatwell or Fresha sync · SMS and WhatsApp · AI campaign agent · customer accounts · recurring appointments · logins for calendar-only staff.

## 8. Edge cases, decided

| Case | Behaviour |
|---|---|
| Shop closes early | Owner adds a block; the sheet lists open appointments inside it; „Alle absagen“ sets cancelled_by_shop, sends one push each („Dein Termin Di 10:00 wurde abgesagt, neuen Termin wählen“, service message) and drops their reminders. Nothing is cancelled without that tap. |
| Staff member deleted with future bookings | Archive refused while open appointments exist; the wizard offers „verschieben“ (next free slot with another staff member, customer pushed) or „absagen“. Archived staff leave booking, stay in history. |
| Customer books twice | Different times: allowed up to `max_open_per_card`. Overlapping: refused by the membership constraint. Same slot twice (double tap): one appointment, idempotency key per attempt. |
| Overlapping a blocked time | Never offered; the insert re-checks under the location lock, `409 BLOCKED`. A later block follows the row above. |
| DST change night | §4; tests pinned on 25 Oct 2026 and 28 Mar 2027. |
| Customer without push permission | Booking works; the confirmation says „Erinnerung nur mit Mitteilungen“ with the browser prompt one tap away. iPhone Safari without Home-Screen install has no Web Push: the pass relevance date and „Meine Termine“ on the card are the channels. No email reminder (email not released). |
| Request never confirmed | Day-view badge plus cashier push 1 h before start; auto-cancel at start time with a customer push. |
| Cancel after the deadline | Still allowed (no dark pattern), counted as late cancellation, not no-show. |
| Card closed or recovered | Recovery keeps the membership and its appointments; closure blanks name and phone and cancels open ones by shop, no push. |

## 9. Compliance

The existing AVV gains „Terminbuchung“ as a purpose (Legal-Ops; name and phone are new categories, basis Art. 6 (1) (b)). EU hosting unchanged. Reminders and shop cancellations are service messages; the rebook push is marketing behind its own opt-in. Deadline, reschedule cap and no-show policy appear on the confirm screen above the button, with the owner's `terms_text`. Impressum and Datenschutz links in the flow footer. No payment data. `getCustomerExport` includes appointments.

## 10. Definition of done for the week

Setup from a preset in under 5 minutes (measured in rehearsal, never promised). Booking from the card in under 60 seconds, at most 4 taps. Reminders fire (worker test, frozen clock). Owner confirms, completes and marks no-show from the day view; completion awards exactly once; the plate tap completes too. Rebook push goes out after the interval with a working link. 50 concurrent bookings on one slot yield one appointment. Every screen passes the design bar's ten-minute and ux-review's fifteen-minute protocols with findings fixed. All existing tests pass; no existing table altered before the founder's yes. Not solid by Saturday night: Monday is loyalty only.

## 11. Skill trace

| Decision | Source | Note |
|---|---|---|
| Points on completion through the existing confirm, nothing to decide at the counter | loyalty-psychology §1; ux-review §2 item 6 | |
| Rebook push per service interval, one tap, no pile-up with win-back | loyalty-psychology §2 (order, caps, quiet hours); eyal-hooked (monthly trades are reminders, not habits) | 21/35/42 days are trade knowledge; no note gives them. Measure. |
| Reminders as neutral service messages, no urgency wording | loyalty-psychology §2 wording; coleman-first-100-days (acclimate: say what comes next) | 24 h / 2 h timing is from the brief. |
| Rebook push behind an unticked opt-in; reminders without it | loyalty-psychology §2 consent rule (ENG-043/044) | |
| „Nächster Termin“ under the balance, button below | ux-review §3; design bar §3 customer card | |
| Wizard asks the owner's goal first, shows it on the day view | coleman-first-100-days (accomplish); ux-review §4 item 8 | |
| Presets with auto-confirm default and its cost in one line | ux-review §4 item 5 | Which shops want manual confirm: no note; founder's guess, log it. |
| Prices always shown, „ab“ flag | General knowledge; website-conversion not read for this checkpoint | |
| Euros „nach Listenpreis, geschätzt“, confirmed sums separate | ux-review §4 item 2; loyalty-psychology §4; existing analytics copy | |
| No-show block and reschedule cap, customer told plainly | No skill covers it; brief §6; Sharp (benefits never withdrawn silently) | |
| Cancel after deadline allowed, counted honestly | loyalty-psychology honesty rule; brief „no dark patterns“ | |
| Ability over motivation: one tap, no login, name once | eyal-hooked relaying Fogg second-hand; there is no Fogg note | |
| Exclusion constraint, tenant scoping, idempotency, outbox reuse | loynara-engineering-bar §1–2 | |
| Grey ground, forest green, Manrope, dark cashier, du, 44 pt | loynara-design-bar §1 | Checkpoint 3. |

## 12. Needs the founder's yes

1. Slice 1: `CREATE EXTENSION btree_gist` in migration 0042 (trusted, no superuser).
2. Slice 7: `billing_location_plans.plan_code` CHECK gains `'termin_treue'`; `wallet_messages.kind` CHECK gains `'rebook'`. Two one-line edits on existing tables; without the second, rebook stays Web Push and card banner, fine for Monday.
3. This worktree sits under `~/Desktop` (iCloud); the engineering bar says `~/Developer`. Slice 1 onward should move there.
