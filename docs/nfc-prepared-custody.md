# Prepared TAG-01 preview execution

This extends the software correction at `56896167ee2c416c4cbe955f0b82727d558534f1`. It authorizes no physical write or environment mutation. TAG-01 is permanently designated a preview/hardware-acceptance tag; TAG-02–05 remain untouched. Restricted owner evidence holds its UID, custody identifiers and exact proposed binding. No real credentials or physical identifiers belong in Git.

## Contract and key custody

The former preview CLI omitted `keyFactory`, allowing the core to call `generateDevelopmentKeys` during physical execution. That contradicted previously prepared and backed-up custody. The core now requires an explicit key factory; preview execution requires an age-encrypted prepared bundle and approved plan fingerprint. There is no hardware generation fallback. Production still uses its separately reviewed two-master derivation path.

The existing `LOY NARA TAG01 PREVIEW CUSTODY BACKUP v1` bundle supplies five independent development AES credentials, not production masters. Slots 0/3/4 come from the operator-admin payload; slots 1/2 from the preview-verification payload. All new key versions are 1. Current credentials come only from the UID-bound transport payload supported by successful single authentication of each slot. Seller/product provenance, chip identity and directly verified current keys are separate evidence. Seller confirmation is no longer a current-key blocker for TAG-01.

The loader checks restricted owner-only regular files with no symlinks, reads the identity through an inherited descriptor, decrypts ciphertext through age's stdin/stdout and suppresses diagnostic stderr. It creates no plaintext file and never puts keys in arguments. Decrypted output buffers and disposable credential copies are cleared; parsed JavaScript strings remain subject to garbage collection rather than a guaranteed memory wipe. Encrypted custody and the private recovery identity remain outside the repository. The application must receive only slots 1/2 through its development provider, never the combined backup or admin payload.

The normalized deeply frozen plan binds UID, origin, preview classification, fixture IDs/policy, current provenance, ciphertext SHA-256, slot fingerprints/roles/versions, NDEF image and complete settings. Its canonical SHA-256 fingerprint is displayed without UID or credentials. The executor accepts only a branded plan loaded from custody and the exact approved fingerprint. Both CPU simulation and physical execution use this object and the same provisioning/recovery functions. Simulation uses an in-memory tag, journal and repository; the physical transport is forbidden. It is evidence about software behavior, not successful hardware personalization.

## Commands and gates

Prepared CPU simulation (no reader, database or envfile access):

```sh
node --import tsx scripts/nfc-operator.ts provision --target preview --dry-run \
  --prepared-custody-file <private-existing-backup.age> \
  --age-identity-file <private-identity.txt>
```

Future physical command, only after a separate owner write approval:

```sh
node --import tsx scripts/nfc-operator.ts provision --target preview --execute \
  --prepared-custody-file <same-private-backup.age> \
  --age-identity-file <private-identity.txt> \
  --approved-plan-fingerprint <approved-64-hex-fingerprint> \
  --provenance-ref TAG01-transport-auth-verified-20261005 \
  --env-file <approved-preview-operator.env> \
  --reader "REINER SCT cyberJack RFID basis"
```

Type `PROVISION TAG-01 <approved-64-hex-fingerprint>`. Resume uses `resume` instead of `provision`, the identical flags/custody, and `RESUME TAG-01 <fingerprint>`. These commands do not create keys. Missing/corrupt custody, wrong identity, wrong fingerprint, target or optional binding overrides fail closed. Preview execution rejects production markers, non-isolated databases and unsafe side-effect settings. Wrong chip/version/file settings/NLEN, existing reservation or conflicting evidence stops before tag mutation. Current key-0 authentication precedes reservation and writes. Failed authentication is not retried with alternatives.

Reservation is the exact prepared public reference and key reference, with a pending `provisioned` row. Programme/tenant/location, fixed manual stamps, staff confirmation and cooldown must match. Policy is rechecked after confirmation, before reservation, each mutation intent and activation. Reservation and activation enforce expected policy under the programme lock; activation checks UID/reference/key reference as well. No customer effect is possible while the row is pending. Only verified hardware success activates it, with the independently observed read counter as replay floor.

## Mutation order and interruption boundaries

Each group has durable schema-2 intent before mutation and acknowledged stage after verification. Journal metadata includes plan/custody identity, intended slot fingerprints/settings, exact binding and reservation ID. It contains no AES credentials and stays in private ignored `var/nfc-evidence`. Logs use the label and plan fingerprint, not UID or raw APDU ciphertext.

