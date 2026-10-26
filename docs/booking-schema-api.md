# Loynara Termin – schema, API, state machine, test plan (checkpoint 2)

Companion to `booking-design.md`. This is the contract for the build slices: a slice that needs something not listed here adds it here first, in one line. Branch `feat/booking`.

## 1. Migration `0042_booking.sql` (new tables only)

Generated with `npx drizzle-kit generate --name booking` from the new tables appended to `src/db/schema.ts`, then the extension line is put first and the two EXCLUDE constraints appended by hand (Drizzle cannot express them). Forward-only, one transaction, 15 s lock timeout as every migration. Rollback note: old code never reads these tables; dropping them loses appointments only.

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
CREATE TABLE "booking_settings" (
  "tenant_id" uuid NOT NULL, "location_id" uuid NOT NULL,
  "enabled" boolean NOT NULL DEFAULT false,
  "shop_type" varchar(12) NOT NULL DEFAULT 'barber',
  "goal_text" varchar(140) NOT NULL DEFAULT '',
  "lead_time_min" integer NOT NULL DEFAULT 120,
  "max_days_ahead" integer NOT NULL DEFAULT 42,
  "cancel_deadline_hours" integer NOT NULL DEFAULT 24,
  "max_reschedules_per_month" integer NOT NULL DEFAULT 2,
  "auto_confirm" boolean NOT NULL DEFAULT true,
  "no_show_block_after" integer NOT NULL DEFAULT 3,
  "max_open_per_card" integer NOT NULL DEFAULT 2,
  "terms_text" varchar(600) NOT NULL DEFAULT '',
  "setup_done_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("tenant_id","location_id"),
  FOREIGN KEY ("tenant_id","location_id") REFERENCES "locations"("tenant_id","id"),
  CONSTRAINT "booking_settings_valid" CHECK ("shop_type" in ('nagelstudio','barber','kosmetik') and "lead_time_min" between 0 and 1440 and "max_days_ahead" between 1 and 180 and "cancel_deadline_hours" between 0 and 168 and "max_reschedules_per_month" between 0 and 10 and "no_show_block_after" between 0 and 10 and "max_open_per_card" between 1 and 5)
);--> statement-breakpoint
CREATE TABLE "booking_services" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "location_id" uuid NOT NULL,
  "name" varchar(80) NOT NULL, "duration_min" integer NOT NULL, "buffer_min" integer NOT NULL DEFAULT 0,
  "price_minor" integer NOT NULL, "price_from" boolean NOT NULL DEFAULT false,
  "rebook_after_days" integer NOT NULL DEFAULT 0, "sort" integer NOT NULL DEFAULT 0,
  "archived_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id","id"), FOREIGN KEY ("tenant_id","location_id") REFERENCES "locations"("tenant_id","id"),
  CONSTRAINT "booking_service_valid" CHECK ("duration_min" between 5 and 480 and "duration_min" % 5 = 0 and "buffer_min" between 0 and 60 and "price_minor" between 0 and 100000 and "rebook_after_days" between 0 and 365)
);--> statement-breakpoint
CREATE TABLE "booking_staff" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "location_id" uuid NOT NULL,
  "name" varchar(60) NOT NULL, "user_id" text,
  "working_hours" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "sort" integer NOT NULL DEFAULT 0, "archived_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id","id"), FOREIGN KEY ("tenant_id","location_id") REFERENCES "locations"("tenant_id","id")
);--> statement-breakpoint
CREATE TABLE "booking_staff_services" (
  "tenant_id" uuid NOT NULL, "staff_id" uuid NOT NULL, "service_id" uuid NOT NULL,
  PRIMARY KEY ("staff_id","service_id"),
  FOREIGN KEY ("tenant_id","staff_id") REFERENCES "booking_staff"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","service_id") REFERENCES "booking_services"("tenant_id","id")
);--> statement-breakpoint
CREATE TABLE "booking_blocks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "location_id" uuid NOT NULL,
  "staff_id" uuid, "during" tstzrange NOT NULL, "reason" varchar(80) NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("tenant_id","location_id") REFERENCES "locations"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","staff_id") REFERENCES "booking_staff"("tenant_id","id"),
  CONSTRAINT "booking_block_bounded" CHECK (lower_inc("during") and not upper_inc("during") and not lower_inf("during") and not upper_inf("during"))
);--> statement-breakpoint
CREATE TABLE "booking_appointments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "location_id" uuid NOT NULL,
  "membership_id" uuid NOT NULL, "service_id" uuid NOT NULL, "staff_id" uuid NOT NULL,
  "during" tstzrange NOT NULL, "duration_min" integer NOT NULL, "price_minor" integer NOT NULL,
  "status" varchar(24) NOT NULL DEFAULT 'requested',
  "customer_name" varchar(60) NOT NULL, "customer_phone" varchar(30),
  "idempotency_key" varchar(100) NOT NULL,
  "reschedule_count" integer NOT NULL DEFAULT 0,
  "late_cancel" boolean NOT NULL DEFAULT false,
  "cancelled_at" timestamptz, "cancel_reason" varchar(80),
  "done_ledger_entry_id" uuid,
  "rebook_sent_at" timestamptz, "rebook_source_id" uuid,
  "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("tenant_id","id"), UNIQUE ("tenant_id","idempotency_key"),
  FOREIGN KEY ("tenant_id","location_id") REFERENCES "locations"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","service_id") REFERENCES "booking_services"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","staff_id") REFERENCES "booking_staff"("tenant_id","id"),
  FOREIGN KEY ("tenant_id","done_ledger_entry_id") REFERENCES "ledger_entries"("tenant_id","id"),
  CONSTRAINT "booking_appointment_status_valid" CHECK ("status" in ('requested','confirmed','done','no_show','cancelled_by_customer','cancelled_by_shop')),
  CONSTRAINT "booking_appointment_bounded" CHECK (lower_inc("during") and not upper_inc("during") and not lower_inf("during") and not upper_inf("during")),
  CONSTRAINT "booking_appointment_done_entry" CHECK (("status" = 'done') or "done_ledger_entry_id" is null),
  CONSTRAINT "booking_appointment_cancel_valid" CHECK (("status" like 'cancelled_%') = ("cancelled_at" is not null)),
  CONSTRAINT "booking_staff_no_overlap" EXCLUDE USING gist ("staff_id" WITH =, "during" WITH &&) WHERE ("status" in ('requested','confirmed')),
  CONSTRAINT "booking_member_no_overlap" EXCLUDE USING gist ("membership_id" WITH =, "during" WITH &&) WHERE ("status" in ('requested','confirmed'))
);--> statement-breakpoint
CREATE INDEX "booking_appointments_day_idx" ON "booking_appointments" USING gist ("tenant_id","location_id","during");--> statement-breakpoint
CREATE INDEX "booking_appointments_member_idx" ON "booking_appointments" ("tenant_id","membership_id","created_at");--> statement-breakpoint
CREATE INDEX "booking_blocks_location_idx" ON "booking_blocks" USING gist ("tenant_id","location_id","during");--> statement-breakpoint
CREATE TABLE "booking_blocked_customers" (
  "tenant_id" uuid NOT NULL, "membership_id" uuid NOT NULL, "blocked_at" timestamptz NOT NULL DEFAULT now(),
  "blocked_by_user_id" text, "reason" varchar(80) NOT NULL DEFAULT '',
  PRIMARY KEY ("tenant_id","membership_id"), FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id")
);--> statement-breakpoint
CREATE TABLE "booking_push_subscriptions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "membership_id" uuid NOT NULL,
  "endpoint" text NOT NULL UNIQUE, "p256dh" varchar(100) NOT NULL, "auth" varchar(40) NOT NULL,
  "failure_count" integer NOT NULL DEFAULT 0, "last_success_at" timestamptz, "created_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id"),
  CONSTRAINT "booking_push_endpoint_https" CHECK ("endpoint" like 'https://%')
);--> statement-breakpoint
CREATE INDEX "booking_push_member_idx" ON "booking_push_subscriptions" ("tenant_id","membership_id");--> statement-breakpoint
CREATE TABLE "booking_push_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "membership_id" uuid NOT NULL,
  "appointment_id" uuid, "kind" varchar(16) NOT NULL, "sent_at" timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY ("tenant_id","membership_id") REFERENCES "memberships"("tenant_id","id"),
  CONSTRAINT "booking_push_kind_valid" CHECK ("kind" in ('reminder_24h','reminder_2h','rebook','shop_cancel','moved')),
  UNIQUE ("appointment_id","kind")
);--> statement-breakpoint
CREATE INDEX "booking_push_log_member_idx" ON "booking_push_log" ("tenant_id","membership_id","sent_at");
```

Notes. `during` = `[start, start + duration_min + buffer_min)`; the customer sees `start` and `duration_min` only. `price_minor` and `duration_min` are copied from the service at booking so later edits never change a booked appointment. `working_hours` shape: `[{ "weekday": 1, "start": "09:00", "end": "18:00", "breaks": [{ "start": "12:30", "end": "13:00" }] }]`, weekday 1 = Monday … 7 = Sunday, wall clock in `locations.timezone`. `staff.user_id` is informational (no FK, auth tables live outside the schema). Consent for the rebook push is a `consent_events` row (channel `push`, purpose `booking_rebook`, source `card`), no new table. Reminders and rebook pushes are `outbox_jobs` of kind `booking.reminder` (payload `appointmentId`, `which`) and `booking.rebook` (payload `appointmentId`).

## 2. Library layout

| File | Holds |
|---|---|
| `src/lib/booking/time.ts` | `wallToInstant(date, "HH:MM", tz)` (DST-gap aware, returns null in the missing hour, first occurrence in the repeated one), `instantToWall(instant, tz)`, `berlinDay(instant, tz)`; reuses the `Intl` pattern of `happy-hour.ts`. |
| `src/lib/booking/availability.ts` | Pure: `slots({ days, service, staff[], blocks[], appointments[], settings, now, tz })` → `{ date, slots: [{ start, staffId }] }[]`, 15-minute grid, union over staff for „Egal wer“ (first staff in `sort` order wins a tie). No I/O. |
| `src/lib/booking/setup.ts` | Settings, services, staff: `getSetup`, `saveSetup` (upsert by id, archive the missing, refuse archiving staff with open appointments), presets. |
| `src/lib/booking/appointments.ts` | `book`, `reschedule`, `cancelByCustomer`, `transition` (owner), `move`, `createBlock`, `cancelAffected`, `blockCustomer`, `unblockCustomer`, `dayView`, `cardView`. Every write: one transaction, `pg_advisory_xact_lock(hashtextextended('booking:' || location_id, 0))`, `23P01` → `DomainError("SLOT_TAKEN")`. |
| `src/lib/booking/notify.ts` | Slice 5: `scheduleReminders`, `deliverReminder`, `queueRebookPushes`, `sendCustomerPush`, `saveCustomerPushSubscription`. |
| `src/lib/booking/presets.ts` | Nagelstudio / Barber / Kosmetik: services with durations, prices, rebook days; default hours; auto-confirm default. |

## 3. REST endpoints

All JSON, `Cache-Control: no-store`, errors through `respondError` (`{ error: { code, message } }`). Customer routes identify by the card token (same rate-limit scopes as the card: `enforcePeerLimit` + `enforceRateLimit`). Owner routes: `requireSameOrigin`, `sessionUser`, `getMerchantContext` (owner or manager; cashier gets 403 except the two cashier routes), location from the selection cookie.

### Customer (`/api/card/[token]/booking…`)

| Method, path | Body → response |
|---|---|
| `GET …/booking` | → `{ enabled, blocked, shop: { name, timezone, termsText, cancelDeadlineHours, maxReschedulesPerMonth, autoConfirm }, services: [{ id, name, durationMin, priceMinor, priceFrom }], staff: [{ id, name, serviceIds }], upcoming: [Appointment], past: [Appointment ≤ 5], push: { publicKey?, subscribed, rebookConsent } }` |
| `GET …/booking/slots?serviceId=&staffId=&from=YYYY-MM-DD&days=7` | → `{ days: [{ date, slots: [{ start, staffId }] }] }` (`staffId` omitted = any; `days` ≤ 14) |
| `POST …/booking/appointments` | `{ serviceId, staffId?, start, customerName, customerPhone?, idempotencyKey }` → `201 Appointment`; `409 SLOT_TAKEN { nextFree? }`, `409 BLOCKED_CUSTOMER`, `409 TOO_MANY_OPEN`, `422 OUT_OF_WINDOW` |
| `POST …/booking/appointments/[id]/reschedule` | `{ start, staffId?, idempotencyKey }` → `Appointment`; `409 SLOT_TAKEN`, `409 RESCHEDULE_LIMIT`, `409 TOO_LATE` |
| `POST …/booking/appointments/[id]/cancel` | `{}` → `Appointment` (`lateCancel` true inside the deadline) |
| `POST …/booking/push` (slice 5) | `{ subscription }` → `204`; `DELETE` with `{ endpoint }` → `204` |
| `POST …/booking/consent` (slice 5) | `{ rebook: boolean }` → `204` |

`Appointment` = `{ id, status, start, durationMin, priceMinor, service: { id, name }, staff: { id, name }, rescheduleCount, lateCancel, canCancel, canReschedule, cancelDeadline }` (instants as ISO strings; the client formats in the shop's timezone).

Example: `POST /api/card/K7q…/booking/appointments` `{ "serviceId": "…", "start": "2026-10-28T09:00:00.000Z", "customerName": "Mia", "idempotencyKey": "b3f1…" }` → `201 { "id": "…", "status": "confirmed", "start": "2026-10-28T09:00:00.000Z", "durationMin": 45, "priceMinor": 3500, "service": { "id": "…", "name": "Gel neu" }, "staff": { "id": "…", "name": "Lena" }, "rescheduleCount": 0, "lateCancel": false, "canCancel": true, "canReschedule": true, "cancelDeadline": "2026-10-27T09:00:00.000Z" }`.

### Owner (`/api/merchant/booking…`)

| Method, path | Body → response |
|---|---|
| `GET …/setup` | → `{ settings, services, staff, presets: { nagelstudio, barber, kosmetik } }` |
| `PUT …/setup` | `{ settings, services: [{ id?, … }], staff: [{ id?, …, serviceIds }] }` → same as GET; `409 STAFF_HAS_APPOINTMENTS { staffId, count }` |
| `GET …/day?date=YYYY-MM-DD` | → `{ date, appointments: [OwnerAppointment], blocks, staff, pendingRequests, timezone, blockedMembershipIds }` (last two: slice 4) |
| `POST …/appointments/[id]/transition` | `{ to: "confirmed" \| "done" \| "no_show" \| "cancelled_by_shop", expected, purchaseAmountMinor?, reason? (cancel, slice 4), idempotencyKey }` → `OwnerAppointment` (+ `award` when done); `409 STALE` when `expected` no longer matches; `409 TOO_EARLY` for done/no_show before `start − 10 min` |
| `POST …/appointments/[id]/move` | `{ start, staffId }` → `OwnerAppointment`; `409 SLOT_TAKEN` |
| `GET …/appointments/[id]/slots?date=YYYY-MM-DD` (slice 4) | → `{ date, slots: [{ start, staffId }] }`: free starts for „Verschieben“, booked length, same staff, no lead time |
| `POST …/blocks` | `{ staffId?, start, end, reason }` → `{ block, affected: [OwnerAppointment] }`; `DELETE …/blocks/[id]` → `204` |
| `POST …/blocks/[id]/cancel-affected` | `{}` → `{ cancelled: n }` (sets `cancelled_by_shop`, reason „Geschäft geschlossen“, pushes in slice 5) |
| `POST …/customers/[membershipId]/block` / `…/unblock` | `{ reason? }` → `204` |
| `GET /api/merchant/export?kind=appointments` (slice 6) | CSV, same auth as the other kinds |

`OwnerAppointment` = `Appointment` + `{ customerName, customerPhone, cardLocator, membershipId, noShowCount, doneAward?: { balance, creditedQuantity } }`.

Cashier fusion (slice 4): `src/app/api/cashier/award/route.ts` and `…/tap/[id]/confirm/route.ts` call `completeAppointmentForAward(entry)` after a successful staff award; `GET /api/cashier/tap/pending` adds `appointment: { start, serviceName } | null` to each pending tap (read-only lookup). The loyalty core (`lib/loyalty.ts`, `lib/secure-tap.ts`) is not edited.

## 4. State machine

```
                 customer books                     owner / auto-confirm
   (none) ───────────────────────► requested ──────────────────────────► confirmed
                                      │  ▲                                  │   │
          auto_confirm = true: book   │  │ reschedule (count+1, keeps       │   │ "Fertig": award once,
          lands in confirmed directly │  │ status, new `during`)            │   │ done_ledger_entry_id set
                                      │  └──────────────────────────────────┘   ▼
                                      │                                       done
                                      │ customer cancel (any time; late_cancel if inside deadline)
                                      ├──────────────────────────────► cancelled_by_customer
                                      │ owner cancel / "closes early" / card closed / request unanswered at start
                                      ├──────────────────────────────► cancelled_by_shop
                                      │ owner "Nicht erschienen" (start ≤ now + 10 min)
                                      └──────────────────────────────► no_show   (3rd in 12 months → booking_blocked_customers)
