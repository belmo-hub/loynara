# 11 · Website page strategy

Built on Concept D (`marketing/concept-d`). No Concept E.

**Status:** all pages are built and tested locally, and **unpublished** (O-014). **Not deployed in this pass.** Publishing is a founder decision plus the legal fragments (Impressum and Datenschutz with real operator data, O-001).

**Principles:**
- **No thin SEO pages.** A page exists only if it carries its own example, its own maths, its own objections and its own boundaries. City pages („Stempelkarte Kassel“) and keyword clones („digitale Stempelkarte Friseur“, „Bonuskarte App“) are not built.
- **One price source:** `SITE.price` in `src/site.ts`. No page hard-codes 39; a test enforces this.
- **Every example is labelled** „Beispieldaten“ / „Beispieldarstellung“.
- **The hero never shows NFC, Wallet or messaging.** These appear only in „Ausblick“ / „vorbereitet“ sentences or questions (tested in `tests/pages.test.ts`).
- **Release-gated copy lives in one file.** `src/claims.ts` holds every sentence that changes at the NFC gate or the RC gate, in both versions. The switch is one line, and `tests/claims.test.ts` renders the site under every gate combination ([15](15-copy-switches.md)).
- **Owner screens are pseudonymous**, like the real customer list: „Karte A/B/C“, never customer names (tested).
- **The homepage stays concise.** It carries only the core story ([02](02-positioning-angles.md) homepage rule). The 124-angle library is deployed through supporting pages, ads, scripts, demos and collateral, not homepage sections.
- **No scripts are needed on supporting pages:** static HTML, native `<details>` for FAQs.

## Page map

| Page | Status | Search / visit intent | Main angle | Proof on page | Objections answered | CTA | Links to → from |
|---|---|---|---|---|---|---|---|
| `/` (home) | Built (Concept D). NFC wording corrected to QR-first. | „digitale Stempelkarte“, „Kundenkarte ohne App“; people arriving from walk-ins and ads | CORE-01, -03/-04, -06, -07, -08, -09; ECO-03; TRU-08 | Interactive demo (customer/counter/owner), calculator `#rechner`, price card | App, NFC (Ausblick), pilot scope, data | Pilot enquiry (mailto) | → all three supporting pages via footer nav; ← every page |
| `/fuer-barber/` | **New, built** | „Stempelkarte Barber“, „Kundenkarte Friseur digital“; barber owners after a walk-in | VER-01, ACQ-01, RET-01 | Example card „Studio Schnittwerk“ (Beispieldaten), referral pair Deniz→Tim, pseudonymous card view, break-even at €25 | App, cutting/self-stamping, paper cards, Wallet/NFC (Ausblick), price per chair | mailto „Demo anfragen“, subject „Demo-Anfrage Barber“ | → `/empfehlungen/`, `/#rechner`; ← footer, `/empfehlungen/` |
| `/fuer-pizzerien/` | **New, built** | „Stempelkarte Pizzeria“, „Treuekarte Pizza digital“ | VER-02, VER-03 | Example card „Pizzeria da Marco“, multiple stamps in one step, pseudonymous card view, break-even at €18 | Lieferando (not counted), POS (no integration), family orders, app | mailto „Demo anfragen“, subject „Demo-Anfrage Pizzeria“ | → `/empfehlungen/`, `/#rechner`; ← footer, `/empfehlungen/` |
| `/empfehlungen/` | **New, built** | „Kunden werben Kunden lokal“, „Empfehlungsprogramm Laden“ | CORE-07, ACQ-02, TRU-04 | 4-step flow, fairness rules, referral example (Beispieldaten) | Abuse, sharing without visiting, same email, causation („Ob jemand auch ohne Empfehlung gekommen wäre, kann niemand wissen.“) | mailto „Demo anfragen“, subject „Demo-Anfrage Empfehlungen“ | → `/fuer-barber/`, `/fuer-pizzerien/`; ← both vertical pages, footer |
| `/impressum/`, `/datenschutz/` | Built; need real operator data (O-001) | Legal | — | — | — | — | ← footer |

## Next pages (build only when the condition is met)

| Page | Condition to build | Why not now |
|---|---|---|
| `/fuer-cafes/` | The café evidence trigger in [03](03-verticals.md) has fired, **and** a counter scan time has been measured from real use (`scan_seconds_sampled`) | Café owners' first objection is queue speed. Without a measured number the page would be thin or would guess. |
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
| AD-09, AD-10 (variant), AD-34 | `/empfehlungen/` |
| AD-01, 02, 03, 11, 13–17, 19, 20, 22, 23, 26–29, 31–33, 35, 36 | `/` |

The café ad (AD-20) points to `/` until `/fuer-cafes/` exists.

## Measurement (after publishing)

There is no analytics script today, and none was added; a consent decision is needed first. Until then, measure through:
- The mailto subject line per page („Demo-Anfrage Barber“ / „Demo-Anfrage Pizzeria“ / „Demo-Anfrage Empfehlungen“)
- The question „Wie bist du auf uns gekommen?“ in every first conversation, logged as `source` in `pipeline.csv`

Adding cookieless analytics is a separate founder decision (D-5).

## Claim review of the built pages (2026-10-05)

Every claim on the four pages, checked against LIVE NOW / RC READY / FUTURE ([01](01-product-truth.md)).

| Page | Claim found | Evidence state | Change in this pass |
|---|---|---|---|
| `/` | „Du siehst, wer wiederkommt“, with the owner view listing Lena, Jonas and Aylin | Customer list is pseudonymous | Rows are now „Karte A/B/C“, with the note „Pseudonyme Karten – Namen zeigt Loynara nicht.“ |
| `/` roles strip | „Sieht, wer wiederkommt – und wann es ruhig ist.“ | Day/time pattern is FUTURE | → „Sieht, wer wiederkommt – Stand und Verlauf jeder Karte.“ |
| `/` FAQ NFC | „…zeigen wir als Ausblick“ | QUALIFIED / PREVIEW | → „ist vorbereitet; wir zeigen es als Ausblick“ (owner-approved), gated in `claims.ts` |
| `/` FAQ counter + lost card | Live behaviour, no card number, no reissue | LIVE NOW | Unchanged text, now gated: the RC version is prepared in `claims.ts` |
| `/` price card, FAQ pilot scope | QR entry; NFC in the outlook list | LIVE / QUALIFIED | Gated in `claims.ts` |
| `/fuer-barber/` owner section | „Du siehst, wer wiederkommt. Und wer schon länger fehlt.“; list „Name, letzter bestätigter Besuch“ with names | Pseudonymous; no dormant list in production | → „Du siehst, wie viele wiederkommen. Und welche Karten länger ruhen.“; pseudonymous rows; the dormant list is Ausblick |
| `/fuer-pizzerien/` owner section | „Und wer seit Wochen fehlt … weißt du, wen du vermisst“ | Same | → „Und welche Karten seit Wochen ruhen.“; pseudonymous rows |
| `/fuer-barber/`, `/fuer-pizzerien/` FAQ Wallet/NFC | Ausblick | QUALIFIED / FUTURE | NFC „vorbereitet“, gated |
| `/empfehlungen/` | Referral rules, per-card status labels | LIVE NOW | No change needed |
| All | Price from `SITE.price`, „Beispieldaten“ labels, no proof words | — | Unchanged; tests extended |

