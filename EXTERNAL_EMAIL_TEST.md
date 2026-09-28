# Controlled Mailgun EU recovery test

This is Gate 6 evidence for one owner-approved mailbox and synthetic membership. Exactly two real transactional messages were sent on 28 September 2026. No campaign or promotional message was sent.

## Configured on 28 September 2026

- Mailgun EU sending domain: `mail.getloynara.com`. Mailgun displayed SPF **Verified**, DKIM **Active**, Free plan and 0/3,000 emails immediately before the test; its dashboard showed 2/3,000 afterward. No paid upgrade was selected.
- Cloudflare DNS: TXT SPF at `mail.getloynara.com`, TXT DKIM at `mta._domainkey.mail.getloynara.com`. No receiving MX or tracking CNAME was added because inbound mail and tracking are outside this transactional test.
- Existing named tunnel: `mail-events.getloynara.com` routes only `^/api/email/mailgun/webhook$` to the private device-test origin. Application host guard returns 404 for other paths or methods. The existing `preview.getloynara.com` Access policy was not changed.
- Mailgun domain-level callback: `https://mail-events.getloynara.com/api/email/mailgun/webhook` for accepted, delivered, temporary failure, permanent failure, complained and unsubscribed. Open/click tracking remains off.
- The owner-created domain-level sending key and webhook signing key are in ignored mode-0600 `var/device-test.env`. The transactional flags were enabled only for this controlled test and returned to `EXTERNAL_EMAIL_ENABLED=false` and `MAILGUN_SEND_APPROVED=false` after the second message. Promotional sending remains disabled.
- Synthetic public-route check before sending: unrelated path and GET returned 404, invalid signature 406, valid signed fixture 200, duplicate fixture 200 with one stored event. Unauthenticated `preview.getloynara.com/api/health` redirected to Access.

## Real controlled result — 28 September 2026

- One verification message and one lost-card recovery message were each accepted by Mailgun EU and had an authenticated `accepted` and `delivered` webhook correlated to one application delivery attempt. Provider references remain in the isolated database, not this document.
- The owner confirmed the email and then used an iPhone private browser to request and complete recovery. This is owner-reported device interaction; application and database checks are separate evidence.
- The original browser-card credential returned HTTP 404; the replacement returned HTTP 200. The membership ID, balance, ledger activity count, referral count, marketing consent and verified recovery method matched the pre-recovery baseline. The consumed recovery challenge was removed and one credential-rotation audit event was recorded.
- Opening the recovery email link by GET did not rotate the card. The owner reopened the used link in the iPhone private browser and reported an invalid-link result. No additional card or email was issued.
- A recovery-completed security notice was queued by the application, but its job was **blocked** with external sending disabled to honor the owner's two-message limit. This notice needs a separate approved send or a reviewed suppression policy before general operation.
- Total real messages: **2**. New spending: **€0**. Gate 6 remains `PARTIAL` because installed Wallet lifecycle and broader release acceptance remain open; Gate 5 remains `NOT_IMPLEMENTED` for live promotional delivery.

1. **Account/region:** the owner provided an EU-region Mailgun account on the Free plan; no plan upgrade was selected. The adapter uses only `https://api.eu.mailgun.net/v3/{domain}/messages`.
2. **Sending subdomain:** owner-approved `mail.getloynara.com`. Keep the marketing/root and protected preview routes unchanged.
3. **DNS:** the account-specific SPF and DKIM records were copied from Mailgun's *Domain Verification & DNS* screen and verified there. Add receiving MX only if inbound handling is separately selected. Tracking CNAME/unsubscribe configuration belongs to Gate 5 review, not this transactional test.
4. **Server-only configuration:** the test temporarily used `EXTERNAL_EMAIL_ENABLED=true`, `MAILGUN_SEND_APPROVED=true`, `MAILGUN_EU_DOMAIN`, `MAILGUN_FROM_EMAIL`, `MAILGUN_EU_API_KEY`, `MAILGUN_EU_WEBHOOK_SIGNING_KEY`, plus existing `PUBLIC_BASE_URL`, `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DATABASE_URL`. The send flags are now false. Credentials stay in restricted secret storage, never chat, Git, client assets or logs.
5. **Webhook:** the approved provider-facing URL is `https://mail-events.getloynara.com/api/email/mailgun/webhook`. The app verifies the HMAC-SHA256 signing key, timestamp and event ID, rejects invalid signatures and records duplicates once. The customer/staff browser application keeps its separate Access policy. Confirm a real Mailgun delivery webhook during the approved send.
6. **Events:** enable `accepted`, `delivered`, `temporary_fail`, `permanent_fail`, `unsubscribed`, `complained` for the EU sending domain. Verify event correlation to an actual queued message and suppression after permanent failure/complaint.
7. **Recipient:** the owner designated one controlled mailbox and approved exactly one verification and one recovery message. No customer contacts were imported.
8. **Verification:** the owner opened the one-time email and confirmed the recovery method. Marketing consent remained unchanged.
9. **Recovery:** the owner used an iPhone private browser, requested recovery, opened the email link and explicitly rotated the card. Local HTTP and database checks confirmed old-link rejection and preserved membership state. Multiple-merchant mailbox recovery remains a local synthetic test, not real-device evidence.
10. **Failure handling:** safely exercise a rejected/temporary send and a signed permanent-failure or complaint fixture; a real bounce/complaint test needs separate owner/provider approval. Inspect accepted/delivered/failure attempt records and ensure ambiguous sends are blocked for operator reconciliation, not blindly repeated.
11. **Gate 6 PASS evidence:** the real email, owner-reported second-browser recovery, old-link invalidation and signed provider event are now recorded. Closed-card denial remains local synthetic evidence; installed Wallet lifecycle and the queued security-notice policy remain open. Gate 6 is `PARTIAL`.
12. **Gate 5 contribution:** this provides reusable transactional sending, event authentication, suppression and delivery records. Real promotional sender approval, unsubscribe route, campaign dispatch integration and an approved end-to-end campaign remain separate; Gate 5 is still `NOT_IMPLEMENTED` for live delivery.

The worker never logs an address or link token. A timeout or unclear provider response is a `blocked` job requiring reconciliation, because exactly-once delivery cannot be inferred from an HTTP retry.

Official references: [Mailgun EU API region](https://documentation.mailgun.com/docs/mailgun/api-reference/api-overview), [send messages](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages), [domain verification](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-verify), [webhook event types](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhooks), [webhook signatures](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/securing-webhooks), [webhook retries](https://documentation.mailgun.com/docs/mailgun/user-manual/webhooks/webhook-retries).