```

Terminal states: done, no_show, cancelled_by_customer, cancelled_by_shop. Every transition is `UPDATE … WHERE id = $1 AND status = $expected` inside the location lock; zero rows → `STALE`. Done is the only transition that writes to the ledger: `awardInTransaction(tx, { membershipId, locationId, userId, quantity: 1 | purchaseAmountMinor + current ruleVersionId, idempotencyKey: "booking:" + id, requestId })` in the same transaction, so a retry after a crash is a `duplicate`, never a second stamp. A tap-confirmed award that matches an open appointment of that card at that location within ±90 min of `now` sets done + `done_ledger_entry_id` without a second award.

## 5. Test plan

| Test | File | Proves |
|---|---|---|
| Availability, unit | `src/lib/booking/availability.test.ts` | Hours minus breaks minus blocks minus appointments; buffer respected; lead time and max-days window; „Egal wer“ union; 15-minute grid; a 45-minute service near closing time; empty staff → no slots. |
| Time, unit | `src/lib/booking/time.test.ts` | `wallToInstant` for 28 Mar 2027 02:30 → null (gap), 31 Oct 2027 02:30 → first occurrence; 25 Oct 2026 09:00 Berlin = 08:00 UTC; the day before = 07:00 UTC. |
| State machine, unit | `src/lib/booking/state.test.ts` | The allowed-transition table; `STALE`; `TOO_EARLY`; late-cancel flag; reschedule limit; no-show count to block. |
| 50 concurrent bookings, integration | `src/lib/booking/race.integration.test.ts` | 50 `book()` calls on one slot via `Promise.allSettled`: exactly one row with status in (requested, confirmed), 49 `SLOT_TAKEN`; the same with 50 different idempotency keys and with the same key (one row, 49 duplicates). Pattern: `award-key-race.integration.test.ts`. |
| DST, integration | `src/lib/booking/dst.integration.test.ts` | Booking 10:00 Berlin on 25 Oct 2026 stores `09:00Z`; on 24 Oct `08:00Z`; a 24 h reminder job for 26 Oct 10:00 is due at 25 Oct 09:00Z; slots on the DST day start at the right instants. |
| Points on completion, integration | `src/lib/booking/complete.integration.test.ts` | `done` awards once (balance +1), a retry with the same key is a duplicate, the tap path marks done without a second award; cashier role cannot transition. |
| Tenancy, integration | `src/lib/booking/tenancy.integration.test.ts` | Another shop's owner gets `NOT_FOUND` for the appointment and the day view (test C9 pattern); the card token of shop A cannot book at shop B. |
| Reminders and rebook, integration (slice 5) | `src/lib/booking/notify.integration.test.ts` | Two jobs per confirmed appointment at the right instants; cancel makes them no-ops; quiet hours move a 2 h reminder to 08:00; rebook scan respects consent, cap, open-appointment rule, and sets `rebook_sent_at` once. |
| Customer flow, end-to-end (slice 3) | `e2e/booking-customer.spec.ts` | From the card: Termin buchen → service → day → time → confirm, ≤ 4 taps, the appointment appears under „Meine Termine“; cancel works; Playwright 390 px. |
| Existing suite | `npm test` (full) | Unchanged behaviour; run once after slice 4 and once at the end. |

Local run: `DATABASE_URL=postgresql://looplocal:looplocal_local_only@127.0.0.1:54433/looplocal_test BETTER_AUTH_SECRET=<32+ chars> BETTER_AUTH_URL=http://localhost:3000 PUBLIC_BASE_URL=http://localhost:3000 BILLING_FIXTURE_MODE=true BILLING_FIXTURE_SECRET=<32+ chars> npx vitest run src/lib/booking` after `npx drizzle-kit migrate` with the same `DATABASE_URL`.

