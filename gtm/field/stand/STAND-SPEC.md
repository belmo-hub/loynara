# Loynara Tresenaufsteller A6: specification

**One design.** A compact tilted counter stand: a clear-covered A6 face with a pocket for a swappable printed insert, a hidden NFC tag behind it, on a matt-black base with two wedge cheeks. Example merchant on all artwork: **Take a Piz**, a clearly labelled example, not a Loynara customer.

Status of this specification: **mechanical and visual only.** The NFC tag (TAG-01) has **not** been written, programmed, authenticated or provisioned, no key was generated or handled, and no RF performance is claimed. Whether the stack reads reliably is the first thing the prototype test must establish.

Evidence date: 2026-10-05. All numbers come from `geometry.py`; drawings, cut files and the QA are generated from it (`python3 gtm/field/stand/build_stand.py`).

## 1 · What the stand does for the customer

| Goal | How the design delivers it |
|---|---|
| Understood in under 2 seconds | One instruction in large type. Pre-NFC: **„Für deine Kundenkarte QR-Code scannen“**. Post-NFC: **„Handy kurz antippen“ / „oder QR-Code scannen“** |
| Merchant brand first, Loynara second | Merchant logo/name top band (largest type on the face); Loynara is a small mark at the bottom |
| Clear tap zone | Post-NFC: a Ø 45 mm peach ring with the contactless symbol and „HIER ANTIPPEN“, centred exactly over the tag |
| QR fallback | Always present: 44 mm now, 31 mm after NFC acceptance |
| No technical NFC language for customers | „antippen“, never „NFC“, on the face |
| Loyalty context | Mini stamp row + „Bei 10 Stempeln: [Prämie]“ and „Dein Team bestätigt jeden Besuch.“ |
| No overcrowding | Five text elements, one QR, one illustration row |

## 2 · Dimensions

| | mm |
|---|---|
| **Overall** | **122.4 wide × 92 deep × 149 high** |
| Footprint | 122.4 × 92 (about the size of an A6 postcard lying flat) |
| Module (face assembly) | 112 × 150 × 6.5 (cover 2.0 + frame 1.5 + back plate 3.0) |
| Tilt | **20° back from vertical** (face normal 20° above the horizontal) |
| Module bottom edge above base | 8.0 front / 5.8 rear (a deliberate floating gap) |
| Insert | A6 portrait **105 × 148**, 3 mm bleed (111 × 154 print file) |
| Insert pocket | 105.6 × 148.5 (0.3 mm per side, 0.5 mm height clearance) |
| Thumb notch (cover top) | R 9 |
| Corner radii | module R 4 · base R 6 |
| Rubber feet | 4 × Ø 10 × 2, silicone, self-adhesive |

**Viewing angle.** A face tilted 20° back sits about 20° off the line of sight of a standing customer 50–80 cm away who looks down at the counter. This is why the headline is placed in the lower half and the tap zone at 56 mm from the top: the phone is pressed against the upper-middle of the face, where the stand is most stable.

**Stability.** Estimated centre of mass about 42 mm from the front edge of a 92 mm base, total mass ≈ 0.18 kg (estimated from acrylic density). Rubber feet are required. No tip or slide test has been run.

## 3 · Parts and materials (first pilots, no custom tooling)

| ID | Part | Qty | Material | Size |
|---|---|---|---|---|
| B1 | Base plate | 1 | 3.0 mm PMMA GS, matt black (or satin dark) | 122.4 × 92 |
| C1 | Cheek | 2 | 3.0 mm PMMA GS, same | 84 × 82.9 |
| R1 | Back plate | 1 | 3.0 mm PMMA GS, same | 117.6 × 150 (with tabs) |
| F1 | Spacer frame | 1 | **1.5 mm** PMMA/PETG dark (**2.0 mm** if the tag is thicker; rule below) | 112 × 150 |
| D1 | Cover | 1 | 2.0 mm PMMA GS clear (1.0 mm as a test alternative) | 112 × 150 |
| I1 | Insert | 1 | 300–350 g/m² coated matt card, or 0.3 mm synthetic PET/PVC | 105 × 148 |
| T1 | NFC tag | 1 | PVC on-metal sticker 28 × 28, NXP NTAG 424 DNA (NFC-Tag-Shop.de / NFC21 GmbH, product 17156) | 28 × 28 |
| E1 | Feet | 4 | Silicone, Ø 10 × 2 | |
| L1 | Back label (optional) | 1 | Vinyl or paper label | 56 × 26 |

**Frame thickness rule (the tag thickness is not in any record, measure it):**
Frame 1.5 mm if the tag is ≤ 1.05 mm · frame 2.0 mm if ≤ 1.55 mm · frame 3.0 mm if ≤ 2.55 mm. The pocket must hold the tag **and** the 0.35 mm insert with 0.1 mm to spare. Rebuild with `python3 gtm/field/stand/build_stand.py --frame 2.0`; the cheek slits follow automatically.

Alternatives with the same outer geometry (fabrication choice, not new designs): a 3D-printed (PETG) base-and-cheek body with the same slits, or a stiff-card prototype of the module for paper tests only.

## 4 · Construction

- **Module** (cover + frame + back plate) is solvent-cemented into one piece. The insert slides into the pocket from the **open top**. Swapping Pre ↔ Post artwork needs no tool.
- **Cheeks** hold the module through a slanted open slit (3.2 mm) in which the back-plate tabs sit. Cheeks are glued into the base slots. The module is **not** glued to the cheeks: it can be lifted out upwards.
- **Why:** a provisioned tag is never rewritten. A replacement tag is a **new module**, and the old tag is revoked by the operator process (see `PHYSICAL_NFC_TEST.md`). A removable module makes that a one-minute swap.

## 5 · Tag mounting and what to keep away from it

