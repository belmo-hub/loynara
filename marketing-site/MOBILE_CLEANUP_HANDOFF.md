# Mobile visual cleanup (≤ 700 px) – handoff

Branch `marketing/mobile-clean`, based on `marketing/compact-v3` (`9d0763b`). Desktop (> 700 px) is byte-for-byte the same layout; all changes are one trailing mobile block in `styles.css` plus two test-script tweaks. Local only: not pushed, not deployed, legal fragments untouched.

**Baseline choice:** compact-v3, not premium-v2 – v2 has none of the referral, stand/Wallet/branding and owner scenes the page must keep. Only its over-compressed mobile presentation was replaced.

## What changed (mobile only)
- **Rhythm:** section padding 68 px, heading gap 30 px, card padding 20–28 px, 12–14 px between cards, one 20 px page gutter (a double gutter that squeezed inner content was removed).
- **Journey:** chapters as a roomy 2×2 control (labels only; the sentence below explains the step); growth strip as a five-column stepper with a hairline instead of wrapping arrows; flat instruction card with a separated result line; referral steps as a 2×2 list; referral owner counters as three number/label tiles; a gap above in-card buttons; duplicate "Noch nicht angemeldet" removed.
- **Owner:** one-column tabs (label + sub-line) instead of three squeezed chips; flow line as three numbered rows instead of floating pills with arrows; scenario cards single column (no more one-word-per-line text, nothing cut at the right edge); outlook qualification set as its own accent-ruled note.
- **Studio:** one curated column – stand, browser card, Wallet-Vorschau at equal width, centred, 34 px apart; reward choices as full-width options; Wallet fields no longer wrap word by word.
- **Calculator:** single column – label, full-width input, slider per field; large result, disclaimer, fee line, details, legend, readout, graph, CTAs stacked with consistent spacing; empty error lines collapse.
- **Offer:** decorative stand/card removed from the setup card (steps only); price card with large price, muted qualifier, hairline before the outlook block (a stray vertical rule is gone), full-width CTA with air before the fine print.
- **Hero:** orphaned flow line hidden on phones (its sentence is already in the copy), calmer spacing, paper strip stacked; at ≤ 380 px the small stand is hidden and the phone gets the full width.
- **≤ 380 px:** tab number circles, owner "Inhaber-Ansicht" and inline price unit are dropped/stacked so nothing breaks mid-word.

## Preserved
Palette, typography, copy, referral/stand/Wallet/owner/calculator story, 39 € offer, all state machines and the calculator maths. Tests: `browser-check.mjs` now requires the hero stand on phones wider than 380 px.

## Results
`marketing:test` 43/43; `marketing:verify` pass; `browser-check.mjs` 392/392; axe: no violations; captures reviewed at 430, 390, 375, 360 and 320 px (hero, journey, referral before/after, studio, owner overview/quiet/win, calculator, offer, contact). Mobile page height 9 619 → 11 159 px (+16 %, still −20 % versus premium-v2's 14 014); desktop height unchanged (6 250). Assets: app.js unchanged, CSS 47.0 → 54.9 KB raw (12.4 KB gzip).

## Remaining
No Safari/WebKit or physical-iPhone run (use `SAFARI_CHECKLIST.md`); the Wallet progress bar is a stylised placeholder; one perf-lab interaction measured 128 ms at 4× throttle (previous run 40 ms) – single run, not investigated further.
