# Loynara Termin – slice status notes

Local run for every slice: start the throwaway cluster (`pg_ctl -D <scratch>/pg/data -o "-p 54433" start`), then
`DATABASE_URL=postgresql://looplocal:looplocal_local_only@127.0.0.1:54433/looplocal_test BETTER_AUTH_SECRET=<32+> BETTER_AUTH_URL=http://localhost:3000 PUBLIC_BASE_URL=http://localhost:3000 BILLING_FIXTURE_MODE=true BILLING_FIXTURE_SECRET=<32+> npx drizzle-kit migrate && npx vitest run src/lib/booking`.
Dev server: `.claude/launch.json` entry `loynara-booking` (port 3090, database `looplocal_dev` on the same cluster).

## Slice 1 – schema, availability engine, double-booking guard (2026-10-27)
- Works: migration 0042 (nine `booking_*` tables, btree_gist, two EXCLUDE constraints), availability engine, presets, 14 routes (5 customer, 9 owner), 41 tests incl. 50 concurrent bookings → one row, DST on 25 Oct 2026, points awarded once on „Fertig“, tenancy.
- Not yet: no UI, no push/consent/export routes, `booking_settings.enabled` is only set by slice 7's operator toggle, the monthly reschedule limit is approximated from `updated_at` (shortcut comment in appointments.ts).
- Run: see the command above; the full suite was not run in this slice.
- Next: slices 2 (wizard), 3 (customer flow), 4 (day view + cashier fusion), 6 (dashboard + export) in parallel.
