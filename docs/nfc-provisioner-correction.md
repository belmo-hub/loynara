# NFC provisioner correction — local software handoff

Subsequent TAG-01 evidence and the prepared-key preview execution extension supersede this handoff's historical current-key blocker and preview CLI instructions. See [Prepared preview custody](nfc-prepared-custody.md). The sections below describe the original software correction, not current physical write authorization.

Base: `feature/nfc-v1`, `70ecc72349f213f45ead25e6889ab55222fb95aa`. Correction branch: `codex/nfc-provisioner-correction`. The final commit is supplied in the owner handoff rather than recorded inside itself.

Scope: software, CPU chip fixtures and disposable local database fixtures only. No physical tag connection, authentication, write or registration; no production access, production key generation, push or deployment. Physical TAG-01 identifiers remain in owner-local acceptance evidence, outside this repository.

## Root causes and source trace

At the base revision, `src/lib/nfc-provision/flow.ts:36–38` reads file 2 twice consecutively and demands a higher second counter and different URL. The base `production-run.test.ts` fake increments on every read, concealing the contradiction. Correcting only the fake to reuse the counter reproduced six failures after simulated key-0 rotation.

[NXP NT4H2421Gx Rev. 3.0](https://www.nxp.com/docs/en/data-sheet/NT4H2421Gx.pdf), §9.3.1, printed p.35: the first unauthenticated file read increments; consecutive reads of that file can reuse the counter; another intervening command separates observations. §9.3.4, printed p.37: consecutive reads also reuse PICC padding. This supports chunked reads and does not promise a new URL per consecutive read.

The simulated key-0 change was successful. The failure came from the subsequent invalid counter assertion, not stale authentication keys, key version mismatch, or an incorrect key architecture. `src/lib/nfc-provision/flow.ts:130–136` changes key 0 last and records its acknowledgment. `flow.ts:40–50` then authenticates with the new key and verifies three observations: first, consecutive repeated material, and a separate observation after application SELECT. `src/lib/nfc-provision/ntag.ts:140` clears the session after key 0; `ntag.ts:164` reconnect explicitly SELECTs the NDEF application. [NXP AN12196 Rev. 2.0](https://www.nxp.com/docs/en/application-note/AN12196.pdf), §5.16.2 and Tables 25/26, documents the current-key ChangeKey response; CPU tests retain the published EV2/ChangeKey vectors and check that a successful key-0 change discards the old session.

Key 0 remains last because it controls changes to keys and file settings. Known current key 0 stays available until keys 1–4 and SDM/access rights are configured and verified. The core now requires externally supplied current keys, their custody-bound UID, and a provenance reference; there is no hard-coded transport credential or fallback. Failed current-key authentication occurs before NDEF write or reservation. The reference is a manual approval/custody link, not automatic proof of untouched hardware.

## Verification versus loyalty idempotency

The physical proof verifies complete file-2 settings, AES/CMAC, UID, URL origin/reference and positive nondecreasing consecutive counters. SELECT separates the next read, which must advance. Wrong metadata/MAC keys and binding fail. The second independent counter is the activation floor, including on preview; proof URLs cannot be used as customer taps.

Loyalty logic is unchanged. `(tagId,counter)` remains unique, the counter floor blocks old material, and transaction/status guards enforce one ledger award per deliberate cashier confirmation. The added integration regression uses identical cryptographic material for simultaneous requests and confirmations, then replays it after cooldown: one request, one award, balance one. Tag counter reuse does not grant another loyalty effect.

## Journal and recovery

Schema 2 enforces ordered, coherent events and complete environment/custody identity. Each mutation has durable intent before command execution; file and newly created parent directories are flushed. Keys 1–4 each have their own acknowledgment. `settings_changed` represents SDM configured and file writes/settings restricted; `key0_changed` proves the new master transition. Per-UID exclusive locks prevent simultaneous attempts; stale locks require review.

Both mutation APIs require evidence callbacks (types and runtime); fresh execution also requires the previous-state guard. The original verified counters and sample URL are saved before completion. `registrationBundleFromEvidence(events, uid)` can reconstruct that original bundle from coherent completed evidence without a reader, keys, new proof counters or production access. Deliver it locally with `deliverRegistrationBundle(bundle)`. Delivery uses a private temporary file, fsync, rename and directory fsync; a stale delivery lock requires review before removal. This avoids new sample URLs for already-registered chips and leaves server registration behavior unchanged.

| Recorded state | Allowed next action |
| --- | --- |
| No evidence | Fresh execution only after all gates |
| Host preparation, no recorded hardware mutation | Review; fresh CLI restart still refused |
| NDEF intent/staged, partial keys, settings intent | Quarantine; no automatic restart |
| Settings acknowledged, no key-0 intent | Verify SDM, then only the explicitly supplied known current key 0 |
| Key 0 acknowledged / readback verified | Verify with only the derived key 0; no rewrite |
| Any lost key-0 response | Quarantine; never try alternate keys |
| Complete | Fresh provisioning refused; original proof can be exported locally if bundle delivery was lost |
| Mixed, malformed, legacy evidence or stale lock | Recovery review |

Interrupted NDEF frames preserve NLEN=0 until final commit. A lost final response can mean valid NDEF exists, so even that state is quarantined. An acknowledgment lost while changing any key is never inferred from file settings. Preview tags have durable evidence too; automatic preview recovery/rebinding is not implemented.

## Offline mode and execution gates

Provision, resume and revoke default to a static offline plan; `--dry-run` is explicit and conflicts with `--execute`. The mode is resolved before envfile access, DB imports, key generation or PC/SC bridge creation. Subprocess tests intercept module/file/crypto/process boundaries to prove default/dry-run and refused execution cannot reach those paths.

Future execution requires external provenance review, explicit execution, a restricted UID-bound file with all five current keys, valid environment/binding and typed confirmation. A missing/invalid credential is not replaced with a factory guess. Physical TAG-01 provenance remains a separate hard blocker. Backup both masters and operator evidence securely before a future personalization; losing the admin master can remove reconfiguration/recovery capability. No custody files were created by this correction.

## Validation

Validation completed locally:

- Baseline provisioning suite: 45 tests passed. Correcting only the fake's counter reuse produced six failures, reproducing the contradiction before the implementation correction.
- NFC suite: 17 files / 222 tests in the final suite, including CPU provisioning/CLI/file fixtures and isolated PostgreSQL loyalty/registration fixtures. The standalone NFC run passed 221 tests; the additional key-0 session regression passed in the final full run. Final UID/recovery changes also passed a focused 97-test rerun.
- Full repository suite: 81 files passed; 617 tests passed, 1 existing skip. The initial run at a different temporary port had seven billing fixture guard failures; the exact documented local URL resolved them (10 billing tests passed), and the final full suite passed.
- `npm run typecheck`: passed after generating Next's route types through the build.
- `npm run lint`: passed; changed files were checked again after the final UID guard.
- `npm run build -- --webpack`: passed with scrubbed local fixture settings, NFC disabled and no production keys. No deployment.
- Independent review: binding preflight, complete journal identity and parent-directory durability findings were corrected. No protocol assumptions were inferred from a seller listing.

Added regressions cover repeated counters, new-key authentication, crypto/binding rejection, every NDEF frame and key/settings mutation before/after interruption, known-state recovery, uncertain-state quarantine, journal ordering/binding/durability boundaries, offline execution and concurrent loyalty idempotency. Actual reader secure messaging, personalization and post-write iPhone/Android behavior remain untested. The task's temporary test cluster is stopped after verification.

## File manifest

- `src/lib/nfc-provision/flow.ts`, `flow.test.ts`: counter proof, explicit current keys, mandatory evidence, per-key phases, activation floor and known-state recovery.
- `src/lib/nfc-provision/ntag.ts`, `ntag.test.ts`: explicit old-key input, NDEF frame interruption and current-key session regression tests.
- `src/lib/nfc-provision/evidence.ts`, `evidence.test.ts`: coherent UID-bound schema-2 transitions, quarantine, durable journal and per-UID locks.
- `src/lib/nfc-provision/production-run.ts`, `production-run.test.ts`: binding/provenance gates, recovery and original-proof export, interruption matrix and stateful chip fixture.
- `src/lib/nfc-provision/production.ts`, `provenance.ts`: binding schema and explicit custody validation.
- `scripts/nfc-operator.ts`, `nfc-operator.test.ts`: offline defaults, lazy dependencies, execution gates, preview evidence and floor, private bundle delivery.
- `scripts/nfc-operator-mode.ts`, `nfc-operator-mode.test.ts`: pure command-mode resolution.
- `scripts/nfc-operator-keys.ts`, `nfc-operator-keys.test.ts`: restricted UID-bound custody file loading with sanitized errors.
- `scripts/nfc-operator-bundle.ts`, `nfc-operator-bundle.test.ts`: atomic delivery and local recovery tests.
- `src/lib/nfc-lifecycle.integration.test.ts`: concurrent repeated SDM material and exactly-once ledger regression.
- `docs/nfc-v1-runbook.md`, this handoff: updated execution, custody and recovery procedure.
