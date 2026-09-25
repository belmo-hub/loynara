# Feature status — 2026-09-25

Status describes the strongest evidence available **in this installation**. `LOCAL_VERIFIED` means a local integration test or an exercised local browser path; `PROVIDER_TEST_VERIFIED` means a fixture/test-provider check, not a live account; `LIVE_DEVICE_VERIFIED` has not been achieved. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md) for exact checks and [LAUNCH_BLOCKERS.md](LAUNCH_BLOCKERS.md) before any public use.

| Feature | Status | Evidence and boundary |
| --- | --- | --- |
| Merchant sign-up, first location, programme, reward, owner role | LOCAL_VERIFIED | PostgreSQL integration tests include simultaneous onboarding of one account, with a database uniqueness constraint permitting one merchant. Synthetic browser sign-up/onboarding checked at desktop and phone widths. Public registration is enabled only in the local demo configuration. |
| Stamp/points programme editing and reward versioning | LOCAL_VERIFIED | Integration test checks reward versions and locks unit changes after a transaction; owner reward editing was exercised in the browser. One active programme per location; the UI manages the first location/programme. |
| Spend-based points calculation and rounding | NOT_IMPLEMENTED | Cashier enters an explicit integer quantity. The `pointsPerEuro` schema field is not connected to a purchase-amount calculation or rounding rule. |
| Public QR enrollment and browser card | LOCAL_VERIFIED | Manual browser QR join without email or marketing consent and passing Playwright local journey; card reloaded with persisted balance/activity. Integration test confirms separate random scan code and card recovery token. |
| Camera scanner | IMPLEMENTED_UNVERIFIED | ZXing browser scanner and manual code path exist. Manual lookup was exercised; actual camera permission and scanning on a physical device were not. |
| Cashier award, redemption, retry and simultaneous spend control | LOCAL_VERIFIED | PostgreSQL integration tests cover idempotent retry and two competing redemptions; manual browser flow awarded 5 and redeemed 8 stamps, and Playwright exercised award/reload/redeem/reload. Checkout requires explicit action after lookup. |
| Tenant/role checks, invitations, revocation, corrections | LOCAL_VERIFIED | Integration tests cover cross-tenant/revoked cashier denial, role limits, owner-only staff actions, and linked reversal with reason. Owner invite/accept/revoke and cashier staff-admin denial were exercised in the browser; revoked cashier controls disappeared. |
| Merchant dashboard and activity | LOCAL_VERIFIED | Synthetic browser dashboard checked at 1280 and 390 px; SQL counts members/award/redemption entries since programme start, with 10 recent entries. No revenue or incremental-sales estimate. |
| Downloadable enrollment QR | IMPLEMENTED_UNVERIFIED | SVG download is wired. A separate printable counter-sign layout is not implemented. |
| Merchant and card exports | IMPLEMENTED_UNVERIFIED | JSON endpoints exist with scoped fields and row cap; no completed export download verification is recorded. |
| Marketing opt-in and withdrawal | LOCAL_VERIFIED | Separate consent event on enrollment; local tests cover bearer card withdrawal and suppression of a queued message before send. Optional email is not ownership-verified by the enrollment flow. |
| Local email test delivery | LOCAL_VERIFIED | A synthetic opted-in `.test` address passed the verified-contact guard, the real worker completed the outbox job, and local Mailpit captured one message. No external message was sent. |
| External email campaigns, reminders, bounce/complaint handling | NOT_IMPLEMENTED | No live sender, verification flow, campaign/schedule UI or provider webhook. External delivery remains off. |
| Apple pass archive, web service and update queue | PROVIDER_TEST_VERIFIED | Self-signed certificate fixture verifies pass ZIP/signature; local DB tests cover device registration and blocked update jobs. No Apple-issued certificate or device test. |
| Google class/object, Save JWT and updates | PROVIDER_TEST_VERIFIED | Local RSA fixture and fake HTTP responder test create/update mapping. No Google issuer or real Save operation. |
| Apple/Google customer wallet operation | BLOCKED_EXTERNAL_SETUP | Credentials, account approvals, public HTTPS endpoints and real devices are absent. Buttons stay hidden while configuration reports unavailable; browser card works. |
| Draft subscription state and EUR/MAD settings | LOCAL_VERIFIED | Merchant creation persists `manual_pending`; shared pricing configuration drives both homepage and stored draft subscription. German default is €49/location/month in EUR minor units, with separate MAD configuration. No charge is created. |
| Hosted billing, portal, webhooks, cancellation/grace | NOT_IMPLEMENTED | No payment-provider adapter or live billing. `LIVE_BILLING_ENABLED` defaults off and production guard rejects turning it on. |
| French join/card/cashier copy | IMPLEMENTED_UNVERIFIED | French join, card and cashier copy plus locale/currency fields exist, but a French browser journey has not been checked. |
| Full French core journey | NOT_IMPLEMENTED | Merchant registration, programme and owner screens remain German; no RTL/Arabic UI. |
| Multi-location administration | NOT_IMPLEMENTED | Tenant/location relationships exist, but merchant UI only creates and manages its first location. |
| Offline earning and referrals | NOT_IMPLEMENTED | No offline queue or referral awards; redemption remains online only. |
| Programme Insights adviser | NOT_IMPLEMENTED | Dashboard shows measured counts only. |
| Public page and demo-request form | LOCAL_VERIFIED | Latest homepage rendered configured draft €49 price and actual synthetic card/cashier screenshots. A synthetic `example.test` demo request was submitted through the DB-backed form and confirmed; no email was sent. Honeypot/per-email limit exist. |
| Prospect import and outreach drafts | LOCAL_VERIFIED | Unit tests enforce source evidence, deduplication, suppression and default `CONSENT_UNKNOWN`. All example data/drafts are offline; nothing was sent. |
| Local seed, diagnostic and worker safety gates | LOCAL_VERIFIED | Synthetic seed/browser data and local configuration/worker tests; see [TEST_EVIDENCE.md](TEST_EVIDENCE.md). No production operations were performed. |
| Local backup and restore check | LOCAL_VERIFIED | Restricted local dump and isolated restore both exited 0; restored tables, counts and append-only trigger were checked. See [TEST_EVIDENCE.md](TEST_EVIDENCE.md). |

No feature has `LIVE_DEVICE_VERIFIED` status. The words “wallet update” refer to an adapter and queued work until real issuer/device checks pass.
