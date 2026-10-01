# EXTERNAL SERVICES

Third-party services Loynara depends on or has trialled. Statuses and tiers: [README](README.md). Evidence IDs: [EVIDENCE-INDEX.md](EVIDENCE-INDEX.md).

**Never recorded here:** token values, ping URLs, passwords, private keys, account IDs that grant access, personal e-mail addresses. A **credential type**
is named; its value is not. Costs are recorded only where a source shows them (tier noted); otherwise `UNKNOWN`.

| Service | In production? | Role |
|---|---|---|
| [Railway](#railway) | **Yes** | Hosting: web, worker, migrate, PostgreSQL, ops, backup, connector |
| [Cloudflare](#cloudflare) | **Yes** | DNS, tunnels, Access, Pages audit copy, Email Routing, domain |
| [Cloudflare R2](#cloudflare-r2) | **Yes** | Encrypted backups |
| [Healthchecks.io](#healthchecksio) | **Yes** | Heartbeat monitors and alerts |
| [UptimeRobot](#uptimerobot) | **Yes** | External HTTPS monitors |
| [GitHub](#github) | **Yes** | Source, Railway build source |
| [Mailgun EU](#mailgun-eu) | Configured, **sending disabled** | Transactional/promotional e-mail |
| [PassFast](#passfast) | **No** (synthetic proof of concept) | Temporary managed Apple signer |
| [Apple Developer Program](#apple-developer-program) | **No** (not enrolled) | Native Apple Wallet signing |
| [Google Wallet issuer](#google-wallet-issuer) | **No** (status UNKNOWN) | Native Google Wallet |
| [NFC hardware](#nfc-hardware) | **No** (physical tests not started) | Tags and reader |

---

## Railway
<a id="railway"></a>
- **Purpose:** Runs the production system in EU West (Amsterdam): `loynara-web`, `loynara-worker`, one-shot `loynara-migrate`, `loynara-postgres` (private, no TCP proxy), `loynara-ops-check` (cron), `loynara-backup` (cron), and the `cloudflared` connector.
- **Production?** Yes. Deployment IDs and lineage: [RELEASES.md](RELEASES.md).
- **Plan / cost:** Hobby ($5/month minimum including $5 usage; $5.95 subscription charged 2026-09-29, Tier 2). Owner-approved limits: $10 compute warning, $16 compute hard limit, $0 Agent limit; the owner accepted that these do not cap taxes or every invoice item and that the hard limit takes workloads **offline**. At 2026-10-01 08:21–08:26Z: usage $0.26, displayed bill $0 after credits, total RAM ≈ 0.50 GB, database volume 0.22 GB of the 5 GB limit (Tier 2, [E-012](EVIDENCE-INDEX.md#e-012)). **Pro** ($20/month minimum) is required before the first paying merchant ([D-008](DECISIONS.md#d-008)).
- **Data flow:** All application data lives on the PostgreSQL volume; environment variables hold secrets; builds come from GitHub (`railway-rc`, auto-deploy off); logs retained 7 days on Hobby; removed images retained about 72 hours.
- **Credential type:** Environment-scoped **project token** (Project scope, named "first token") used by deployment scripts; the owner's signed-in browser session for the Console and audit UI; a Railway GitHub App installation limited to one repository. Values and token IDs are not recorded.
- **Known risks:** Hard-limit shutdown; no native backups on Hobby ([X-002](RISKS-AND-EXCEPTIONS.md#x-002)); 7-day logs and 72-hour image retention ([R-005](RISKS-AND-EXCEPTIONS.md#r-005)); audit records attribute project-token actions to the owner's account without a named client unless the script sets one ([X-001](RISKS-AND-EXCEPTIONS.md#x-001), [X-011](RISKS-AND-EXCEPTIONS.md#x-011)); application connects as the database superuser ([R-001](RISKS-AND-EXCEPTIONS.md#r-001)); Node `DEP0205` startup warnings.
- **Exit / migration:** Dockerfiles (`Dockerfile`, `Dockerfile.backup`) are portable; PostgreSQL 18 dumps already flow to R2 and a restore procedure exists; the Cloudflare Tunnel decouples the public origin from the host.
- **Open action:** Pro upgrade, native backup and native restore test before the first paying merchant ([O-017](OPEN-ITEMS.md#o-017)); periodic access/token review ([O-044](OPEN-ITEMS.md#o-044)); least-privilege database role ([O-040](OPEN-ITEMS.md#o-040)).

## Cloudflare
<a id="cloudflare"></a>
- **Purpose:** DNS zone for `getloynara.com`; production tunnel (cloudflared on Railway) for `app.`, `mail-events.` and `unsubscribe.`; device-test tunnel and Zero Trust Access for `preview.` (Mac-hosted); Pages project for the public **audit copy**; Email Routing for a support address; Browser Integrity Check on the zone.
- **Production?** Yes (DNS, production tunnel, origin protection). The Access-protected preview and the audit copy are non-production.
- **Plan / cost:** Free plan; Zero Trust Free (30-minute Access session, one exact-email Allow policy). Domain expiry 2027-09-26; managed certificate expiry 2026-12-25 (auto-renewal expected, not verified); registrar and domain price **UNKNOWN** (Tier 2, [E-012](EVIDENCE-INDEX.md#e-012)).
- **Data flow:** Cloudflare proxies HTTPS and can process paths, queries, bodies and cookies; standard sampled security telemetry exists; **no Logpush, Logpull, Instant Logs or Log Explorer** is enabled/available on this plan; no Worker routes. No zero-retention or EU-boundary guarantee is asserted ([X-005](RISKS-AND-EXCEPTIONS.md#x-005)).
- **Credential type:** Tunnel tokens (production and device-test; one is held as a Railway variable, both also exist as local files), owner browser session. No API token is recorded for Cloudflare.
- **Known risks:** Browser Integrity Check blocks default client user agents (operational note, [D-012](DECISIONS.md#d-012)); the apex has MX records (Email Routing) but **no web record** — publishing must not disturb them; the public audit copy contains placeholders and is `noindex`; Email Routing forwarding was configured with status "Syncing" and no delivery test is recorded.
- **Exit / migration:** DNS records are portable; a tunnel can be replaced by direct ingress only with a verified path-redaction story ([D-008](DECISIONS.md#d-008) reasoning).
- **Open action:** Gate-7 processor/DPA and session-IP privacy review ([O-019](OPEN-ITEMS.md#o-019)); apex publication ([O-014](OPEN-ITEMS.md#o-014)); decide the audit copy's retention/unpublish; test the support-address forwarding.

## Cloudflare R2
<a id="cloudflare-r2"></a>
- **Purpose:** Off-platform storage for nightly **age-encrypted** PostgreSQL logical dumps (private EU-jurisdiction Standard bucket `loynara-rc-backups`, no public URL or custom domain, 14-day expiry rule on the `loynara/` prefix).
- **Production?** Yes. First natural encrypted run verified 2026-10-01 03:00Z ([T-014](TEST-EVIDENCE.md#t-014)).
- **Plan / cost:** Pay-as-you-go activated 2026-09-29 with a $0-due-now checkout; expected $0 inside the free allowance (not confirmed against an invoice).
- **Data flow:** `loynara-backup` cron → `pg_dump` → `age` (recipient key) → S3-compatible upload → HEAD verification → heartbeat. Restore uses a separate decryption identity on a different host.
- **Credential type:** S3-style access token on the backup service; age **recipient** (public) on the service; age **identity** (private) kept in a local file whose custody beyond that is **UNKNOWN** ([R-008](RISKS-AND-EXCEPTIONS.md#r-008)).
- **Known risks:** Without the age identity the backups cannot be decrypted; the restore drill covered an **empty** schema only ([X-004](RISKS-AND-EXCEPTIONS.md#x-004)); 14-day retention; single provider and jurisdiction.
- **Exit / migration:** Any S3-compatible target; keep the age identity.
- **Open action:** Confirm offline key custody ([O-008](OPEN-ITEMS.md#o-008)); run a populated restore test (part of [O-017](OPEN-ITEMS.md#o-017)).

## Healthchecks.io
<a id="healthchecksio"></a>
- **Purpose:** Heartbeat monitoring: worker (heartbeat), outbox/ops (heartbeat), backup (daily with 3-hour grace); e-mail alerts to the owner.
- **Production?** Yes. DOWN/UP alert receipts verified for backup, worker, ops and an isolated missed-run check ([T-017](TEST-EVIDENCE.md#t-017), [T-018](TEST-EVIDENCE.md#t-018), [T-020](TEST-EVIDENCE.md#t-020), [T-021](TEST-EVIDENCE.md#t-021)).
- **Plan / cost:** Free (5 of 20 checks used on 2026-10-01; Tier 2).
- **Data flow:** Services call per-check **ping URLs**; the monitor stores ping history and sends e-mail. The worker refuses to start without a reviewed HTTPS heartbeat URL.
- **Credential type:** Per-check ping URLs (effectively secrets — anyone holding one can fake a success) and the owner account login. Not recorded.
- **Known risks:** Single alert recipient; free-plan history retention **UNKNOWN**; a leaked ping URL defeats alerting.
- **Exit / migration:** Replaceable; the heartbeat call is a plain HTTPS ping.
- **Open action:** Verify retention; consider a second alert channel ([O-009](OPEN-ITEMS.md#o-009)).

## UptimeRobot
<a id="uptimerobot"></a>
- **Purpose:** External HTTPS monitors (app health and the ingress-sensitive QR endpoint), five-minute interval; independent of Railway.
- **Production?** Yes. Real outage DOWN 2026-10-01 08:28:50Z, recovery after 5m04s, both e-mails received ([T-019](TEST-EVIDENCE.md#t-019)).
- **Plan / cost:** Free (heartbeat monitors require a paid plan, so Healthchecks is used for those; Tier 2).
- **Data flow:** Public GET requests only.
- **Credential type:** Owner account login. **Known risks:** Single channel; free-plan limits. **Exit:** Replaceable. **Open action:** none.

## GitHub
<a id="github"></a>
- **Purpose:** Private repository `belmo-hub/loynara` (created 2026-09-29) and the build source for Railway.
- **Production?** Yes (source of truth for deployments). **Plan / cost:** private repository; plan **UNKNOWN**.
- **Data flow:** Source code only; the Railway GitHub App is restricted to this one repository and can read/write repository contents, workflows, deployments, checks and administration per its consent screen.
- **Credential type:** Owner account sign-in; Railway GitHub App installation; the credential used for local `git push` was not captured (a local CLI login was invalid on 2026-09-29).
- **Known risks:** Before this checkpoint `origin` had only `railway-rc` and `integration/owner-dashboard-v1`; the frozen dashboard branch, `main` and four tags are **local only** ([R-006](RISKS-AND-EXCEPTIONS.md#r-006)); no branch protection is recorded.
- **Exit / migration:** Any Git host.
- **Open action:** Push or bundle the local-only refs ([O-050](OPEN-ITEMS.md#o-050)).

## Mailgun EU
<a id="mailgun-eu"></a>
- **Purpose:** Transactional (verification, recovery, recovery notice) and consent-aware promotional e-mail through domain `mail.getloynara.com` (EU region); signed event webhook on `mail-events.getloynara.com`; public unsubscribe host `unsubscribe.getloynara.com`.
- **Production?** Configured and tested on the device-test origin; in production **all external-send flags are false**. Production webhook signing and unsubscribe secrets are loaded and passed synthetic handler checks (2026-09-30).
- **Plan / cost:** Free plan, 3 of 3,000 messages used on 2026-09-28 (Tier 2). Spend €0.
- **Data flow:** Recipient address and message content to Mailgun; signed delivery events back to the webhook.
- **Credential type:** Sending key, webhook signing key, independent unsubscribe signing secret. Not recorded.
- **Known risks:** Deliverability unproven at scale; promotional use needs approved consent wording, sender and limits; ambiguous provider outcomes need manual reconciliation; unsubscribe links have no fixed expiry by design.
- **Exit / migration:** Provider adapter boundary; another ESP is possible.
- **Open action:** Release-origin repeat of the recovery/campaign tests under explicit approval ([O-006](OPEN-ITEMS.md#o-006)).

## PassFast
<a id="passfast"></a>
- **Purpose:** Temporary managed Apple Wallet signer used for a **synthetic proof of concept** ([D-018](DECISIONS.md#d-018)). Not integrated: no Loynara adapter, no code or secret in the repository.
- **Production?** **No.**
- **Plan / cost:** Free account, 100 lifetime free generations, **1 used** (99 remaining at 2026-09-30 23:37Z); €0 spent. The vendor's pricing page lists about $0.015 per active pass per month (a search result said $0.02); not verified further.
- **Data flow (PoC):** Synthetic pass content only (no real customer or merchant data). If adopted, the vendor would hold pass content and device push tokens.
- **Credential type:** Owner account login only; **no API key was created.**
- **Known risks:** No SLA or status page; DPA text not reviewed; data region undisclosed; whether Apple accepts shared-signing for many brands is unconfirmed; a managed pass cannot move to your own Pass Type ID; voiding does not delete a pass from the phone ([R-002](RISKS-AND-EXCEPTIONS.md#r-002)).
- **Exit / migration:** Issue native passes from an own Apple account, notify, then void managed passes ([D-019](DECISIONS.md#d-019)). WalletWallet was researched as an alternative and was **not** signed up for.
- **Open action:** Vendor diligence ([O-023](OPEN-ITEMS.md#o-023)); adapter only if the bridge is adopted ([O-022](OPEN-ITEMS.md#o-022)).

## Apple Developer Program
<a id="apple-developer-program"></a>
- **Purpose:** Pass Type ID certificate required to sign a native Apple Wallet pass and to send update pushes.
- **Production?** **No — not enrolled.** The owner reports currently being **unable to complete enrollment** (OWNER-REPORTED; reason UNKNOWN, [TL-037](TIMELINE.md#tl-037)).
- **Plan / cost:** About USD 99 per year per Apple's enrollment page as read by Claude on 2026-09-29; **not re-verified**; no purchase made.
- **Data flow / credential type:** None yet. Native signing would need a certificate, key, WWDR chain and a stable web-service secret.
- **Known risks:** Blocks native Apple Wallet; individual vs organization enrollment changes the name tied to the Pass Type ID.
- **Exit / migration:** n/a. **Open action:** [O-025](OPEN-ITEMS.md#o-025).

## Google Wallet issuer
<a id="google-wallet-issuer"></a>
- **Purpose:** Native Google Wallet loyalty objects (Demo Mode for named testers first; publishing review needed for real customers).
- **Production?** **No.** Issuer status is **UNKNOWN**: no local evidence shows an issuer account, service account or tester was ever created.
- **Plan / cost:** Free issuer account per the docs; no spend recorded. **Credential type:** would be a service-account key file stored outside Git.
- **Known risks:** The production guard rejects Google Wallet unless publishing status is `published`, which conflicts with a Demo Mode acceptance test; a public HTTPS logo host is required; Google's Save-button artwork is required before public use.
- **Exit / migration:** n/a. **Open action:** [O-024](OPEN-ITEMS.md#o-024).

## NFC hardware
<a id="nfc-hardware"></a>
- **Purpose:** Secure NTAG 424 DNA tags for tap-to-stamp and a PC/SC reader to provision them.
- **Production?** **No.** OWNER-REPORTED: ten NTAG 424 DNA 28×28 mm on-metal tags and a REINER SCT cyberJack RFID basis reader purchased ([D-028](DECISIONS.md#d-028), [D-029](DECISIONS.md#d-029)). Cost, supplier, delivery date and serial numbers: **UNKNOWN**.
- **Data flow:** Provisioning keys are generated locally and (today) stored in a development key file; no production key provider exists ([R-003](RISKS-AND-EXCEPTIONS.md#r-003)).
- **Credential type:** Per-tag AES-128 keys (never recorded).
- **Known risks:** The provisioning CLI is hard-locked to the preview origin and the device-test database; a failed provisioning attempt burns a tag UID; tags provisioned for the preview origin cannot be reused for production; generic PC/SC compatibility is *expected*, not verified (the Mac saw zero readers on 2026-09-30).
- **Exit / migration:** Tags are standard NXP parts; keys must be kept to reuse them.
- **Open action:** [O-030](OPEN-ITEMS.md#o-030)–[O-037](OPEN-ITEMS.md#o-037).
