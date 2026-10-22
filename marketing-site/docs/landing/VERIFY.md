# VERIFY — Loynara (Studio v1)

Build: worktree `~/Developer/Loynara-studio`, branch `marketing/studio-v1` from `7db86c6` (= deployed getloynara.com),
uncommitted. Preview: `node marketing-site/preview.mjs` → http://127.0.0.1:8765/. **Nothing deployed.**

## Repo suites (final build)
`marketing:test` 79/79 · `marketing:verify` PASS (181 links/anchors/assets, CSP) · `browser-check.mjs` 400/400 ·
`pages-check.mjs` 211/211 · `a11y-check.mjs` no serious/critical violations.

## audit.mjs (served without the CSP header — its contrast probe injects a <style> the CSP blocks, which produced
~160 false 1.0:1 "failures" on both the old and the new page)
| Size | Overflow | CTA fold | h1 lines | Contrast fails | Targets <24 | Obstructed | CLS | Errors |
|---|---|---|---|---|---|---|---|---|
| 360×740 | no | 438 | 3 | 1* | 0 | 0 | 0 | 0 |
| 390×844 | no | 428 | 3 | 1* | 0 | 0 | 0 | 0 |
| 768×1024 | no | 502 | 3 | 0 | 0 | 0 | 0 | 0 |
| 1280×800 | no | 596 | 3 | 0 | 0 | 0 | 0 | 0 |
| 1440×900 | no | 601 | 3 | 0 | 0 | 0 | 0 | 0 |
\* text inside the closed "Berechnung und Annahmen" `<details>` (not rendered; identical on the deployed page).
Reduced motion: invisible text = none. Reading lines > 95 chars: none (deployed page had 109–165 at 768–1440).
Touch targets < 24 px: 0 (deployed page: 2). Distinct font sizes: 25–26 (unchanged from deployed; not refactored —
approved type scale).

## Integrity diff
Text oracle (audit --text, old vs new): **0 lines changed**. Logic: hrefs, ids, mailto builder, tabs, demo state
machines unchanged (repo suites). New: `assets/boot.js` (same-origin classic script, CSP-compliant), `data-reveal`
attributes, one `aria-hidden` text-free `.callback` strip, one SVG `rect.so-scan` in the stand.
Probe (Chrome): no-JS → all content and final states visible; boot.js runs but app.js blocked → final states after
4 s fallback; reduced motion → final states; console/CSP errors 0; flood overlay: no duplicate ids, aria-hidden +
inert, clicks pass through, max 1 at a time, always removed; mobile fold 360×640 CTA bottom 438 px.

## Critic rounds
Independent critic agents could not run in this session (four launches stalled at 0 tokens; watchdog-killed after
600 s). The four lenses were run inline by the builder instead — **not independent**; treat the scores as self-review.

### Round 1 findings → disposition
| # | Lens | Finding | Severity | Disposition |
|---|---|---|---|---|
| 1 | D | Clicking "Link teilen" < 2.8 s after the referral pair appeared replayed its entrance; link line vanished, dot never travelled | BROKEN | fixed: any click marks playing entrances done (capture phase) |
| 2 | C | Green focus ring on the deep "Inhaber" ground ≈ 2.4:1 (pre-existing) | WEAK | fixed: `.dark :focus-visible` peach (≈ 10:1) |
| 3 | C | Rapid swatch clicks stacked up to 4 flood overlays | POLISH | fixed: previous flood removed first |
| 4 | B | Rail colour typed as a raw hex | POLISH | fixed: `--rail` token |
| 5 | A | Hover ghost stamp read muddy brown (coral over green) | WEAK | fixed earlier: peach ghost + dashed coral ring |
| 6 | A/B | Roles rail misaligned (desktop) / at screen edge (mobile) | WEAK | fixed earlier |
| 7 | A | Scroll-linked phone lift faded opacity → card text low contrast while entering | WEAK | fixed earlier: translate-only `lift` |
| 8 | B | 25–26 distinct font sizes; 3 consecutive "split stage" sections (Theke, Empfehlung, Inhaber) | WEAK | not fixed: pre-existing approved type scale and layout; a structural redesign was out of scope |
| 9 | A/D | No real photography anywhere | — | asset-blocked; shot list in BRIEF.md |

