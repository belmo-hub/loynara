# Generic Loynara NFC plaque: one product for every shop

Date: 2026-10-15 · Status: design approved in conversation, spec awaiting review · Nothing built.

## 1 · Goal

One premium, Loynara-branded NFC plaque that is **identical for every shop**, bought in bulk, and bound to a shop only when it is handed over. A customer taps it (or scans its QR) and gets the card of *that* shop, whatever programme type the shop runs (stamps or points).

Success means:

- One print file and one product for all shops; bulk orders need no per-shop work at the factory.
- Each plaque reaches exactly the right shop, with no way for QR and chip to get mixed up.
- Linking is done by the shop owner in about 30 seconds, in person or after shipping by post.
- Stamps and points both work by tap; the cashier confirms every award.
- Shop changes (programme type, a second counter, a lost card, a closed shop) never need a reprint or a chip rewrite.

## 2 · Decisions made (founder, 2026-10-15)

| # | Decision |
|---|---|
| D1 | One generic Loynara product for all shops (branding, bulk purchase) |
| D2 | Handover both in person and by post; one linking flow serves both |
| D3 | Points programmes: tap creates a request, the **cashier types the purchase amount** when confirming |
| D4 | Chip: **NXP NTAG 424 DNA** (signed taps; allows automatic stamps later; already built and audited) |
| D5 | Chip goes in a **chip bay** designed into the plaque (works with any maker); suppliers are also asked whether they can embed genuine 424 DNA themselves |
| D6 | Product: **flat plaque** (wall or counter, adhesive) **plus an optional walnut foot** that holds it upright |
| D7 | Per-plaque QR printed by the factory from a list of plaque numbers (no stickers) |
| D8 | The owner links their own plaque with an activation code from the box |
| D9 | Founder support actions (stock overview, link for a shop, new code, retire) live in the **founder console**, a separate project with its own spec that is built first; the operator CLI commands in §6.3 remain as the fallback |

## 3 · The physical product

### 3.1 Plaque (one SKU)

| | |
|---|---|
| Format | A6 portrait, 105 × 148 mm, corners R 4, total thickness ≈ 6 mm before tape |
| Front | 3 mm satin or frosted cast acrylic (PMMA GS), **reverse-printed** (print on the back, read through the front), white backing layer, polished or laser-finished edges |
| Back | 3 mm walnut (veneered plywood or solid, as the maker proves stable) **or** black acrylic as the fallback, laminated to the front over the full area |
| Chip bay | Ø 26 mm through-hole in the back layer, centred behind the tap ring (52.5 mm from the left, 56 mm below the top edge) |
| In the bay | Genuine NTAG 424 DNA wet inlay Ø 22–25 mm (≈ 0.2 mm), antenna side towards the front, on top a self-adhesive NFC ferrite sheet Ø 25 mm (0.1–0.3 mm) so the plaque still reads when stuck on metal |
| Closing and mounting | 3M VHB foam tape strips on the back (one strip closes the bay); a vent gap so no sealed pocket forms. Optional wall kit: two standoffs in the top corners only (≥ 40 mm from the bay) |
| No-metal rule | No metal, magnets, metallic/silver ink or foil within 15 mm of the bay |

**Why there is no bulge:** the inlay and ferrite sit *inside* the 3 mm back layer, not on top of it. Nothing protrudes from the back plane.

### 3.2 Foot (optional, sold or given per shop)

Walnut block ≈ 120 × 45 × 25 mm with a slot sized for the plaque thickness, leaning it back 15–20°. Felt or silicone underside; optional VHB pad to fix it on the counter. No metal parts.

### 3.3 Artwork (one generic file)

Loynara brand at the top, "Deine Kundenkarte", tap ring with the contactless symbol and "Handy kurz antippen", "oder QR-Code scannen" next to the per-plaque QR, `getloynara.com` small at the foot. **No shop name, no stamp or points wording.** Built with the existing plaque generator (`gtm/field/stand/plaque.py`, a new `generic` variant). The QR area is a variable-data field filled by the factory. This replaces the per-merchant artwork and the on-the-back 28 × 28 on-metal tag of the uncommitted `gtm/field/stand/PLAQUE-SPEC.md` (its VHB mounting and sign-shop notes still apply).

