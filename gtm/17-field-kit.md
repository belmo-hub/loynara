# 17 · Field sales kit and physical stand

Execution layer for the first 60 Kassel walk-ins. Everything lives in [`field/`](field/). Nothing was sent, posted, deployed or written to an NFC tag. The claim system is unchanged: [01](01-product-truth.md) (LIVE NOW / RC READY / FUTURE) and [15](15-copy-switches.md).

## A · Prospects (60, research only)

| File | What it is |
|---|---|
| [`field/prospects.xlsx`](field/prospects.xlsx) | Sheets: *Alle 60*, *FIRST 20*, *NEXT 20*, *FINAL 20* (printable route sheets with empty „Besucht / Ergebnis / Notizen“ columns), *Legende*. Filters and frozen headers |
| [`field/prospects.csv`](field/prospects.csv) | Same data, 37 columns |
| [`field/route.md`](field/route.md) | Day-by-day route tables, the redistribution note and the verification limits |
| [`field/prospect_data.py`](field/prospect_data.py) / `build_prospects.py` | Editable source and generator |

- **22 barbers + 38 pizzerias/Imbiss** (not 30 + 30): only about 22 independent barber-focused shops in Kassel could be confirmed in public sources; many „barbers“ in directories are unisex salons or have no usable data. The 8 extra come from pizzerias/Imbiss. Vertical order is unchanged.
- **Routes:** FIRST 20 = Mitte (Martinsplatz, Treppenstraße, Friedrich-Ebert-Straße) + Nord-Holland (Holländische Straße, Untere Königsstraße): two walkable days. NEXT 20 = rest of Mitte + Vorderer Westen/Wehlheiden (Wilhelmshöher Allee) + Wesertor/Süd (Frankfurter Straße). FINAL 20 = Wilhelmshöhe, Rothenditmold, Kirchditmold, Bettenhausen, Zwehren/Nordshausen and the weakest fits.
- **Priority:** A 16 · B 24 · C 20. **Data confidence:** A 6 (own site read) · B 33 · C 21 (single source or conflicting sources: confirm on the door).
- **Fields per business:** name, category, street, postcode, neighbourhood, opening hours, website, Instagram (only with a stated basis), public phone (landline or business-published), public loyalty programme, paper-stamp-card evidence, digital-loyalty evidence, chain vs independent, locations, owner-operated likelihood, booking/ordering, staff visible, why it fits, strongest angle (canonical ID), likely objection, demo story, best walk-in window, priority, sources, retrieval date, Maps link.
- **Not invented:** no owner names, no private data, no emails collected. **Paper stamp cards cannot be seen online**, so every row says „Not evidenced online. Look at the counter on arrival.“ One shop (Kassler Pizza) publishes a **5 % pickup discount**: noted as a discount, not a stamp card.
- **Quality notes you should know:** directory data is stale in places. „Raby's Barber Shop“ at Ständeplatz 15 shares Ali's phone number, and the Raby's website belongs to a Marburg business; one pizzeria was listed as permanently closed and one as „opening soon“ (both excluded); several shops show conflicting hours (marked). Re-check on the door.

## B · Field collateral (German, print-ready PDF + HTML source)

| # | Asset | File | Status |
|---|---|---|---|
| 1 | One-page merchant handout | none | **Retired** (23 Oct 2026: Sales confirmed the flyer (Marketing) is the only leave-behind) |
| 2 | Founder demo cheat sheet (A4, 1 page) | [`demo-cheat-sheet.pdf`](field/collateral/print/demo-cheat-sheet.pdf) | **Use now** (internal; laminate) |
| 3 | Objection cheat sheet (A4, 2 pages) | [`objection-sheet.pdf`](field/collateral/print/objection-sheet.pdf) | **Use now**. Recovery/correction answers are in the *before-RC* wording |
| 4 | Pilot interest sheet (A4, internal) | [`pilot-interest-sheet.pdf`](field/collateral/print/pilot-interest-sheet.pdf) | **Use now**. „Kein Vertrag, keine Zahlungszusage, kein Startdatum“ |
| 5 | After-demo summary | [`after-demo-summary.html`](field/collateral/templates/after-demo-summary.html) (editable) · [`.pdf`](field/collateral/print/after-demo-summary.pdf) · [`after-demo-message.txt`](field/after-demo-message.txt) | **Send only after a recorded permission** for that channel |
| 6 | Learning sheet | [`learning-sheet.xlsx`](field/learning-sheet.xlsx) (dropdowns) · [`learning-sheet-template.csv`](field/learning-sheet-template.csv) | **Use now** |

Release-gated lines (lost card, mistake correction, „Was, wenn NFC nicht geht?“, the NFC footer) are generated from one file, [`collateral/variants.py`](field/collateral/variants.py). After the gates: `python3 gtm/field/collateral/build_collateral.py --rc --nfc` writes **separate** `print-post/` PDFs and never overwrites the current set.