| Phase | Command and expected transition | Checkpoint / verification | Interruption rule |
| --- | --- | --- | --- |
| NDEF staging | Plain `90 8D` WriteData, file 2: NLEN zero; body from offset 2; final valid NLEN | `writing_ndef` before all frames; static readback then `ndef_written` | Unknown frame/commit response quarantines; never assume empty NLEN |
| Keys 1–4 | Authenticated EV2 Full `90 C4`, in order 1,2,3,4; supplied verified current credential to exact prepared key, version 1 | Individual `changing_keyN` / `keyN_changed`; protected response checks; `keys_changed` | First key-1 acknowledgment is first mixed-key state. Lost acknowledgment is unknown, no alternate authentication |
| SDM/access | EV2 Full `90 5F` ChangeFileSettings, file 2: SDM ASCII UID/counter mirroring, metadata slot 2, MAC slot 1, writes/settings key 0 | `changing_settings`; reconnect and complete settings readback; `settings_changed` | Locks down free NDEF writes. Lost acknowledgment quarantines |
| Key 0 last | EV2 First with supplied current key 0; EV2 Full `90 C4` slot 0 to prepared admin key, version 1 | `changing_key0` / `key0_changed`; old session discarded | Factory key-0 state stops being valid; lost response is never probed |
| Final proof | Read-only SELECT/GetFileSettings/EV2 First/new key 0/ReadData, repeated then separate SELECT/read | Full settings, MAC/UID/origin/reference, nondecreasing consecutive counter and advancing independent counter; `readback_verified` | Known acknowledged states only may resume with original custody |
| Activation | Preview-only transaction; pending row becomes active with verified floor | Exact binding/policy under lock; `active` | Hardware is not repeated if activation or evidence is ambiguous |

EV2 authentication (`90 71`, `90 AF`) establishes a transient session; SELECT and reads are not personalization writes. Intrinsic NXP counters can change during authentication/SDM reads. APDU payloads depend on random session challenges and are never printed; the commands above are the exact command families and state transitions, not reusable cryptographic wire bytes.

Before any key rotation, acknowledged static NDEF on factory-access settings is technically reversible with an explicitly approved rewrite. This implementation still quarantines NDEF/partial-key interruptions; it does not automatically restore factory-like state. After the first key change, restoring credentials requires known current keys and a separately reviewed recovery procedure. After settings lockdown, rewriting requires authenticated secure messaging and is not implemented by this plain-write path. Keep both role payloads, current transport evidence and journal.

Only acknowledged `settings_changed`, `key0_changed` or `readback_verified` states permit explicit same-plan resume. `settings_changed` uses only the known original key 0 and rotates it after binding/crypto proof; later states use only the prepared key 0 without rewriting. Pending reservations remain pending for these resumable states. Unknown mutations revoke/quarantine the preview row; malformed/mixed/stale-lock evidence requires review. No fresh retry, journal deletion, key regeneration, factory-key probing or production rebinding is permitted. Host-only restartable states also require review rather than a blind CLI restart.

## Preview and backup prerequisites

A local build or existing synthetic access file does not prove the hosted preview is live, on the expected SHA, migrated or configured for secure taps. Owner-local readiness evidence records the actual HTTP/service/config observations. Required setup is a separate approval packet: compatible code/build, isolated migrations including 0018, exact synthetic fixture IDs from custody, a protected preview verification provider containing only slots 1/2, and pending-to-active registration through this executor. No production infrastructure is required by the architecture. A 403 from the hostname leaves routing/access and the served application unverified; do not change Cloudflare without separate authorization.

The encrypted backup artifact is unchanged. A second directory on the operator disk is not offline. Physical write approval stays blocked until an actual offline copy of ciphertext and protected recovery identity has been independently verified, and the preview acceptance target is ready. This does not block local software correction or CPU simulation.

## Post-write acceptance (all pending)

1. Reader: UID match, full expected file settings, SDM enabled, intended credential and NDEF/crypto/binding proof. Record intrinsic counter behavior and replay floor.
2. iPhone: unlocked physical tap opens the expected preview URL and customer card. Android: same when available; otherwise NOT RUN.
3. Preview: correct synthetic merchant/location/programme; a request appears for the cashier; deliberate confirmation creates exactly one loyalty effect. Repeated/replayed material and repeated confirmation create no duplicate request/award. Owner balance/ledger reconciles.
4. QR: independent customer/cashier fallback still completes normally.

No physical acceptance result is implied by the CPU tests, and TAG-01 remains unwritten until separately authorized.

## Local software validation

The full application suite passed 653 tests with one existing skip. The final focused NFC suite passed 257 tests across 15 files, including the additional permission/symlink, altered-journal and acknowledged-state resume cases. Type checking, full lint and the application webpack build passed with synthetic local settings. Independent review identified reservation-revocation and policy-drift issues; both received regression tests and fixes, followed by review confirming no remaining important issue. The existing real custody bundle also completed the corrected CPU CLI simulation with matching original fingerprints, no replacement keys, no plaintext files and zero physical APDUs. Its backup hash stayed unchanged. The temporary test database was isolated from preview and production and is stopped after verification. The local owner packet records the resulting commit and exact TAG-01 plan fingerprint.
