# 11 · Website page strategy

Built on Concept D (`marketing/concept-d`). No Concept E.

**Status:** all pages are built and tested locally, and **unpublished** (O-014). Publishing is a founder decision plus the legal fragments (Impressum and Datenschutz with real operator data, O-001).

**Principles:**
- **No thin SEO pages.** A page exists only if it carries its own example, its own maths, its own objections and its own boundaries. City pages („Stempelkarte Kassel“) and keyword clones („digitale Stempelkarte Friseur“, „Bonuskarte App“) are not built.
- **One price source:** `SITE.price` in `src/site.ts`. No page hard-codes 39; a test enforces this.
- **Every example is labelled** „Beispieldaten“ / „Beispieldarstellung“.
- **The hero never shows NFC, Wallet or messaging.** These appear only in „Ausblick“ sentences or questions (tested in `tests/pages.test.ts`).
- **No scripts are needed on supporting pages:** static HTML, native `<details>` for FAQs.

## Page map

| Page | Status | Search / visit intent | Main angle | Proof on page | Objections answered | CTA | Links to → from |
|---|---|---|---|---|---|---|---|
| `/` (home) | Built (Concept D). NFC wording corrected to QR-first. | „digitale Stempelkarte“, „Kundenkarte ohne App“; people arriving from walk-ins and ads | A1 + A3 + A2 | Interactive demo (customer/counter/owner), calculator `#rechner`, price card | App, NFC (Ausblick), pilot scope, data | Pilot enquiry (mailto) | → all three supporting pages via footer nav; ← every page |
| `/fuer-barber/` | **New, built** | „Stempelkarte Barber“, „Kundenkarte Friseur digital“; barber owners after a walk-in | B1/B2/B3 | Example card „Studio Schnittwerk“ (Beispieldaten), referral pair Deniz→Tim, owner list, break-even at €25 | App, cutting/self-stamping, paper cards, Wallet/NFC (Ausblick), price per chair | mailto „Demo anfragen“, subject „Demo-Anfrage Barber“ | → `/empfehlungen/`, `/#rechner`; ← footer, `/empfehlungen/` |
| `/fuer-pizzerien/` | **New, built** | „Stempelkarte Pizzeria“, „Treuekarte Pizza digital“ | B4/B5/B6 | Example card „Pizzeria da Marco“, multiple stamps in one step, owner list, break-even at €18 | Lieferando (not counted), POS (no integration), family orders, app | mailto „Demo anfragen“, subject „Demo-Anfrage Pizzeria“ | → `/empfehlungen/`, `/#rechner`; ← footer, `/empfehlungen/` |
| `/empfehlungen/` | **New, built** | „Kunden werben Kunden lokal“, „Empfehlungsprogramm Laden“ | A5/D5 | 4-step flow, fairness rules, referral example (Beispieldaten) | Abuse, sharing without visiting, same email, causation („Ob jemand auch ohne Empfehlung gekommen wäre, kann niemand wissen.“) | mailto „Demo anfragen“, subject „Demo-Anfrage Empfehlungen“ | → `/fuer-barber/`, `/fuer-pizzerien/`; ← both vertical pages, footer |
| `/impressum/`, `/datenschutz/` | Built; need real operator data (O-001) | Legal | — | — | — | — | ← footer |

## Next pages (build only when the condition is met)

| Page | Condition to build | Why not now |
|---|---|---|
| `/fuer-cafes/` | 10 barbers + 10 pizzerias live, **and** measured counter scan time from ≥ 3 pilots (`scan_seconds` in the learning log) | Café owners' first objection is queue speed. Without a measured number the page would be thin or would guess. |
| `/fuer-friseure/` (salon) | ≥ 5 salon conversations logged with distinct objections | Today it would be a copy of the barber page. |
| `/so-funktionierts/` or setup guide | First 10 onboardings done, with the onboarding checklist refined | Should be written from real setup questions. |
| `/preise/` | D-1 decided and O-012/O-013 done (VAT, terms) | The price is already on every page. A separate page needs the terms, which don't exist yet. |
| Case pages (`/kunden/...`) | Real merchant, real numbers from `learning-log.csv`, **written permission** | No proof exists. Fabrication is banned. |

## Internal linking rules

1. The footer nav carries „Für Barber · Für Pizzerien · Kunden werben Kunden“ on every page (tested).
2. Vertical pages link to `/empfehlungen/` from their referral section and to `/#rechner` from their price section (tested).
3. `/empfehlungen/` links back to both verticals (tested).
4. No orphan pages. `sitemap.xml` lists all indexable pages (built by `build.mts`).
5. Anchor text describes the destination („So funktionieren Empfehlungen“), never „hier klicken“.

## Ad-to-page mapping (after O-014)

| Ads | Landing page |
|---|---|
| AD-04, 05, 09, 10, 12, 18, 24 | `/fuer-barber/` |
| AD-06, 07, 08, 21, 25, 30 | `/fuer-pizzerien/` |
| AD-09, AD-10 (variant) | `/empfehlungen/` |
| AD-01, 02, 03, 11, 13–17, 19, 20, 22, 23, 26–29, 31, 32 | `/` |

The café ad (AD-20) points to `/` until `/fuer-cafes/` exists.

## Measurement (after publishing)

There is no analytics script today, and none was added; a consent decision is needed first. Until then, measure through:
- The mailto subject line per page („Demo-Anfrage Barber“ / „Demo-Anfrage Pizzeria“ / „Demo-Anfrage Empfehlungen“)
- The question „Wie bist du auf uns gekommen?“ in every first conversation, logged as `source` in `pipeline.csv`

Adding cookieless analytics is a separate founder decision (D-5).
