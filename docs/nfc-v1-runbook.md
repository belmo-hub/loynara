# NFC v1 — counter-tag flow, operator procedure, key custody

Status: software implemented and tested locally with synthetic keys. **No physical tag has been written, read-verified or revoked by this work.** Public release is not authorised by this document.

## 1. What the shop and the customer see (staff-confirmed mode)

1. The customer holds the phone to the counter tag. The tag opens `https://<app-origin>/tap/<ref>?e=…&c=…` (encrypted UID + counter, MAC). The server verifies the MAC with the tag's derived key and rejects replayed counters.
2. The tap page resolves the tag to exactly one merchant, location and programme. Outcomes:
   - **Card recognised in this browser:** a pending request is created (or the existing one is re-shown). The customer sees "Warte auf das Team".
   - **No card in this browser:** the page offers "Karte erstellen" (enrolment keeps the tap) and, for a returning customer, a hint to open the saved card link; the tap continues from the card page (`continueTap`).
   - **Tag revoked / unprovisioned / wrong programme / NFC off:** a calm message with the QR alternative; nothing is queued.
3. The cashier screen shows an "NFC-Anfragen" panel (polls, offline-aware, count badge). **Einen Stempel bestätigen** posts the confirm once; **Ablehnen** cancels. Only a cashier/manager/owner of the same tenant and location can act.
4. The customer page polls the same idempotent endpoint and switches to "Stempel erhalten". Reloading is safe: confirmed, expired, cancelled and replayed states each have their own calm text, never an error alert.
5. Exactly one ledger award per request: `tap_requests (tagId, counter)` is unique and confirm is guarded by status; a double click or two cashiers yields one award and `TAP_ALREADY_CONFIRMED` (409) for the second.

States: `pending → confirmed | cancelled | expired`. `automatic_fixed` stays refused on production (`TAP_AUTOMATIC_NOT_ALLOWED`) and its radio is disabled. QR earning is unchanged and remains the alternative.

## 2. Settings and readiness

The owner's "NFC-Tap (optional)" card appears only when the deployment has a usable key provider (`/api/me.hiddenSurfaces` omits `nfc`; the `/tap` pages and APIs 404 otherwise). It shows a **Bereitschaft** line from real data (active / not yet activated / none; ever tapped) and notes when a mode is on without an active tag or off with one.

Capability (`src/lib/nfc-keys.ts#nfcCapability`):

| Deployment | Available when |
| --- | --- |
| Production (`PRODUCTION_ENVIRONMENT=loynara-production`) | `NFC_ENABLED=true`, `NFC_KEY_PROVIDER=derived_v1`, valid `NFC_VERIFY_MASTER_KEY` |
| Development / device-test / preview | derived provider as above, or `TAP_SYNTHETIC_KEY_FILE` |

The production configuration check (`scripts/config-check.ts`) refuses `NFC_ENABLED=true` without the derived provider and a valid verify master, refuses key settings while NFC is off, and refuses `NFC_ADMIN_MASTER_KEY` or `TAP_SYNTHETIC_KEY_FILE` in the production environment.

## 3. Keys

- Per-tag keys are HKDF-SHA256 derived from a master, bound to `(keyRef, UID)`.
- **Verification master** (`NFC_VERIFY_MASTER_KEY`): on the web deployment; derives metadata-read and file-read (SDM MAC) keys only.
- **Admin master** (`NFC_ADMIN_MASTER_KEY`): operator machine only; derives the application master key (key 0) and keys 3/4. The server cannot reconstruct a key that changes a tag; a leaked server cannot rewrite tags.
- Synthetic masters only in tests. Never put either master in chat, a CLI argument, a log or the repository.

### Decision still open (owner decision, not made by this work)

Where the two masters are **kept** and **backed up**:
1. Verify master: a Railway secret on the web service. Needs an owner-held offline backup (lose it → every deployed tag stops verifying and must be re-provisioned).
2. Admin master: an offline/encrypted store on the operator machine or hardware token, with a second custodian or sealed backup (lose it → tags cannot be reconfigured or recovered; they can still be verified and revoked).
3. Rotation: derived keys are tied to the master; rotating means re-provisioning tags. Not designed in v1.
Until this is decided, do not provision real production tags.

## 4. Provisioning model

Two phases so the operator machine never reaches the production database:

1. **Physical (operator machine, reader attached)** — `scripts/nfc-operator.ts`. Execution writes NDEF, changes keys, configures SDM, verifies readback, and saves a registration bundle to private ignored `var/nfc-evidence/<ref>.registration.json`. Without `--execute`, provision/resume print an entirely offline plan: no reader, envfile, keys, or database. Schema-2 evidence flushes each intent before mutation and records each acknowledged key change. Unknown, mixed, legacy, or interrupted write states **stop for recovery review**; no default-key probes or blind restart.
2. **Registration (private Railway console)** — `scripts/operator-register-tag.ts`. Dry run by default. Re-verifies the sample URL with the server's keys, checks tenant/location/programme binding in the database, then registers the tag as active. Preview tags are refused on production and vice versa.

Production physical execution requires `--execute`, `--provenance-ref <reviewed-evidence-id>`, and `--transport-keys-file <private-custody.json>`. The custody file must be a restricted regular file (no symlink or group/world permissions), with `uid` and all five explicit current AES credentials (`key0`, `fileReadKey`, `metaReadKey`, `key3`, `key4`), each encoded as 32 hexadecimal characters. No current credential is assumed by code. A provenance reference identifies external review; it does not prove factory state. Never put actual keys in documentation or command arguments. Prepared TAG-01 preview execution instead requires the existing encrypted custody, private age identity and approved plan fingerprint; see [Prepared preview custody](nfc-prepared-custody.md).

