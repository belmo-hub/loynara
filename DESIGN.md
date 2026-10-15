# Loynara product design system

The product (customer card, cashier, owner dashboard, sign-in and legal pages) shares one visual language with the
marketing site: warm paper, forest green, Manrope for text, Fraunces for numbers and titles, and the stamp as the
one recurring motif. Direction "Stempelpapier": the card is a physical object, a stamp is a pressed mark, and nothing
else competes for attention. The cashier uses a dark, camera-first variant of the same tokens.

Tokens live in `src/styles/tokens.css`. Primitives live in `src/components/ui/`. Nothing outside those two places
defines a colour, font size, radius, shadow, duration or z-index.

## Principles

1. **One job per screen.** The card shows progress and the code. The cashier books a visit. The overview says what to do next.
2. **Facts never move.** Balances, codes and prices do not animate in ways that hide their value; numbers use tabular figures.
3. **The stamp is the reward moment.** Coral (`--color-stamp`) appears only where something was earned or is redeemable. It is decorative, never text.
4. **Merchant colour, guaranteed contrast.** Every shop picks its colour; the system derives readable companions automatically.
5. **Calm by default.** Motion answers an action or marks a reward. No idle loops, no scroll theatre.

## Surfaces

| Surface | Shell | Width | Theme |
|---|---|---|---|
| Customer: /join, /card, /tap, /recover, /verify-email, /unsubscribe | `CustomerShell` | single column, max 440 px | light + dark (system) |
| Cashier: /cashier | `CashierShell` | single column, max 560 px | always dark (`.ly-theme-dark`) |
| Owner: /merchant/* | `OwnerShell` (src/components/owner) | sidebar ≥ 1024 px; top bar + bottom bar + "Mehr" sheet below | light + dark (system) |
| Sign-in, invite, legal, system pages | `AuthShell` | centred column, max 480 px (legal 720 px) | light + dark (system) |

Dark values apply only inside an element with `.ly-theme-auto` (follows `prefers-color-scheme`) or `.ly-theme-dark`
(forced). Pages that are not migrated yet stay light.

## Colour roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `--color-bg` | #F6F3EC | #0F1713 | page background |
| `--color-surface` | #FCFBF7 | #16201B | panels, list groups |
| `--color-raised` | #FFFFFF | #1D2923 | inputs, tickets, menus |
| `--color-ink` | #17291F | #E9EFEA | primary text |
| `--color-ink-muted` | #58645C | #A6B3AA | secondary text (≥ 5.5:1) |
| `--color-line` | #DCE0D6 | #2B3A32 | dividers (decorative) |
| `--color-line-strong` | #7A867D | #6B7B71 | input and control borders (≥ 3:1) |
| `--color-action` | #245D47 | #9FD3B5 | primary buttons, links, selection |
| `--color-action-hover` | #143D2E | #B9E2CA | hover |
| `--color-on-action` | #FFFFFF | #0F1713 | text on action |
| `--color-action-soft` | #E6EEDF | #22352B | quiet fills, selected rows |
| `--color-fill` | 7 % ink | 7 % ink | neutral badge, hover fills, segmented track, skeleton |
| `--color-accent-text` | #9E4B2D | #E8A58A | kickers ("Als Nächstes"), warm emphasis |
| `--color-stamp` | #E9895F | #E9895F | earned stamps, reward markers (decorative) |
| `--color-success` | #1F6B45 | #8FD1A8 | confirmed booking, "+1" |
| `--color-danger` | #A3321E | #F08F7A | errors, destructive |
| `--color-warning` | #8A5A00 | #F2C14E | offline queue, pending |
| `--color-focus` | #2E7D5B | #9FD3B5 | focus ring (3 px, 2 px offset) |

Status chips and notices set the status colour as text on a 10 % fill of itself
(`color-mix(in oklab, var(--color-success), transparent 90%)`), in the shared Badge and in the dashboard alike.

Contrast pairs asserted by `src/styles/tokens.test.ts`: ink, ink-muted, accent-text, success, danger and warning on
bg, surface and raised (≥ 4.5:1); on-action on action (≥ 4.5:1); line-strong, action and focus on surface (≥ 3:1);
each status colour on its 10 % fill and ink-muted on `--color-fill`, over every ground (≥ 4.5:1).

### Merchant colour

`merchantPalette(hex)` in `src/components/ui/merchant-color.ts` returns CSS variables set by the customer and cashier shells:

| Variable | Rule |
|---|---|
| `--merchant` | the shop colour, shifted darker (white text) or lighter (ink text) in 4 % steps until its text pair reaches 4.5:1 |
| `--merchant-ink` | `#FFFFFF` or `--color-ink`, whichever contrasts more with `--merchant` |
| `--merchant-deep` | gradient end for the card object: 30 % toward black for dark colours, 14 % for light ones (no mud) |
| `--merchant-text` | the shop colour as text on `--color-surface`, darkened (light theme) or lightened (dark theme) until ≥ 4.5:1 |
| `--stamp-fill` / `--stamp-ink` | coral with ink when coral vs `--merchant` ≥ 2:1 (the ink check mark, ≥ 4.5:1 on its fill, carries the state; empty slots are dashed rings); otherwise `--merchant-ink` with `--merchant` |

## Typography

Manrope (variable 200–800) for all text; Fraunces (variable) for page titles, the customer goal line and
large numerals. Both self-hosted through `next/font/local` from OFL files; no external requests.

| Token | Size / line | Use |
|---|---|---|
| `--text-12` | 12 / 16 | bottom-bar labels, sidebar group labels. Never body copy. |
| `--text-14` | 14 / 20 | secondary text, hints, table meta |
| `--text-16` | 16 / 24 | body, buttons, inputs (16 px stops iOS zoom) |
| `--text-18` | 18 / 26 | section titles |
| `--text-22` | 22 / 28 | panel titles, cashier state |
| `--text-28` | 28 / 34 | page titles on phones, customer goal line (Fraunces) |
| `--display-36` | 36 / 40 | page titles ≥ 1024 px (Fraunces) |
| `--display-num` | clamp(40, 11vw, 56) / 1 | customer balance and goal numerals (Fraunces) |

Dashboard data (Stat values, tables, charts) stays in Manrope: values 800 with proportional figures, columns with
tabular figures. Fraunces is a brand voice for titles and the customer card, never for data.

Weights: 400 body, 650 labels, 720 buttons and emphasis, 800 card codes and cashier numerals. Headings use
`text-wrap: balance`, paragraphs `pretty`. Long German compounds: `hyphens: auto` on headings with `lang="de"`,
`overflow-wrap: anywhere` on names, codes and reward titles.

## Space, shape, depth

- Space (4 px base): `--space-1` 4 · `--space-2` 8 · `--space-3` 12 · `--space-4` 16 · `--space-5` 20 · `--space-6` 24 · `--space-8` 32 · `--space-10` 40 · `--space-12` 48. Page gutter 16 px on phones, 40 px ≥ 1024 px.
- Radius: `--radius-sm` 8 (badges, chips) · `--radius-md` 14 (inputs, small controls) · `--radius-lg` 20 (panels, cards) · `--radius-xl` 28 (card object, camera, sheets) · `--radius-pill` 999 (buttons, segmented controls).
- Elevation: `--shadow-hairline` (1 px line, lists) · `--shadow-raised` (menus, popovers) · `--shadow-object` (card object, tinted with the merchant colour) · `--shadow-overlay` (dialogs, sheets). Panels have borders, not shadows.
- Touch targets: 44 × 44 px minimum; cashier actions 56 px, primary booking button 64 px.
- Z-index: `--z-sticky` 10 · `--z-nav` 20 · `--z-sheet` 40 · `--z-dialog` 50 · `--z-toast` 60.

## Motion

Three durations, three easings. Everything that moves has a `prefers-reduced-motion: reduce` fallback (opacity only,
or nothing).

| Token | Value | Use |
|---|---|---|
| `--dur-press` | 120 ms | press feedback, hover colour |
| `--dur-ui` | 220 ms | enter/exit of menus, dialogs, toasts, tab crossfades |
| `--dur-reward` | 480 ms | stamp landing, number ticker, cashier success |
| `--ease-out` | cubic-bezier(.23, 1, .32, 1) | entrances and anything answering a press |
| `--ease-in-out` | cubic-bezier(.77, 0, .175, 1) | elements moving on screen (layout animation, progress fill) |
| `--ease-drawer` | cubic-bezier(.32, .72, 0, 1) | sheets and the "Mehr" drawer |

| Motion (vocabulary name) | Where | Spec | Reduced motion |
|---|---|---|---|
| Press / tap feedback | every button and pressable row | scale .97, `--dur-press` `--ease-out`, transform only | none |
| Fade in + scale in | dialogs (centred origin), menus (origin-aware) | from opacity 0, scale .96; exit 160 ms | fade only |
| Slide in | sheets from the bottom, "Mehr" drawer | translateY(100%) → 0, 260 ms `--ease-drawer`; swipe to dismiss | fade only |
| Slide in + fade | toasts from the bottom edge; exit faster than enter | `--dur-ui` | fade only |
| Pop in | the newest stamp after a booking (once per change) | scale 1.3 → .94 → 1 with its resting rotation, `--dur-reward` | instant |
| Number ticker | balance and KPI values when they change | digits roll, tabular numbers, `--dur-reward` | instant |
| Crossfade | cashier status bar colour (scanning → open → done), dashboard tab content (React `ViewTransition`) | `--dur-ui` | instant |
| Shake | failed code entry or rejected amount, field only | 2 × 4 px, 240 ms | border colour only |
| Skeleton shimmer | loading placeholders shaped like the content | linear 1.4 s loop | static tint |
| Accordion | disclosures (rules, "So zählen wir") | height via `grid-template-rows` 0fr → 1fr, `--dur-ui` | instant |

No hover lift on cards, no stagger on page load, no animation on keyboard-triggered actions.

## Layout patterns

- **Customer card.** Merchant row → goal line (Fraunces) → card object (stamp grid or points ladder) → code ticket (QR on white, card number 28 px, tabular) → Wallet buttons → rewards list (points) → invite → optional "Karte sichern" row → recent visits → legal links. The QR always sits on `#FFFFFF`, in both themes.
- **Stamps.** Grid of 4 columns (up to 12 stamps; 5 columns for 10, 15). Earned stamps are pressed coral marks with a small resting rotation; empty slots are dashed rings.
- **Points.** Balance numeral, then a ladder: one track to the most expensive reward, a marker per reward that turns into a pressed mark once affordable. Marker labels hide when two are closer than 14 % of the track; the rewards list below always carries the names.
- **Cashier.** Status bar (Scannen / Karte offen / Wird gebucht / Erledigt / Fehler) → camera or opened card → stepper (stamps) or amount field (points) → bottom dock with the primary booking button (thumb zone). Destructive actions only get a confirm dialog.
- **Dashboard.** Sidebar groups: Überblick · Programm · Kunden · Marketing · Auswertung · Betrieb, location switcher on top, "Kasse öffnen" and user menu at the bottom. Phones: top bar with location switcher, bottom bar (Übersicht, Kunden, Programm, Auswertung, Mehr) and a "Mehr" sheet with the remaining groups. Page header = Fraunces title + one line of context + page actions. Tables: sticky header, search, filter chips, row opens a side sheet. Forms: titled sections, inline validation, sticky save bar when dirty.

## Copy rules

- Du-form, sentence case, plain verbs. A button says what happens ("1 Stempel vergeben"), and the toast repeats it ("Stempel vergeben").
- Never build grammar around a reward title: write "Noch 2 Besuche bis zur Prämie" and show the title on its own, not "bis zum {Titel}".
- Errors say what happened and what to do. No apologies, no vague "Etwas ist schiefgelaufen".
- No em dashes in UI text. Middle dots at most once per line.
- German labels that e2e specs find by role and name stay unchanged unless the spec changes in the same PR.

## Accessibility checklist (every PR)

AA contrast in light and dark · visible focus ring · keyboard reachable in visual order · targets ≥ 44 px · inputs
16 px · no horizontal scroll at 320 px · reduced motion respected · status changes announced with `role="status"` or
`aria-live` · German compounds wrap without clipping · French (`locale=fr`) strings fit.