**Per-plaque QR (factory-printed):** payload `https://app.getloynara.com/p/<plaque number>`, error correction M, the plaque number printed small under it (e.g. `K7QM-3XPA`). We send the factory only the list of plaque numbers.

## 4 · Identity: one plaque, one row

Every plaque is one row in `secure_tags`, carrying two identifiers that are created and paired at the desk:

| Identifier | Where it appears | Purpose |
|---|---|---|
| `plaque_no` (new): 8 characters, Crockford base32, random, shown as `XXXX-XXXX` | Printed QR (`/p/<plaque_no>`), activation card, owner dashboard, stock lists | Human and QR identity |
| `public_ref` (existing): 24 random characters | Only inside the chip URL `/tap/<public_ref>?e=…&c=…` | Signed tap identity (keys are derived from `public_ref` + chip UID) |

The chip never contains a shop, location or programme. The shop is only the `location_id` on the row.

## 5 · Data model changes

`secure_tags`:

- New status **`stock`** = verified and free, not linked. Lifecycle: `provisioned` (desk write in progress) → `stock` → `active` (linked to a location) → `revoked` (retired forever). `replaced` stays for history.
- `tenant_id`, `location_id`, `program_id` become **nullable**. Check: `status in ('provisioned','stock')` ⇔ `tenant_id is null and location_id is null`; `status = 'active'` ⇒ both set.
- `program_id` is no longer written for new plaques (kept for history). **A tap resolves the location's active programme at tap time** (there is exactly one active programme per location: `programs_one_active_per_location_uq`).
- New columns: `plaque_no varchar(8) unique`, `batch_id varchar(32)`, `linked_at timestamptz`.

New table `plaque_numbers` (numbers generated for a factory order before any chip exists): `plaque_no` PK, `batch_id`, `status in ('planned','used','void')`, `created_at`. The desk tool only accepts scanned numbers that are `planned` in the expected batch.

New table `plaque_activation_codes`: `tag_id` PK → `secure_tags`, `code_hash` (scrypt or HMAC-SHA256 with a server pepper), `attempts`, `locked_until`, `used_at`, `issued_at`. A reissue replaces the row.

Migration of existing tags: rows with status `active` keep their tenant/location and become linked plaques; `plaque_no` stays null for them (they are not part of the generic programme). `provisioned` rows that were never activated are revoked.

## 6 · Flows

### 6.1 Factory order (once per batch)

1. `npm run nfc:batch-new -- --batch B-2026-11 --count 200` generates 200 random plaque numbers into `plaque_numbers` (status `planned`) and writes `var/batches/B-2026-11/qr-list.csv` (number, QR payload). No secrets in it.
2. The CSV goes to the factory with the generic print file; they print one QR per plaque.

### 6.2 Desk setup (per plaque, ≈ 1 minute)

Hardware: PC/SC reader (ACR1252U candidate), USB barcode scanner (keyboard mode), the Mac with the operator environment.

`npm run nfc:stock -- --batch B-2026-11` (one typed confirmation for the whole session, e.g. `STOCK B-2026-11`):

