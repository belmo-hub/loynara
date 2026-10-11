# Concept C – final production candidate (handoff)

Branch `marketing/concept-c-final`, from `marketing/clean-concepts` (`4307090`, the commit deployed as the A/B/C preview `3e192272`). Concept A/B/C prototypes still build with `MARKETING_CONCEPTS=true` and stay untouched for comparison. Local commit only: not pushed, not deployed. Legal fragments, `_headers`, publication guard, support address, login URL and the single price source are unchanged.

## What the default page now says without a single click
Hero: *Digitale Kundenbindung für dein Geschäft: Kunden sammeln Prämien ohne App, dein Team bestätigt jeden Besuch und Empfehlungen bekommen einen klaren Ablauf.* Directly above the product stage (same section, not a new one): three always-visible lines **Besuche belohnen · Empfehlungen fördern · Kundenaktivität verstehen** and the flow **Kunde öffnet Karte → Team bestätigt → Fortschritt wächst → Empfehlung kann folgen**. The tabs are introduced as "Zeig mir, wie das funktioniert". The referral rule (Geteilt → Teilnahme offen → Bedingung erfüllt → Bonus verbucht) also has its own short scene. Owner value, stand/branding, price and the next step are visible in the default state (checked by `browser-check.mjs`, by test, and by the text of the page minus hidden tab panels).

## Referral semantics (from the application, not inferred)
`src/lib/referrals.ts`: a referral is attributed when the friend joins (pending); `qualifyReferralOnAward` books the bonus only when staff confirm the friend's first earning visit, once (idempotent), for the referrer and optionally the friend; same verified e-mail goes to owner review. Sharing, opening and joining award nothing. The demo mirrors this with `src/ref.ts` (unchanged) and says "Teilen, Öffnen oder bloßes Anmelden bringt keinen Bonus". No acquisition-cost, "kostenlos" or rate claims anywhere (tested).

## Changes by area
- **Hero:** same headline; one composition (stand + customer card + "Besuch bestätigt" note); primary "Demo anfragen" scrolls smoothly to the contact section (never opens mail); secondary "Ablauf ansehen"; "Anmelden" is a quiet text link. Mobile: headline, explanation, primary CTA and the top of the card are in the first viewport at 320–430 px.
- **Stage:** tabs Besuch · Prämie · Empfehlung (Überblick lives in the owner scene); one card and one action per view; owner consequence as one line under each action; reset per view.
- **Studio:** default Tresen & Karte (stand + card, "Gestaltungsbeispiel"); Wallet-Vorschau is a deliberate second view ("nicht eingerichtet"). Controls: Farbe (5), Marke (3), Prämie (select). One brand state recolours stand, card and Wallet; it never touches stage, referral, owner or calculator. Page memory only; no upload, no storage, no request.
- **Owner:** Überblick (pilot) · Ruhige Zeiten · Zurückholen (Plattform-Ausblick, unsent preview); each panel one idea, no counters grid.
- **Calculator:** maths untouched (`src/calc.ts`); vertical label / value / slider; one dominant result; 0 % shows 0 €, −39 €, −468 € on a charcoal card with "Bei dieser Annahme übersteigt die Monatsgebühr den Zusatzumsatz."; ratio only in the details; invalid input blanks the result.
- **Offer:** price card + "Aktuell enthalten" next to a separate "Gezeigter Ausblick · gesondert zu vereinbaren" band; six FAQ answers; no trial/setup/cancellation/VAT/hardware claims.
- **Contact:** Geschäft · Branche (optional) · Kurze Nachricht (optional) → "E-Mail vorbereiten"; explanation "Deine Anfrage wird in deinem E-Mail-Programm geöffnet. Gesendet wird sie erst dort."; "Anfrage senden → wir melden uns → Demo am Beispiel deines Geschäfts" (no response time); copy fallback; opt-in calculator figures; direct support address. `buildRequest` unchanged.
- **Code:** `template.ts`, `src/final.ts`, `src/final-parts.ts`, `final/final.css` replace the compact-v3 UI (`views.ts`, `browser.ts`, `styles.css` removed). Motion's `animate` remains the only motion engine.

## Results (Chromium only)
`marketing:test` 49/49 · `marketing:verify` pass (normal and public) · guard: public build fails without `legal/impressum.html`, concepts refused in public mode · `browser-check.mjs` 377/377 · axe: no violations in 8 states · perf lab: LCP 144–156 ms, CLS 0, TBT 37–38 ms · assets: app.js 86.9 KB (31.7 KB gzip), CSS 31.3 KB (7.7 KB gzip), HTML 41.7 KB, fonts unchanged (was app.js 106.7 KB, CSS 54.9 KB). Page height 390 px: 11.6k; 1440 px: 9.0k (A: 8.7k / 6.3k).

## Not verified / handoff
- Support delivery and reply (`support@getloynara.com`) still need an external manual test; no test mail was sent. CTA clicks are not conversions.
- Safari/WebKit and a physical iPhone have not been run (`SAFARI_CHECKLIST.md`).
- Wallet-Vorschau and stand are stylised design examples; the pattern on them is decorative, not a QR code.
- Preview deployment (not done): `MARKETING_CONCEPTS=true npm run marketing:build` (adds /concepts/ for comparison; never with `MARKETING_PUBLIC=true`), then `npx --no-install wrangler pages deploy marketing-site/site --project-name loynara-marketing --branch marketing/concept-c-final` as a Preview. Production promotion needs a separate approval and `MARKETING_PUBLIC=true` build without concepts.
