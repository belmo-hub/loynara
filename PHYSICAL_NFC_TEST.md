# Secure NFC physical test handoff

> Superseded for first release by [docs/nfc-v1-runbook.md](docs/nfc-v1-runbook.md) (production provider, two-phase provisioning, Tag #1 procedure). This file still describes the preview/device-test CLI. The "runtime dependency" paragraph in section C–D is closed in software by the derived key provider; it is still unverified on hardware.

| Check | Current result |
| --- | --- |
| Local CLI, official command vectors, mock sequencing, existing SDM/ledger tests | **SOFTWARE_READY** |
| Selected PC/SC reader with a real tag | **READER_COMPATIBILITY_NOT_RUN** |
| Key and SDM personalization on a real tag | **TAG_PROVISIONING_NOT_RUN** |
| iPhone physical NFC tap | **PHYSICAL_IPHONE_NOT_RUN** |
| Android physical NFC tap | **PHYSICAL_ANDROID_NOT_RUN** |

No tag or reader was purchased or used in this software pass. `nfc:reader-check` found PC/SC on the Mac and **zero readers**. The ACR1252U is a reasonable low-cost *unverified candidate*: [ACS documents PC/SC and ISO 14443-4 APDUs](https://www.acs.com.hk/download-manual/6402/API-ACR1252U-1.17.pdf), but that does not establish compatibility with this workflow or NXP certification. NXP's reference workflow is RFIDDiscover with PEGODA. Command framing and this SDM profile follow the [NTAG 424 DNA data sheet, Rev 3.0](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf) and [AN12196, Rev 2.0](https://www.nxp.com/docs/en/application-note/AN12196.pdf).

## A. Minimum hardware and approved scope

- One genuine, UID-visible **NXP NTAG 424 DNA** development tag in factory AES transport configuration. Other Type 2/3 tags, already personalized tags, Random ID tags and unknown key states are refused by this first-tag command.
- One PC/SC reader/driver exposing **ISO/IEC 14443-4 (ISO-DEP) T=1 APDU exchange** to the Mac. It must pass ISO SELECT plus native-wrapped `GetVersion`, `AuthenticateEV2First`, `ReadData`, `WriteData`, `ChangeKey`, `GetFileSettings` and `ChangeFileSettings`, including `91AF` additional frames and short APDUs. Enumeration alone is insufficient. Use one tag in the field; PC/SC cannot prove that a second stacked physical tag is absent.
- One synthetic active fixed-stamp programme at one location, with owner-approved `automatic_fixed` or `staff_confirmed` policy and positive cooldown. QR remains the fallback. No purchase-value points or redemption are awarded from a tap.
- The isolated `looplocal_device_test` database and exact approved `https://preview.getloynara.com` public/auth origin. No real customer or production database may be selected.

## B. Reader preflight

```sh
npm run nfc:reader-check
npm run nfc:reader-check -- --reader "<exact PC/SC reader name from first command>"
```

The second command waits up to 30 seconds for a card and reports reader, PC/SC T=1/ATR, NXP `GetVersion` result and UID. A read-only preliminary pass does **not** establish reliable secure-write compatibility. If required exchanges repeatedly fail on actual hardware, record `UNSUPPORTED_FOR_LOYNARA_PROVISIONING` and use another reader/reference tool; do not bypass validation.

## C–D. First tag, exact command and expected output

Keep `var/device-test.env` and generated keys local and restricted. Obtain the **synthetic** owner user UUID and fixed-stamp programme UUID from the local device-test instance. Do not put passwords or AES keys in CLI arguments or chat.

```sh
NODE_ENV=development npm run nfc:provision -- --env-file var/device-test.env --reader "<exact PC/SC reader name>" --actor-user-id "<synthetic owner UUID>" --program-id "<synthetic fixed-stamp programme UUID>"
```

The CLI refuses production mode, non-loopback/wrong database, origin mismatch and enabled external marketing, billing, registration or Wallet. It checks owner/programme/location, selects the NDEF app, reads `GetVersion` twice across a reconnect, checks factory NDEF settings, prints **non-secret** UID/version/settings/mapping, then requires typing `PROVISION <UID>` before writes. It creates five independent random AES-128 **DEVELOPMENT_ONLY** keys, stores them in ignored `var/nfc-development-keys.json` with mode `0600`, reserves an inactive DB tag, writes NDEF, changes keys 01–04, restricts NDEF/settings writes, changes master key 00, and reads dynamic NDEF twice. It verifies UID, increasing read counter, changing URL, SDM MAC and wrong-key rejection before activation. It makes **no loyalty award** during provisioning.

Expected successful final line: `PASS: tag <UUID> active ... counters <n> -> <n+>`. Treat this as a **software/readback result**, not an iPhone, Android or checkout result. Inspect the DB record with:

```sh
NODE_ENV=development npm run nfc:tag-status -- --env-file var/device-test.env --actor-user-id "<synthetic owner UUID>" --tag-id "<tag UUID>"
```

The URL is `https://preview.getloynara.com/tap/<24-character-random-public-ref>?e=<32 hex>&c=<16 hex>`. `e` is encrypted UID/read-counter data and `c` is the truncated MAC. No key or internal DB ID is in the URL. Offsets are calculated from the encoded NDEF bytes for that exact origin. Configuration: encrypted PICC, key 02 metadata, key 01 SDMMAC, `SDMMACInputOffset = SDMMACOffset`, no `SDMENCFileData`, no public counter retrieval, free read and key-00-restricted write/change.

**Important runtime dependency:** the supplied local key provider rejects `NODE_ENV=production`. The protected compiled device-test web process runs in production mode. This CLI does not change that guard. A physical tag can pass reader verification while the protected web tap route still cannot verify it; Gate 3 cannot pass until an approved production-grade key provider and server route test exist.

## E–F. Physical phones — NOT RUN

After the runtime key-provider dependency is solved, use designated synthetic memberships only. Record tag reference, server revision, device model, OS, browser, times, policy/cooldown, ledger IDs and failures separately for each device.

1. **iPhone:** open/reopen a synthetic card on the physical iPhone, tap the real tag, confirm the exact HTTPS URL opens, membership resolves, and the approved mode yields one confirmed stamp or one staff request. Confirm card/ledger balance.
2. **Android:** repeat on a physical Android phone with its own synthetic card. Verify URL, enrollment continuation, card reopening, programme/location and balance. An iPhone result is not Android evidence.

## G–I. Abuse, cooldown and lifecycle — NOT RUN on hardware

1. Capture one full dynamic URL locally without logging it. Submit that exact URL twice and concurrently: at most one ledger award. Wrong MAC, wrong UID, stale counter, wrong/closed card and cross-location use must fail. Do not send it to third parties.
2. Read a *new* counter within the configured cooldown: no new award. After cooldown, another authenticated tap may award one. Restart/retry must not duplicate ledger entries.
3. Revoke a known tag locally:

```sh
NODE_ENV=development npm run nfc:tag-revoke -- --env-file var/device-test.env --actor-user-id "<synthetic owner UUID>" --tag-id "<tag UUID>"
```

The command shows mapping and requires `REVOKE <tag UUID>`. A revoked tag must never award again. For replacement, provision a **different genuine tag with new keys**, verify it, then revoke the old tag; do not attempt to rewrite a lost tag. Membership balances remain in the ledger. The old replacement helper is not exposed through HTTP because it could revoke the old tag before a new physical tag is ready.

## J. Interrupted provisioning recovery

The CLI keeps non-secret stage/UID/original-settings diagnostics under ignored `var/nfc-diagnostics/`, and key material only in the restricted local store. A caught failure revokes its reserved tag and never activates it. An abrupt process or power loss can leave an inactive `provisioned` DB record; inspect it with `nfc:tag-status` and revoke it with `nfc:tag-revoke` before proceeding. If a key change may have begun, **do not retry factory-key authentication blindly**: inspect the last stage, quarantine the tag, and use recorded development keys with a reviewed recovery procedure/reference NXP tool. If key state is uncertain or master-key authentication fails, keep the DB tag revoked and use a fresh tag. Never print/export keys, turn off the production key-provider guard or claim an uncertain tag usable.

NXP notes that authenticated SDM URLs can be pre-read and used later. Counter/cooldown alone do not prove a contemporaneous purchase; the owner must explicitly approve the fixed-stamp rule and risk, or use `staff_confirmed`. Gate 3 remains **PARTIAL** until real provisioning, both phone types, abuse/restart checks, approved key custody and server/ledger reconciliation pass.
