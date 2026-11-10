# Final security audit before the production release, 10 November 2026

**GO for the production release.** No Critical and no High finding is open, confirmed or plausible. Two conditions that are checks, not findings: the commit that is deployed has a green CI run (Tests and the NFC browser specs were still running on `e7059fca` when this was written), and the two client-side pull requests are merged at the commits audited here or re-checked if they change.

Second round, after the audit of the same day (`docs/security-audit-2026-11.md`, `railway-rc` `1b77eeca`). It covers what goes to production on top of that: `railway-rc` `e7059fca` (pull requests #236 to #244 merged) and the two open client-side pull requests #245 (`41eb4215`) and #246 (`559742e0`). Production today runs `0161fd1f`; everything between that and `1b77eeca` was in round 1.

## Result

- No new Critical, High or Medium finding.
- Three new Low findings (F-1 to F-3) and five notes.
- The five code fixes from round 1 hold on the merged head. One of them (the per-card pace limit) has a gap on the offline path, listed as F-1.
- Still open from round 1: M-2 (NFC verification master not rotated, Medium, a founder step with no code fix), the push-token part of M-4 (ENG-196), the CI advisory check (ENG-195) and L-1 to L-13 (ENG-197). None of them is made worse by this release.

## How it was tested

- Diff of `1b77eeca..e7059fca` read in full for everything that is not a stylesheet: 108 files, of which five API routes (all from the round-1 fixes), no change to `src/proxy.ts`, `next.config.ts`, `src/lib/auth.ts`, `src/lib/http.ts`, `src/lib/rate-limit.ts`, `src/lib/secure-tap.ts`, `src/db`, `drizzle`, `scripts`, `Dockerfile` or `.github`.
- The two open pull requests read the same way; outside `src/components` they change only `src/app/globals.css`, `DESIGN.md` and browser specs.
- Local runs only, against a throwaway PostgreSQL 18 cluster on 127.0.0.1:54471 with synthetic data. No request went to a hosted address.
- "Run" means a local test showed it. "Read" means the deciding lines were read and are cited, nothing executed.
- Tests run on `e7059fca`: the four regression files of the round-1 fixes plus the unit tests of the configuration gate, the demo guard and the operator target (7 files, 206 passed, 1 skipped), and two new checks kept with the audit notes (`security-audit-2026-11-10/final/repros/` in the CTO folder; copy into `src/lib/` and run with `npx vitest run <file>`). The full suite was not re-run locally; CI is the record for that.

## Round-1 fixes on the merged head

| Finding | Fix | State on `e7059fca` | Proof |
| --- | --- | --- | --- |
| M-1 dependencies | #243 | Holds. `next` 16.4.6, `better-auth` 1.7.19, `zod` 4.6.7. The lockfile has 692 packages, every one with an integrity hash and resolved from registry.npmjs.org. No advisory is left on the three packages. What `npm audit` still reports is developer tooling, see F-3. | Run |
| M-2 NFC master rotation | none (founder step) | **Open.** State unknown since 22 October. Rotation uses the re-key tool of #234, which is not part of this release. | not re-tested |
| M-3 recovery keeps QR code and passes | #242 | Holds. Recovery replaces link and QR code and revokes every saved pass (`src/lib/card-recovery.ts:72-78`). Raced three ways against itself and against six pass requests made with the old link: exactly one recovery wins, no pass on the old credential stays live, the old link can no longer make a pass, the old QR code is unknown at the counter, and every old pass is served void by the Apple web service and may not register a device. A pass is live only while its row is unrevoked and its stored hash matches the card's current QR code (`src/lib/wallet/apple-service.ts:38`), so there are two independent locks. | Run (new check) |
| M-4 device registrations per pass | #241 | Cap of ten holds, counted under the pass row lock (`src/lib/wallet/apple-service.ts:57-60`). The push-token overwrite is still open as ENG-196. | Run |
| M-5 account without a role creates a shop | #239 | Holds. `createMerchant` has one caller in the app (`src/app/api/merchant/onboard/route.ts:10`); the other three are local seed and fixture scripts. | Run |
| M-6 pace limits | #240 | Holds on the online routes. Forty parallel requests against one card's allowance let exactly twenty through, so parallel tills or sessions cannot overrun it. Gap on the offline path: F-1. Busy-counter question: note N-1. | Run (new check) |

## New findings

### F-1. Low. The per-card pace limit does not cover offline bookings

- **Where:** `src/app/api/cashier/offline/sync/route.ts:15-17`, `src/lib/offline-earning.ts:11` and `:36`.
- **What:** #240 allows one card 20 bookings in 15 minutes "whoever stands at the counter". Bookings that arrive through the offline queue are not counted against that allowance. They have their own limits: 60 per login in 15 minutes, 20 per lease, and a lease is per login, card and device id, where the device id is a value the browser chooses. A signed-in staff member of the shop can therefore book one card up to 60 times in 15 minutes per login instead of 20.
- **Limits of the damage:** needs a valid staff login of that shop. The per-login caps hold on every path (120 online, 120 by tap, 60 offline), and each booking stays inside the role's quantity cap (`src/lib/award-limits.ts:4`).
- **Fix:** in `syncOfflineAward`, once the lease is loaded, charge the same `cashier_booking_card` allowance with the lease's location and card, and reject the event with its own reason. About five lines and one test. L1.
- **Status:** Plausible (read, not run).

### F-2. Low. The private card link is written into the browser's storage and never removed

- **Where:** `src/components/wallet-step.tsx:17` and `:26`, `src/components/card-client.tsx:48`.
- **What:** three small "already shown" flags are stored in `localStorage` under names that contain the card's private link token (`loynara_wallet_step:<token>` and two more). The token is the whole credential for the card. The entries outlive a cleared browsing history and are never deleted, so anyone who can open the browser's site data on a shared or borrowed device finds a working card link. Older than round 1 and missed there.
- **Limits of the damage:** needs access to the unlocked browser profile, or script running on the app's own origin (the content security policy allows no foreign script). The link stops working when the card is recovered or reissued.
- **Fix:** name the flags after the card number, as the new booking moment already does on purpose (`src/components/customer/booking-moment.ts:26`), and delete the old entries when the card page opens. L1, no server change.
- **Status:** Confirmed (read).

### F-3. Low. Fourteen advisories in developer tooling

- **Where:** `package-lock.json`; `Dockerfile:5` installs developer packages into the production image (round-1 L-12).
- **What:** `npm audit` on the merged head reports one high (`vite` 8.3.0 to 8.3.2, pulled in by `vitest`) and thirteen moderate advisories (`vitest`, `drizzle-kit` through an old `esbuild`, `typescript-eslint` through `minimatch`). All of them need a running development or test server. None is in the code the production web or worker process runs; the packages are only present on disk in the image.
- **Fix:** `npm audit fix` clears all but the `drizzle-kit` chain without a major version change. Do it with ENG-195 (advisory check in CI) and after this release, not in it.
- **Status:** Confirmed (run).

## Notes

- **N-1. Pace limits at a busy counter.** 120 bookings per login in 15 minutes is eight a minute, held for the full quarter of an hour. The card lookup has had the same 120 since before round 1, so #240 adds no new stop for a booking by QR code or card number, and bookings by tap have their own 120. A shop that shares one login across several tills would reach the limit above eight guests a minute; the counter then gets "try again later" with the waiting time, for at most 15 minutes, and no booking is half-made. Twenty per card covers any real guest. Advice: one login per till, and look for these refusals in the logs in the first week. Separately, a cashier can use up one card's twenty and so block that card at their own shop for 15 minutes; the allowance is keyed with the location, so no other shop is affected.
- **N-2. The booking moment (#238) adds no data path.** The card page learns of a booking only from the read it already made, `GET /api/enroll/card/<token>`, which needs the card's private link. No route, cookie or header changed. It stores `loynara_seen:<card number>` with the time of the last booking shown; the card number is not a credential (the counter can use it only inside its own shop, signed in).
- **N-3. Late taps during a screen change (#245).** A tap that lands while the owner app changes screens is passed on to the control under the finger on the new screen (`src/components/owner/owner-shell.tsx:98` on the branch). Only genuine taps are passed on and the app cannot be framed, so there is no way for a third party to use it. It can still press a button the owner had not seen yet; destructive actions must keep their confirmation dialog. For Design and QA, not a security defect.
- **N-4. The website's header file sets no HSTS header** (`marketing-site/site/_headers`). It may be set at the Cloudflare zone; not checked because nothing hosted was touched.
- **N-5. CI was not finished** on `e7059fca` (Tests, NFC browser specs) and on #245 (Tests) when this was written. #246 was green.

## Checked and found sound

- **Motion pull requests #236, #238, #244, #245, #246.** No `dangerouslySetInnerHTML`, no `innerHTML`, no new network call, no service worker, cookie or cache-header change, nothing new in a URL. The two `MutationObserver`s only read headings and set presentation attributes. New storage use is N-2 only. The document title now follows the screen heading; no owner screen puts a guest's name or address in its heading, the card screen shows the card number.
- **Website (`marketing-site/`).** Content security policy `default-src 'self'`, `script-src 'self'`, `style-src 'self'`, `connect-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`. Six built pages: one external module script on the home page, no inline script, style attribute or event handler. The request form sends nothing; it opens a `mailto:` to the fixed support address with encoded subject and body, or copies the text. Its own dependencies have no advisory.
- **Demo mode is inert in production.** Every demo path asks `demoEnvironment()`, which is false unless `DEMO_ENVIRONMENT` is exactly `true` and false in any case on the production deployment (`src/lib/demo-environment.ts:10-12`). The demo route answers 404 otherwise. The configuration gate refuses `DEMO_ENVIRONMENT=true` on production and requires a demo database to name itself demo (`scripts/config-check.ts:22-28`). The operator tools accept only the targets production, demo and local, each with its own marker and database rule (`scripts/operator-identity.ts:33-52`).
- **Release path.** The configuration gate is unchanged since round 1 and still refuses open registration, a missing or wrong production identity, the billing fixture, an incomplete Stripe or Wallet configuration and Google Wallet without its separate approval; its tests pass. Migration 0049 creates one new table and touches no existing one; its rows carry `tenant_id` with composite foreign keys, and shop erasure finds tenant tables from the database itself, so it takes them. The new limits are constants in code and counted in PostgreSQL, so web and worker cannot disagree; an old worker next to the new web during the deploy handles the revoked passes the same way as after a staff reissue.
- **Regression sweep.** The only API routes changed since round 1 are the five fixed ones; tenancy checks in them are untouched. The public card, tap, plate and webhook routes, the NFC secure tap and the security headers are unchanged since round 1; the Apple web service changed only by the device cap of #241. No secret-shaped string was added on the merged head or in the two open pull requests; CI workflows are unchanged.

## Not checked

- Anything hosted: production, the demo project, the live website, Railway variables. That the production settings really are what the release plan says (`PUBLIC_REGISTRATION_ENABLED=false`, billing off, Google Wallet off) can only be seen there; this audit checked the gate that refuses the unsafe values.
- Real devices: how an iPhone shows a pass that was voided by recovery, and NFC plates.
- The NFC master rotation state (M-2) and the re-key tool in #234.
- The full test suite and the browser specs on the merged head, locally. CI runs them.
- #245 and #246 after the audited commits.
- Stylesheets line by line.

## Tickets

| Finding | Ticket | Note |
| --- | --- | --- |
| F-1 | new, to be numbered | small fix, after the release is fine |
| F-2 | new, to be numbered | small client fix |
| F-3 | ENG-195 | together with the CI advisory check |
| M-2 | founder step | rotation before or soon after the release |
| M-4 push token | ENG-196 | unchanged |
| L-1 to L-13 | ENG-197 | unchanged |