1. Insert inlay + ferrite into the bay (if the factory did not embed the chip).
2. Scan the plaque's printed QR with the barcode scanner → the tool reads `plaque_no`, requires it to be `planned` in this batch.
3. Place the plaque face down on the reader. The tool requires a genuine factory-blank NTAG 424 DNA: `GetVersion`, factory NDEF settings, factory key authentication, and the **NXP originality signature** (`Read_Sig`, verified against NXP's published public key; new check).
4. It generates `public_ref`, writes the NDEF/SDM configuration and the derived keys (existing provisioning code, without `--program-id`), reads back twice, verifies MAC, counter and wrong-key rejection (existing checks), then stores the row as `stock` with `plaque_no` and `batch_id`, marks the number `used`, and creates an activation code (hash stored, plaintext kept only in the session's card file).
5. "Next plaque". Any failure stops that plaque, revokes its reserved row, leaves the number `planned`, and keeps the plaque out of stock (existing interrupted-provisioning rules apply).
6. At the end: `var/batches/B-2026-11/activation-cards.pdf`, A4 sheets of cards "Aufsteller K7QM-3XPA · Code HX4-92K-PL7 · 1. Anmelden 2. Antippen 3. Code eingeben". File mode 0600; print, then delete. Codes are never shown again (reissue instead).

Close the bay with the VHB strip, put plaque + matching card + German one-page guide into the sleeve.

### 6.3 Activation by the owner (in person or by post)

1. The owner signs in to the dashboard on their phone and opens **Aufsteller → Aktivieren**, or simply taps the plaque / scans its QR while signed in (a `stock` plaque opens the activation form for signed-in owners, prefilled with the plaque number).
2. They enter the code from the card and choose the location (preselected if the tenant has one).
3. Server (one transaction): owner role on the tenant, location belongs to the tenant, plaque is `stock`, code matches in constant time, attempts within limits → set `tenant_id`, `location_id`, `status = 'active'`, `linked_at`, mark the code used. If the location's active programme has `tap_mode = 'disabled'`, set it to `staff_confirmed` with a default cooldown (none exists in the code today; the owner settings card requires typing one): **3600 s for stamp programmes** (one stamp per visit), **60 s for points programmes**. The owner can change it afterwards in the existing "NFC-Tap" settings card.
4. Confirmation screen: "Aufsteller K7QM-3XPA ist jetzt mit <Standort> verbunden" with a "Jetzt testen" hint.

Support fallback (operator CLI, no web admin): `nfc:plaque-link --plaque K7QM-3XPA --tenant … --location …`, `nfc:plaque-code --plaque K7QM-3XPA` (reissue), `nfc:plaque-retire --plaque …`. Same guards and confirmation pattern as the existing operator commands.

### 6.4 What a customer gets

| Plaque state | Tap (NFC, signed) | QR scan (`/p/<plaque_no>`) |
|---|---|---|
| `stock` | "Dieser Aufsteller wird gerade eingerichtet"; signed-in owner → activation form | same |
| `active`, stamp programme | Existing flow: pending request → cashier confirms → +1 stamp | Opens the customer's card for that location, or the join page; **never awards** |
| `active`, points programme | Pending request → cashier **types the amount** → points at the programme's rate | Same as above |
| `active`, no active programme or tap disabled | Calm message + link to the card/QR; nothing queued | Card or join page if a programme exists, else "pausiert" |
| `revoked` | "Dieser Aufsteller ist nicht mehr aktiv" | same |

Existing rules stay: counter replay refused, cooldown per card, `automatic_fixed` refused on production, pending requests expire.

### 6.5 Points tap with amount

- `setTapPolicy`, `provisionSecureTag`, `processSecureTap`, `confirmTapRequest` currently require `type = 'stamp'` and `earning_mode = 'manual'` (`src/lib/secure-tap.ts:75, 90, 155, 287`). Points programmes (`earning_mode = 'purchase'`) are allowed **only with `staff_confirmed`**.
- The cashier's NFC panel shows an amount field for points requests (major units with decimals, the location's currency). Confirm books through the existing purchase-award path (`awardInTransaction` with the purchase amount; `purchase_awards` row with the rule version and applied rate), idempotency key `tap:<tag>:<counter>`, actor = confirming staff, exactly as a stamp confirm.
- Limit per tap request: `MAX_TAP_PURCHASE_MINOR = 50000` (500.00); larger purchases go through the normal cashier screen. Amount must be ≥ 0.01.

### 6.6 Owner dashboard: "Aufsteller" page

List of the location's plaques: number, status, linked since, last tap (from `last_counter > 0` and the latest `tap_requests.created_at`). Actions: **Aktivieren** (§6.3) and **Deaktivieren** (two-step confirmation; sets `revoked`, irreversible; pending requests of that plaque are cancelled). Shown only when the deployment has NFC capability (existing `hiddenSurfaces` gate).

## 7 · Safety

- Plaque numbers random (40 bits), never sequential; activation codes ≥ 45 bits, single use, stored hashed, 5 attempts per plaque per hour plus the existing per-user and per-IP limits; lock after 20 failures until an operator reissues.
- The factory receives only plaque numbers and the print file. Keys, activation codes and chip UIDs never leave the operator environment.
- Only factory-blank, NXP-original 424 DNA chips are accepted at the desk (§6.2 step 3).
- No award without a signed tap **and** a cashier confirm. QR scans and `stock` plaques never award.
- Deactivation is irreversible; a returned plaque is not re-linked to another shop in v1 (simpler audit trail; the chip is cheap, the plaque is retired or reworked with a new chip by the operator).
- Never printed on any part: chip UID, keys, `public_ref`, tap URLs, activation codes (codes only on the separate card).

## 8 · Special cases

| Situation | Behaviour |
|---|---|
| Shop switches stamps ↔ points | Nothing to do; the tap follows the location's active programme |
| Two counters in one location | Several active plaques per location are allowed |
| Owner lost the code card | Operator reissues a code (`nfc:plaque-code`) |
| Plaque damaged, stolen or shop closes | Owner or operator deactivates; a new plaque for a continuing shop |
| Scanned number not in the batch / already used | Desk tool refuses; plaque set aside |
| Chip fails verification at the desk | Row revoked, number stays `planned`; a new inlay in the same plaque may be tried |
| Owner of tenant A tries a plaque already linked to tenant B | Refused ("bereits verbunden"); no information about tenant B shown |

## 9 · Testing

Automated (existing test setup: Vitest, isolated Postgres):

- Activation: correct code links; wrong code counts attempts; lock; used code; wrong tenant/location; plaque already active; plaque revoked; concurrent activations of one plaque (exactly one wins).
- Resolution: tap and QR for every state in §6.4; programme switched after linking; no active programme; tap disabled.
- Points tap: amount required, bounds, rate and rounding as `purchase_awards`, idempotent confirm, two cashiers → one award, cooldown.
- Migration: existing active tags still tap and confirm exactly as before.
- Desk tool against the existing mock reader sequencing: happy path, non-blank chip, originality failure, read-back failure, interrupted write, number not planned.

Physical acceptance (before any bulk order): one sample plaque through desk setup → activation → taps on one iPhone and one Android phone → stamp confirm and points confirm → deactivation; read distance through the front recorded; reads on a steel sheet with the ferrite in place.

## 10 · Build order

1. Server: schema and migration (§5), tap/QR resolution by location (§6.4), `/p/<plaque_no>` route.
2. Activation (API + owner "Aufsteller" page, §6.3, §6.6) and operator CLI fallbacks.
3. Points tap with amount (§6.5).
4. Desk tools: `nfc:batch-new`, `nfc:stock` with barcode input, originality check, activation-card PDF (§6.1–6.2).
5. Generic plaque and foot artwork; supplier request (Appendix A).

In parallel, now: order the reader, 10 NTAG 424 DNA inlays and ferrite sheets; send the supplier request for samples.

## 11 · Out of scope (v1)

- Automatic stamps without a cashier (possible later with 424 DNA; stays refused on production).
- Re-linking a deactivated plaque to another shop.
- A Loynara web admin console.
- Merchant logos on the plaque (the plaque is Loynara-branded by design).

## 12 · Open items

- Tag-to-front read distance with a 3 mm front and the ferrite; iPhone and Android.
- Walnut-on-acrylic lamination stability (maker to prove; black acrylic back as fallback).
- Supplier answers on embedding genuine 424 DNA, minimum order, unit price and lead time.
- Confirm the default cooldowns from §6.3 (3600 s stamps, 60 s points) with a pilot shop.

## Appendix A · Supplier request (English)

> We are looking for a manufacturer for a premium NFC plaque, 200–500 pieces, samples first (2–3 pcs).
>
> **Plaque:** A6 portrait, 105 × 148 mm, R4 corners. Front: 3 mm satin/frosted cast acrylic, reverse UV print (CMYK + white backing), one generic design (file supplied), plus **one unique QR code per plaque** from our list (variable data, error correction M, number printed under the QR). Back: 3 mm walnut (or black acrylic if walnut lamination is not stable), laminated to the front. **Ø 26 mm through-hole in the back layer** at a given position (chip bay). No metal, metallic ink or foil.
>
> **Chip:** please quote two options: (a) the bay left empty (we insert the chip), (b) you embed a **genuine NXP NTAG 424 DNA** inlay with a ferrite sheet in the bay, **delivered unencoded with factory default keys** (no URL written, no keys changed). For (b) please state the inlay make/model and confirm NXP origin.
>
> **Foot (optional):** walnut block approx. 120 × 45 × 25 mm with a slot holding the plaque at 15–20°, felt underside, no metal.
>
> **Please send:** unit prices at 200 / 500 / 1000, sample price and lead time, production lead time, packaging options (individual sleeve), shipping to Germany.
