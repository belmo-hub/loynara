# Concept D – Commercial Polish (handoff)

Branch `marketing/concept-d` from `marketing/concept-c-final` (`8313ce2`). Local commit only; not pushed, not deployed. Concept C stays untouched on its branch (and in preview `283ccc3c`). Legal fragments, publication guard, `_headers`, support address, login URL, €39 single price source, calculator maths, demo/referral state machines and `buildRequest` are unchanged.

## Design decision
One rule for the whole page: **headline + one sentence + one product object + one action**, then breathing room. Every product moment sits on the same soft "counter" surface (a floor line, the physical stand, a real-looking phone) so the page reads as one finished product rather than a set of UI samples. Tabs are kept only where they switch the picture of one object (phone screen: Karte/Wallet; owner question). The two demos are single explicit actions on one phone / one pair of people.

Order: Hero (stand + phone, one "+1 Stempel" cue) → Rollen-Leiste (Kunde · Team · Inhaber, three lines) → An der Theke (one phone, Karte öffnen → Team bestätigt → Stempel wächst → Prämie einlösen, owner consequence below) → Empfehlungen (Lena → Jonas, one evolving picture) → Gestaltung (stand + phone as product photography; Farbe · Marke · Prämie; Karte/Wallet-Vorschau) → Inhaber (Wer kommt wieder? · Wer fehlt? · Wann ist es ruhig?) → Rechner → Preis → Kontakt.

## Taken from tapja (principles, nothing copied)
Product object early and large; one focal point per screen; short copy; one obvious CTA; physical + digital shown together; purchasable price card with a plain inclusion list; confidence through finish instead of qualification boxes. Not copied: code, assets, typography, colour, layout, copy, pricing model, claims, statistics, feature grid, research claims, "21 Länder", "kostenlos", Wallet-first product.

## Facts preserved
Referral rule from the app (`src/lib/referrals.ts`): sharing, opening and joining award nothing; the bonus is booked once when staff confirm the friend's first visit. Wallet = Wallet-Vorschau, stand = Gestaltungsbeispiel, quiet hours / win-back = Plattform-Ausblick with unsent previews, all stated once and locally. 0 % in the calculator shows −39 € / −468 € on a charcoal card. No trial, setup fee, VAT, cancellation, hardware inclusion or acquisition-cost claims (tested).

## Results (Chromium only)
`marketing:test` 53/53 (4 new D tests) · `marketing:verify` pass (normal + public) · guards: public build fails without the Impressum; concepts refused in public mode · `browser-check.mjs` 400/400 (9 widths, both demos incl. new card and no duplicate bonus, studio colours/logos/rewards/Wallet, independence of brand/loyalty/calculator, owner tabs, calculator edge cases, mail encoding, clipboard, print, orientation, 125 % text, reduced motion, no JS) · axe: no violations (8 states) · perf lab: LCP 132–144 ms, CLS 0, TBT 33–37 ms · assets: app.js 90.8 KB (32.6 KB gzip), CSS 34.1 KB (8.5 KB gzip), HTML 39.8 KB.

## Evidence (git-ignored)
`evidence/d/` full pages and first viewports at 320–1440 px; `evidence/d/modules/` every state at 390 and 1440; `evidence/c-vs-d/` identical scene positions for C and D at 390 and 1440; `evidence/d/tapja-*.png` reference captures.

## Preview handoff (not done)
`MARKETING_CONCEPTS=true npm run marketing:build` (keeps /concepts/ A/B/C for comparison) → `npx --no-install wrangler pages deploy marketing-site/site --project-name loynara-marketing --branch marketing/concept-d` as a Preview. Production needs separate approval and a `MARKETING_PUBLIC=true` build without concepts. Support delivery to support@getloynara.com still needs a manual test; Safari/iPhone not run.