- The tag is stuck **adhesive side down onto the back plate**, tag face toward the phone, inside engraved corner marks (29 × 29), centred 56 mm below the top edge.
- Between the phone and the tag: 2.0 mm cover + 0.35 mm insert + the air gap left in the pocket. These are test variables (cover 1.0 / 2.0 mm, frame rule above).
- **Metal-free zone:** at least 15 mm around the tag in every direction: no metal, magnets, metal screws, metallised foil, metallic ink, hot-foil, mirror acrylic, or metal core in the insert. Fasteners are solvent cement only. This is a precaution for an on-metal tag with a ferrite back; it is not a performance claim.
- **Never print or engrave** a tag UID, key, URL token or any secret on any part. The back label carries only a free **Stand-ID** (`ST-…`) and a location name.

## 6 · Artwork

| | |
|---|---|
| Format | PDF with embedded fonts (Manrope) and SVG source. Colours: deep green `#143D2E`, band `#19493A`, light text `#F6F3EC`, peach `#F2A078`. Convert to CMYK in the print shop's workflow; request a proof |
| Bleed / trim | 111 × 154 with bleed, 105 × 148 trim; crop-mark version 125 × 168 |
| Safe zone | Text and QR at least 6 mm inside the trim |
| QR | Placeholder payload `https://loynara.invalid/platzhalter` (the `.invalid` top-level domain cannot resolve, so the code can never open a live flow), error correction **M**, 29 × 29 modules. Pre: 44 mm (1.52 mm/module) on a 56 mm white card with a 6 mm quiet zone. Post: 31 mm (1.07 mm/module) on a 39.6 mm card |
| Labels | „Platzhalter-QR · führt nirgendwohin“ under the QR; „Beispiel-Gestaltung · Take a Piz ist kein Loynara-Kunde“ at the foot |
| Insert paper | Matt coated card or synthetic; no metallic inks or laminates near the tag |

## 7 · Copy: pre-NFC (print now) and post-NFC (hold)

| Element | **PRE-NFC-ACCEPTANCE** (file `insert-pre-nfc`) | **POST-NFC-ACCEPTANCE** (file `insert-post-nfc`, **HOLD**) |
|---|---|---|
| Tap/QR zone over the tag | White QR card 56 × 56 with the QR 44 mm | Tap ring Ø 45 mm, contactless symbol, „HIER ANTIPPEN“ |
| Headline | „Für deine Kundenkarte“ / „QR-Code scannen“ | „Handy kurz antippen“ |
| Sub line | „Die Karte öffnet sich im Browser. Ohne App.“ | „oder QR-Code scannen“ |
| QR | Primary, 44 mm | Fallback, 31 mm, lower right |
| NFC wording on the stand | **None** | „antippen“ only |

**Switch when NFC acceptance passes (and the owner approves):** print `HOLD_insert-post-nfc_print-*.pdf`, drop it into the pockets of the already-installed stands (the tag is already behind the same spot). **Nothing else changes physically.** Drop the `HOLD_` prefix in the file name when released. Also switch the website and collateral per `gtm/15-copy-switches.md`.

## 8 · What must be regenerated when the production demo merchant is approved (D-3)

1. **Insert QR:** encode the demo merchant's real program join URL (the QR/link shown on the owner's program page), error correction M, same sizes. Edit `PLACEHOLDER_URL` in `artwork.py`, rebuild, reprint the insert. Nothing else changes.
2. **Remove** the „Platzhalter-QR · führt nirgendwohin“ line; keep the „Beispiel-Gestaltung“ line until the merchant has approved its name and logo on the stand.
3. **Tag:** provisioned only by the separate operator process after RC rehearsal and production approval; never by this work.
4. **Stand-ID** on the back label: filled by hand and recorded with the tag mapping by the operator.

## 9 · Test plan before any series (founder, prototype)

1. Read-only NFC read of the **unprovisioned** tag through the finished stack with a plain reader app (never write): record the working distance in mm on at least three phones (iPhone and Android). Compare cover 2.0 mm vs 1.0 mm and frame rule. No RF statement is made until this is done.
2. Same read on a metal counter, next to a card terminal, and on the pilot shop's real counter.
3. Print `insert-pre-nfc_actual-size-check_A4.pdf` at 100 %, scan the placeholder QR at 20/30/50/80 cm with three phones.
4. Five-person comprehension test from normal counter distance: what do they do first?
5. Handling: insert in/out, module in/out, a water splash at the top edge, a drop from counter height, 100 insert swaps.

## 10 · Files (`gtm/field/stand/`)

| Group | Files |
|---|---|
| Print masters | `pdf/insert-pre-nfc_print-bleed.pdf`, `…_print-cropmarks.pdf` · `pdf/HOLD_insert-post-nfc_print-*.pdf` · `pdf/label-back.pdf` |
| Vector sources | `svg/insert-*.svg`, `svg/label-back.svg` (fonts embedded; open in a browser, print via PDF) |
| Laser files | `svg/laser-A-3mm.svg` (3 mm), `svg/laser-B-1.5mm.svg`, `svg/laser-C-2mm-clear.svg`, matching `pdf/` and `dxf/` (red = cut, blue = engrave; DXF is a convenience export, verify on import) |
| Fabrication sheet | `pdf/fabrication-sheet_FS-01-02_A3.pdf` (drawings 1:1 + parts, assembly, tolerances, tests) |
| Previews | `png/stand-pre-nfc_3d.png`, `png/stand-post-nfc_3d_HOLD.png`, `png/insert-*.png`, `png/fabrication-sheet-*.png` |
| Paper prototype | `pdf/insert-pre-nfc_actual-size-check_A4.pdf` |
| QA | `qa-report.md` (28 checks), `qa.py`, `decode.mjs` |