## 6. Slice → files

1. `schema.ts` (append), `drizzle/0042_booking.sql` + journal/snapshot, `lib/booking/{time,availability,setup,appointments,presets}.ts`, the customer and owner routes of §3 except push/consent/export, tests of §5 rows 1–7.
2. `app/merchant/termine/einrichten/page.tsx` + `components/owner/booking-setup.tsx`, nav group „Termine“ (`components/owner/nav.ts`, icon `calendar` in `owner-ui.tsx`).
3. `app/card/[token]/termin/page.tsx` + `components/booking/customer-flow.tsx`, „Termin buchen“ and „Nächster Termin“ in `components/card-client.tsx`, e2e spec.
4. `app/merchant/termine/page.tsx` + `components/owner/booking-day.tsx` (day view, actions sheet), cashier fusion (two route files + pending-tap payload + one line on the cashier pending card).
5. `lib/booking/notify.ts`, worker dispatch for `booking.reminder` / `booking.rebook`, nightly `queueRebookPushes`, `public/card-sw.js`, push/consent routes, Wallet pass back field + „Nächster Termin“ (`lib/wallet/*`), card UI for the push toggle and consent box.
6. `lib/merchant-analytics.ts` + analytics page euro section; `lib/export.ts` kind `appointments`; customer export.
7. `/operator` toggle „Termin + Treue“ per location → `booking_settings.enabled`; `/merchant/billing` shows the plan; marketing site pricing card; the two CHECK edits stay unapplied (founder's yes).
8. `scripts/seed-booking-demo.ts`; `docs/booking-pitch-addendum.md`.
