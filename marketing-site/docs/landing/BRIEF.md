# BRIEF — Loynara

Source of truth for this redesign: the page deployed at https://getloynara.com/ (byte-identical to
`marketing-site/site/` at commit `7db86c6`, the public release commit). Work branch:
`marketing/studio-v1` (worktree `~/Developer/Loynara-studio`). Local only — nothing is deployed.

## Business in one sentence
Local shops (cafés, barbers, salons, takeaways in Germany) · turn one good visit into repeat visits and referrals ·
with a digital stamp card opened by QR in the browser, where the shop's team confirms every visit with one tap.

## Name
- Literal meaning: coined brand — "Loy(alty)" + "-nara" (soft, friendly ending). No dictionary meaning.
- Logo construction (`assets/loynara-mark.svg`): deep-green rounded square, a cream **L** drawn as a corner (a counter
  edge / the corner of a card) and one **coral dot** (`#F2A078`) in the open corner.
- Object hidden in the mark: **the dot is the stamp** — one visit, one mark, sitting where the next one goes.

## Mechanism
1. Customer scans the QR code on the counter stand → the card opens in the browser (no app, no password).
2. Customer shows the card; the **team confirms the visit with one tap** — only then the stamp lands.
3. Stamps accumulate (10 in the demo) → reward is redeemed at the counter → the card starts over.
4. A regular shares a link; the bonus is booked only when the team confirms the friend's first visit.
5. The owner sees who returns (and, as outlook, who is missing / when it is quiet).

## Customer before → after
- Before: a good visit is forgotten; paper cards get lost; the owner never knows who came back.
- After: each visit leaves a visible mark; the empty next slot is "ein Grund, wiederzukommen".

## Audience
- Owners of small local businesses in Germany, German only, informal "du". Mostly phone (evening, between shifts),
  desktop when preparing a decision.
- Fear: another app nobody installs; staff hassle at the till; abuse of bonuses; being sold hype.
  Trust: plain claims, a fixed price, "nothing is sent from this page", the rule that the team confirms.

## Offer & conversion
- Primary action: **Demo anfragen** → `#anfrage` → `mailto:` draft built by `src/request.ts` (must stay untouched).
- Price: 39 € / Monat / Standort (single source `src/site.ts`), pilot conditions in a personal talk. No guarantee.
- Secondary: "So funktioniert’s" (→ `#ablauf`), Anmelden (→ app login), calculator figures into the request.

## Copy status
**locked** — published, legally reviewed, guarded by `tests/site.test.ts` and `tests/claims.test.ts`.
Design changes only; not one visible character changes. Decorative additions carry no text.

## Assets inventory
| Asset | Exists? | Where | Use |
|---|---|---|---|
| Logo mark SVG | yes | `site/assets/loynara-mark.svg` | header, motif source |
| Product card (HTML/CSS, real card studio colours) | yes | `src/final-parts.ts` | hero, demos, studio |
| Counter stand (SVG, "Gestaltungsbeispiel") | yes | `src/d-parts.ts` | hero, studio |
| Fonts Manrope + Fraunces (self-hosted) | yes | `site/assets/fonts` | all text |
| Real photos of a shop / owner / staff | **no** | — | — |
| Testimonials, customer logos | **no** (and forbidden by claim guards) | — | — |
| Generated imagery | none used | — | no generated images on the page |

Missing assets (shot list for later, never faked):
1. Counter close-up: a real Loynara stand on a café counter, phone held above it, 4:5, morning side light — hero.
2. Barista's hand tapping "bestätigen" on a tablet/phone, shallow depth, 3:2 — "An der Theke".
3. Two friends at a counter, one showing the other her phone, 3:2 — "Empfehlungen".
4. Owner at the till looking at the overview on a phone, after closing, warm light, 4:5 — "Inhaber".
5. Founder portrait with a short signed note, 1:1 — "Demo anfragen" close.

## References
The user named none. Prior internal benchmark: tapja (principles only, see `CONCEPT_D_HANDOFF.md`).

## Constraints
Static site (TS → HTML/CSS + one esbuild bundle), Cloudflare Pages. **CSP: `script-src 'self'; style-src 'self'`**
→ no inline `<script>`, no inline `style=""` attributes in markup (CSSOM `style.setProperty` from JS is fine).
No network calls, no storage, no analytics. Tests: `marketing:test`, `marketing:verify`, `browser-check.mjs`,
`pages-check.mjs`, `a11y-check.mjs`. Must not change: ids/anchors, hrefs, mailto builder, price source, claim
wording, tab/demo state machines, legal pages.

## Market truths a generic designer would miss
1. German shop owners know the **paper Stempelkarte** from the bakery — a stamp is the native unit of loyalty here.
2. Trust comes from **rules, not adjectives**: "Erst wenn dein Team bestätigt" is the selling point, not a footnote.
3. The till is busy: anything that looks like extra work for staff is an objection — the tap must look trivial.
4. Owners distrust numbers that look like promises (UWG, Abmahnung culture) — the calculator must stay a labelled
   example, never a counting-up "ROI" show.
5. Decisions are taken on a phone, often late — the story must play on mobile when it is seen, not off-screen.
