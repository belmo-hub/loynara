# DESIGN — Loynara

Reading this as: a German B2B sales page for small local shop owners, with a warm, product-honest language derived
from "Der bestätigte Stempel" (the logo's coral dot as the stamp that lands only after confirmation).
Dials: VARIANCE 6 · MOTION 7 · DENSITY 4 (trust-relevant: price, claims, mailto — motion never touches facts).

## Tokens (existing system kept; one token added)
| Token | Light | Role |
|---|---|---|
| `--deep` | #143D2E | deep ground: Inhaber section, calculator result card (≤ 2 deep blocks on the page) |
| `--canvas` / `--paper` / white | #F6F3EC / #FCFBF7 / #FFFFFF | reading surfaces (alternate canvas ↔ white) |
| `--ink` / `--muted` | #17291F / #58645C | headings / secondary text (muted on canvas 5.6:1) |
| `--brand` | #245D47 | action: primary buttons, links |
| `--warm` | #9E4B2D | eyebrow text, "now" step |
| **`--stamp`** (new) | #E9895F | the landing stamp, section-opener dot, ghost stamp, ink ring. Decorative only — never text |
| `--b-*` | per brand preset | card/stand colours (mirror the app's card studio) |
| danger | #A3321E | errors |
No dark mode (the product has none).

### Contrast (text pairs unchanged from the deployed page; `--stamp` is never used for text)
| Text | on | ratio |
|---|---|---|
| ink #17291F | canvas #F6F3EC | 13.9 |
| muted #58645C | canvas | 5.6 |
| warm #9E4B2D | canvas | 5.9 |
| white | brand #245D47 | 7.6 |

## Typography (unchanged)
Manrope (text + display weights 650–800) and Fraunces italic for the `em` accent, both self-hosted and preloaded.
Scale (five text steps, enforced): 12 px (.75rem: eyebrows, meta, captions) · 14 px (.875rem: fine print, hints,
small UI) · 16 px (1rem: buttons, labels, nav) · 17 px (1.0625rem / body: copy, leads) · 20 px (1.25rem: h3,
view titles, wordmark). Display: h2 clamp(1.9rem,7.6vw,3.2rem) · h1 clamp(2.05rem,10.4vw,4.6rem) · numerals. Balance on headings, pretty on paragraphs.

## Shape & depth (unchanged scale)
Product object 36–44 · panel 28 · card 20 · control 12 · pill 999. Shadows only on objects. The ink ring is a ring,
not a shadow.

## Signature patterns
| Pattern | Looks like | Concept meaning |
|---|---|---|
| section opener | coral 8 px dot before every eyebrow (`.eyebrow::before`) | each section is one stamp |
| step marker | demo step rails: the current step gets a coral dot on its rail | where the next stamp goes |
| artefact frame | the phone + soft counter surface (existing) | the real card UI, not a drawing |
| progress | owner list dots fill like stamps on enter; offer checks stamp in | stamps accumulate |
| closing callback | text-free crop of the card, all 10 stamps, 10th lands on enter | the empty slot is filled |
| studio change | colour floods from the pressed swatch (radial mask) | the brand stamped onto stand + card |

## Section map
| # | Section | Layout family | Ground | Real asset | Mobile collapse |
|---|---|---|---|---|---|
| 1 | Hero | split stage (copy · counter scene) | canvas | card UI + stand | scene under CTAs |
| 2 | Rollen | horizontal ruler with three stations | white band | — | stacked rows |
| 3 | An der Theke | split stage with interactive phone | canvas | card UI | copy · phone · demo |
| 4 | Empfehlungen | centred statement over a wide stage; steps as a horizontal timeline (≥ 900 px) | white | — | copy · pair · demo |
| 5 | Gestaltung | wide stage + control column | canvas | stand + card | stage · controls |
| 6 | Inhaber | deep band, centred: one row of question tabs over the centred owner card (≥ 900 px) | deep | owner view | copy · tabs · card |
| 7 | Rechner | inputs · result · chart grid | canvas | — | stacked |
| 8 | Angebot | sticky price card + Q&A list | white | — | stacked, not sticky |
| 9 | Anfrage | centred close: steps + callback · form | canvas | — | stacked |

## CTA map
"Demo anfragen" (one label, unchanged): header, hero, calculator, price card. Unchanged placement (copy locked).

## Conflicts logged
| Rule | Source | Winner | Why |
|---|---|---|---|
| Inline boot script to pause hero until seen | skill 4-signature-motion §2.2 | CSP | inline scripts are blocked → tiny same-origin `assets/boot.js` (sync, 0.3 KB) sets `html.js` |
| `style="--d:…"` per element | skill §2.3 | CSP | inline styles are blocked → delays via `:nth-child` rules |
| Nav CTA hides while hero CTA visible | skill 5-composition §3 | existing tests + behaviour | header CTA is part of the approved, tested chrome; kept |
| Real assets in ≥ 70 % of sections | quality bar | no photos exist | dimension 7 reported "asset-blocked"; shot list in BRIEF |
| Copy changes | skill 5 §5 | locked copy | zero visible text changes; decorations carry no text |