### Round 2
All gates above re-run on the fixed build: green. Self-scores (rubric 1–10, not independent):
concept 8 · hero 8.5 · motion storytelling 8.5 · design-language coherence 8 · typography 6.5 · composition 6.5 ·
proof & assets asset-blocked (≈4) · conversion 8 · craft 9 · mobile 8.5 · wow/variety 7.5 · art direction 6.5.
Page average 7.8 with dimension 7, 8.1 without. Shareable moment: the stamp landing after "+1 vom Team bestätigt",
and the colour flood in the studio.

### Round 3 — layout restructure (user request)
Finding 8 (three consecutive split-stage sections) addressed in CSS only (markup and words unchanged):
Empfehlungen → centred statement + wide stage + horizontal step timeline; Inhaber → centred deep band with a tab row
and a centred owner card. Gates re-run: `marketing:test` 79/79 · `marketing:verify` PASS · browser-check 400/400 ·
pages-check 211/211 · a11y 0 serious/critical · text oracle 0 lines · CLS 0 at all sizes · obstructed 0.
audit: closed-`<details>` artefact on mobile (as before); at 1280×800 one hit on "Link teilen" — the audit's 680 px
scroll step puts the button at y = 43 px, under the 68 px sticky header (measured directly: white on #245D47, 7.6:1).
Updated self-score: composition 6.5 → 7.5, wow/variety 7.5 → 8. Page average ≈ 8.0 with dimension 7, ≈ 8.3 without.

### Round 4 — score levers 2–4 (user request)
- **Type scale**: every text size in d.css snapped to five steps — 12 · 14 · 16 · 17 · 20 px (h3 → 20); display steps
  only for h1, h2 and big numerals. Rendered distinct sizes (incl. display): 26 → 11–12.
- **Rechner moment**: a 20 × 2 stamp grid in the result card (aria-hidden, text-free). Row 1 = one day of purchases
  (20 stamps, 5 % each); row 2 receives one coral stamp per 5 % of the visitor's assumed increase, landing as they
  drag; fixed height (no layout shift). Strictly proportional to the visitor's own input — no counting-up money.
- **Hero**: stage 560 → 600 px, phone up to 300 px; cursor depth (fine pointers only, off under reduced motion):
  stand −6/−4 px, phone +12/+8 px with ≤ 0.6° tilt, cue +20/+14 px, lerp 0.08, rAF sleeps when settled; uses
  `transform`, entrance uses `translate`, so they never collide.
Gates: `marketing:test` 79/79 · `marketing:verify` PASS · browser-check 400/400 · pages-check 211/211 · a11y 0 ·
text oracle 0 lines · CLS 0 · touch targets < 24 px 0 · reading lines > 95 none · console/CSP errors 0 · no-JS /
app.js-failure / reduced-motion: nothing hidden · CTA fold ≤ 620 px at every size.
audit contrast: hits of 1.21–1.28 on "Café Morgenlicht", "Link teilen", "Karte öffnen", "Der Überblick…" — each
verified to sit under the 68 px sticky header at one of the audit's 0.85 × viewport scroll stops (e.g. "Karte öffnen"
top 1581, stop 1530); the closed-`<details>` artefact remains. No real contrast failure.
Updated self-score: typography 6.5 → 8 · hero 8.5 → 9 · wow/variety 8 → 8.5 · craft 9 → 9.5.
Page average ≈ 8.4 with dimension 7 (asset-blocked ≈ 4), ≈ 8.7 without.

## Paid API spend
none (no generated images or video).

## Remaining gaps / next levers
1. Real photos (5-shot list in BRIEF.md) — the biggest lever for proof and art direction.
2. Break the three consecutive split-stage sections (e.g. Inhaber as a full-width deep band with the owner card centred).
3. Consolidate the type scale to ≤ 5 text sizes + display steps.
4. Safari / real iPhone check of `animation-timeline: view()` (falls back to no lift), `@property` flood, `:has()` ghost.