Print notes: the cheat sheets are for the founder only; the pilot sheet one per interested shop.

## C · Counter stand ([`field/stand/`](field/stand/), spec [`STAND-SPEC.md`](field/stand/STAND-SPEC.md))

One design: **Tresenaufsteller A6**, 122.4 × 92 × 149 mm, 20° tilt, matt-black acrylic base and wedge cheeks, clear-covered A6 face with a pocket for a swappable printed insert, NFC tag hidden behind it centred 56 mm below the top edge (tap zone), QR fallback, merchant brand first and Loynara second. The module lifts out of the cheeks: a replacement tag is a new module (a provisioned tag is never rewritten, per `PHYSICAL_NFC_TEST.md`).

| Deliverable | File |
|---|---|
| Preview (assembled) | `stand/png/stand-pre-nfc_3d.png` · `stand/png/stand-post-nfc_3d_HOLD.png` |
| Pre-NFC artwork (print now) | `stand/pdf/insert-pre-nfc_print-bleed.pdf` · `…_print-cropmarks.pdf` · `svg/insert-pre-nfc.svg` · `png/insert-pre-nfc.png` |
| Post-NFC artwork (**HOLD**) | `stand/pdf/HOLD_insert-post-nfc_print-*.pdf` · `svg/insert-post-nfc.svg` · `png/insert-post-nfc.png` |
| Dimensioned fabrication sheet | `stand/pdf/fabrication-sheet_FS-01-02_A3.pdf` (drawings 1:1, parts, assembly, tolerances, tests) |
| Laser files | `stand/svg/laser-A-3mm.svg`, `laser-B-1.5mm.svg`, `laser-C-2mm-clear.svg` + PDF + DXF |
| Paper prototype at 100 % | `stand/pdf/insert-pre-nfc_actual-size-check_A4.pdf` |
| Back label | `stand/pdf/label-back.pdf` (Stand-ID only, no secrets) |
| QA | `stand/qa-report.md` (28 automated checks) |

**Copy.** Pre-NFC: „Für deine Kundenkarte **QR-Code scannen**“, no NFC wording at all. Post-NFC: „**Handy kurz antippen**“ / „oder QR-Code scannen“, QR stays as fallback. **Only the insert changes physically** when NFC passes.

**QR.** Printed prototypes carry a clearly labelled **placeholder QR** (`https://loynara.invalid/platzhalter`; the `.invalid` domain can never resolve, so no live merchant flow can be opened by accident). When the production demo merchant is approved, regenerate exactly: the insert QR (the demo program's join URL, error correction M), then reprint the insert. Tag provisioning remains a separate operator process.

## D · Ready now vs waiting

| Ready to print or use now | Waits |
|---|---|
| Prospect list and routes · flyer (Marketing) · demo and objection cheat sheets · pilot interest sheet · learning sheet · pre-NFC insert · paper prototype · fabrication files (after the tag-thickness measurement) · after-demo template (permitted channel only) | **RC release:** switch the objection answers for lost card / correction / card number (`--rc`). **NFC acceptance + owner approval:** post-NFC insert and NFC footer line (`--nfc`). **Production demo merchant (D-3):** a real QR, the live-scan demo step. **Commercial gates (O-001, O-011, O-012, O-013, D-1):** any payment, paid-start date or setup on real customer data. **O-014:** QR or links on the flyer |

## E · Open dependencies

1. **Tag thickness is unknown** (not in any repo record). Measure with calipers; it decides the frame (1.5 mm if ≤ 1.05 mm, else 2.0 mm). Build with `build_stand.py --frame 2.0` if needed.
2. **RF is untested through the stack.** First task on the physical prototype: a read-only read at the tap zone (no writes), on three phones, cover 2.0 vs 1.0 mm. No range claim until then.
3. **Fabricator choice, stock thickness and kerf** are open; no price is quoted.
4. **A real spreadsheet application was not available** to open the XLSX files (Numbers automation timed out); they were validated structurally and read back from the CSV sources. The generators rebuild them.
5. **Phone QR scans and the five-person comprehension test** have not been run (a simulation on the artwork decoded down to about 2 px/mm).

## F · QA performed

- 78 / 78 marketing + GTM tests, including `field-kit.test.ts` (60-row list integrity and hygiene; collateral claim safety in the current and the post-gate variants; stand artwork rules).
- Collateral rendered to PDF and checked visually page by page (page counts: 1 / 1 / 2 / 1 / 1). German spelling and „39 €“ formatting reviewed by text search; no banned claim phrases in merchant-facing pages.
- Stand: 28 automated geometry/fit/artwork checks, QR decode simulation (zxing), dimensioned drawings reviewed against the geometry, 3D preview and paper prototype reviewed at size.
- **Not covered:** physical prototype, NFC read test, phone scans, print proof, fabricator fit, Excel/Numbers opening.
