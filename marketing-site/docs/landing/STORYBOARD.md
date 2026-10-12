# STORYBOARD — hero signature animation ("Der bestätigte Stempel")

Archetype: **living object** — the product's real card UI in a counter scene, animated in CSS. Composition kept as
split stage (approved layout; copy locked) — the change is that the object now tells the story.

Budget: setup ≤ 0.4 s · build ≤ 1.6 s · climax ≈ 1.7–2.1 s · rest ≤ 2.6 s · idle hint 3 cycles.
Only stamp 9 moves with weight. Final state = the deployed static picture (9/10, "Noch ein Besuch", cue visible).
Plays when seen: `html.js .hero-scene:not([data-play])` pauses every animation at frame 0; app.js sets `data-play`
after `document.fonts.ready` + 2 rAF when ≥ 45 % of the scene is visible (4 s fallback in boot.js).

| Beat | What changes on screen | Start (s) | Duration (s) | Easing | Technique | Meaning |
|---|---|---|---|---|---|---|
| setup | stand rises 24 px + fades in; floor is there | 0.00 | 0.45 | out-expo | slide ≤ 24 px | the shop's counter |
| setup | phone rises 48 px from below | 0.15 | 0.55 | out-expo | slide | a customer holds up the phone |
| build | a light bar sweeps down over the stand's QR | 0.50 | 0.50 | in-out | reveal | scan, no app |
| build | the card opens (clip from top) | 0.80 | 0.40 | out-expo | mask reveal | card in the browser |
| build | stamps 1–8 appear, 45 ms apart | 1.00 | 0.55 total | out | fade/scale .6→1 | real history |
| confirm | cue "+1 Stempel · vom Team bestätigt" drops in | 1.40 | 0.35 | out-back | slide 10 px | **the team confirms** |
| climax | stamp 9 lands: scale 2.1 → .92 → 1, rotate −14° → 0, coral → peach | 1.70 | 0.45 | spring `cubic-bezier(.34,1.5,.64,1)` | assemble | the customer's moment of value |
| climax | coral ink ring expands 1 → 2.2 and fades | 1.85 | 0.55 | out | ring | the mark is made |
| climax | balance "9" and status settle (translate 6 px → 0) | 1.90 | 0.35 | out | slide | count is right |
| rest | everything still | 2.40 | — | — | — | — |
| idle hint | slot 10 ring breathes (coral, scale 1 → 1.18, opacity .9 → 0) | 2.80 | 3 × 1.6 s | ease-out | glow | "ein Grund, wiederzukommen" |

## CTA coupling
hover or `:focus-visible` on `#hero .btn-primary` → slot 10 shows a ghost stamp (dashed coral ring + 35 % coral fill,
scale .8 → 1, 220 ms). CSS only via `#hero:has(.btn-primary:hover, .btn-primary:focus-visible)`. No connector line
(avoids the derivative "wire" grammar). Press: normal link to `#anfrage`.

## Mobile
Scene stays under the CTAs (CTA above the fold at 360×640). Plays when 45 % of the scene is seen, so phone users
see the whole story when they scroll to it. Stand and phone keep their mobile overlap (phone in front) — the stand
text is not readable at that size anyway; on ≥ 900 px they no longer overlap.

## Closing callback
`#anfrage`: under the lead, a 10-stamp strip cropped from the card (deep green, masked left/right edges, no text,
`aria-hidden`). All 10 filled; stamp 10 lands coral → peach with the ink ring when the strip is seen.
