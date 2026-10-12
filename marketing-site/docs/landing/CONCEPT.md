# CONCEPT — Loynara

## Candidates
| # | Metaphor (one line) | Hero object | Story beats | Climax | CTA coupling | Ownership (1 best–5) | Story | Buildable | Mobile | Culture | Total (lower own. = better; others 5 best) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **"Der bestätigte Stempel"** — the coral dot of the logo is a stamp that lands only after the team confirms | the counter scene: stand with QR + phone with the stamp card | stand rises → QR scanned → card opens, 8 stamps there → team confirms (+1 cue) → 9th stamp lands | the 9th stamp lands with weight + coral ink ring; the 10th stays empty = "ein Grund, wiederzukommen" | hover/focus on "Demo anfragen" puts a ghost stamp in the empty 10th slot | 2 | 5 | 5 | 5 | 5 (T1, T2) | own 2 · 20 |
| 2 | "Der Weg zurück" — a visit rhythm line that loops back to the shop | a timeline of visit ticks with a gap that closes | ticks appear weekly → gap → return tick | the return tick snaps in | hover draws the next tick | 3 | 3 | 4 | 3 | 3 | own 3 · 13 |
| 3 | "Die Theke im Schnitt" — a cut-away of the counter with customer, team, owner | an isometric counter with three figures | customer walks in → scans → team taps → owner screen lights | owner screen lights up | hover lights the owner screen | 4 | 3 | 2 | 2 | 3 | own 4 · 10 |

Why the losers lost: (2) abstract — needs words to read, and the rhythm line is the "Wer fehlt" outlook, which the
offer does not include (T4: no implied promise). (3) illustration-heavy, clip-art risk without real assets, three
figures unreadable at 360 px, and it would replace the product's real UI with drawings.

## Chosen concept — 1 "Der bestätigte Stempel"
- Derivation chain: logo = L corner + one coral dot (BRIEF §Name) → the dot is a stamp → the product's rule is
  "the stamp lands only when the team confirms" (BRIEF §Mechanism 2, truth T2) → the hero shows exactly that moment
  on the real card UI → the empty 10th slot left after the climax *is* the headline's "Grund, wiederzukommen" → the
  primary CTA fills that slot with a ghost stamp (the next visit you are asking for).
- One sentence the user could say to a friend: "Oben siehst du, wie der Stempel erst landet, wenn das Team bestätigt —
  und das leere zehnte Feld ist der Grund, wiederzukommen."

## Hero object spec
- Geometry: existing counter stand SVG (220×300) + phone (290 px wide) with the real `cardHtml` card (10 stamp
  circles, 5×2). New decorative layers, all `aria-hidden`, all text-free: QR scan bar inside the stand, ink ring on
  stamp 9, ghost stamp + breathing ring on slot 10.
- Materials: card gradient `--b-mid → --b-dark`; stamps `--b-accent` (peach) with check; the *landing* stamp flashes
  **coral `--stamp` (#E9895F, from the logo dot)** and settles to peach. Floor + soft scene gradient unchanged.
- Size: scene ≈ 46 % of the 1440 viewport width, 560 px tall. Re-laid so the stand and phone no longer overlap
  (the stand text "Café Morgenlicht" was cut by the phone on desktop).
- Climax position: stamp 9 sits at the phone's vertical centre, level with the h1's second line.

## Narrative beats
setup (stand + phone arrive: a customer at the counter) → build (QR scanned, card opens with 8 earned stamps: the
history is real) → confirm (cue "+1 Stempel · vom Team bestätigt": T2, the rule) → climax (stamp 9 lands, ink
ring: the value moment) → rest → idle (slot 10 breathes 3×, then still: the reason to return).

## Motif inventory (the coral stamp dot at every scale)
1. Section opener: every eyebrow gets the coral stamp dot (the logo's dot) — `.eyebrow::before`.
2. Step marker: demo step rails (`.steps`) become stamp tracks — the current step carries a coral dot.
3. Owner list: the dots of each card fill in like stamps when the section is seen.
4. Offer: the inclusion checks are stamped in one after another when the price card is seen.
5. Closing callback (`#anfrage`): a text-free close-up crop of the card, 10 of 10 — the 10th stamp lands when seen.
   The empty slot from the hero is filled at the end of the page: the story resolves.
6. Brand studio: a colour change floods the scene from the swatch you pressed (ink spreading).

## Interaction
Hover or keyboard focus on the hero "Demo anfragen" → a ghost stamp (dashed coral ring + translucent fill) appears
in slot 10. Press is a link navigation (unchanged).

## Palette origin
deep ground `#143D2E` (logo square / Waldgrün card) · paper `#F6F3EC` / `#FCFBF7` (cream of the logo's L) ·
accent/value = coral stamp `#E9895F` (logo dot, darkened slightly for presence on cream; decorative only, never text)
· action = `--brand #245D47` (unchanged primary buttons). Warm text accent `#9E4B2D` (eyebrows) unchanged.

## Originality test
1. Other businesses that could use "a stamp card whose stamp lands": other loyalty tools (Stamp Me, tapja, Bonusly).
   The owned part is the **confirmation gate** (stamp appears only after the team's "+1" cue) and the **logo dot =
   stamp** identity — competitors either auto-award on scan or show a static card.
2. Overlap with skill examples (roast curve, ledger, ECG, route, tannour, nodes on a curve): none. Overlap with tapja:
   tapja shows a static phone + wallet card; no stamp-landing story, no confirmation beat. Hero grammar (copy left,
   object right) is kept deliberately — the existing approved layout — but the object is now a stage with a story.
3. "Der Stempel kommt erst, wenn dein Team bestätigt — und dann fehlt nur noch einer."