Production additionally requires `--target production`, an approved bare HTTPS origin, validated tenant/location/programme UUIDs and cooldown, separate verification/admin masters held offline from production, and typed `PROVISION <UID>`. Prepared preview execution uses the isolated device-test database and origin guards, exact prepared slot keys, and typed `PROVISION TAG-01 <plan-fingerprint>`. It journals changes before they occur and permits only acknowledged-state, same-plan resume. Preview tags cannot be blindly restarted or rebound to production.

Same-tag lifecycle (additive migration `0018_nfc_tag_lifecycle`): a UID may be re-registered after revocation (partial unique index on live tags), cancelled requests are a valid status.

**Not implemented / unverified on hardware:** authenticated NDEF rewrite of an already-keyed tag, personalization, and acknowledged-state recovery. Preview URLs written to a tag are **not** presumed changeable; reuse for production needs a separately reviewed reconfiguration procedure.

Final verification checks the entire expected file-2 settings (including 256-byte size, SDM offsets and access rights), authenticates once with the new key 0, then drops the session. Two consecutive reads may reuse counter and PICC padding; both must verify with the intended UID, origin and reference. An explicit application SELECT separates the next observation, whose counter must advance. The final verified counter becomes the activation/registration replay floor. This follows NXP NT4H2421Gx §§9.3.1 and 9.3.4, rather than assuming an increment on every read.

Recovery is allowed only from acknowledged `settings_changed`, `key0_changed` or `readback_verified`, with the exact recorded key reference, origin, tenant, location, programme, cooldown and provenance. Configured SDM and binding are read-verified before recovery. `settings_changed` selects the supplied current key 0; `key0_changed`/`readback_verified` select only the derived key 0 and do not rewrite it. Any outstanding key-0 intent means **quarantine**, even if the chip may have completed the change. No alternate credentials are tried. A stale per-UID lock also requires review; never delete evidence to force a rerun.

If completed physical provisioning loses its bundle file, do not run provision or generate new chip proofs. Recover the original verified proof locally with `registrationBundleFromEvidence(await journal.read(uid), uid)` and `deliverRegistrationBundle(bundle)`. Atomic file delivery prevents a truncated bundle from being treated as success. A stale delivery lock also needs explicit review. Keep journal and bundle private even though they contain no AES secrets.

## 5. Read-only reader check (safe; no writes)

```sh
npm run nfc:reader-check
npm run nfc:reader-check -- --reader "<exact reader name from the first command>"
npx tsx scripts/nfc-operator.ts tag-inspect --reader "<reader name>"     # identity + classification + evidence, no keys
```
Expected: PC/SC available, reader listed, with a tag `GetVersion PASS` and the UID. `tag-inspect` prints `condition` (factory / configured / uncertain) and evidence verdict. Neither command authenticates or writes.

## 6. Tag #1 procedure (all steps NOT RUN; each physical write needs explicit approval first)

Before any write report to the owner: target environment and hostname, exact tag identity (UID from `tag-inspect`), the operations (NDEF write, key changes 0–4, SDM config), the recovery path and the key-custody decision (section 3), then wait for approval.

1. Read-only check (section 5); record UID, chip condition, reader name.
2. Offline dry run (no chip inspection or secret requirements):
   `node --import tsx scripts/nfc-operator.ts provision --target production --dry-run`
   This prints the sequence, not an observed tag or an allocated URL/reference. Use the separate read-only inspection evidence to review the physical target.
3. Only after external credential provenance, key custody and a separate owner write approval: run `node --import tsx scripts/nfc-operator.ts provision --target production --execute --provenance-ref <reviewed-evidence-id> --transport-keys-file <private-custody.json> --env-file <operator.env> --reader "<name>" --tenant-id <uuid> --location-id <uuid> --program-id <uuid> --cooldown-seconds 60`, then type `PROVISION <UID>`. Do not repeat after an error. Inspect the journal; production `resume` requires the same explicit flags and binding, plus typed `RESUME <UID>`, and refuses uncertain state. Prepared preview has its own same-plan command and restricted recovery in [Prepared preview custody](nfc-prepared-custody.md).
4. Copy only the registration bundle to the private Railway console; run `operator-register-tag --target loynara-production --actor-user-id <id>` (dry run), then `--execute`.
5. Physical tests: iPhone, Android, new-customer enrolment after tap, returning customer, cashier confirm/cancel, replay of a captured URL, revoked tag. Record per device.

## 7. Local test environments

Everything above was exercised with synthetic masters on a disposable local Postgres: unit and integration tests (derivation, replay, confirm/cancel, lifecycle, registration, provisioning journal with a fake chip) and Playwright `e2e/nfc-flow.spec.ts`. Run with `E2E_NFC_VERIFY_MASTER=<64 hex>` on a dev server started with `NFC_KEY_PROVIDER=derived_v1 NFC_VERIFY_MASTER_KEY=<same value>`.

Software correction evidence and protocol references: [NFC provisioner correction](nfc-provisioner-correction.md). Prepared preview execution: [Prepared preview custody](nfc-prepared-custody.md). TAG-01 current transport credentials were subsequently verified directly in all five slots without mutating APDUs; seller written confirmation is no longer its current-key blocker. This does not authorize personalization. Preview readiness and a verified offline backup remain separate physical-write gates.
