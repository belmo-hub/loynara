# Marketing compact-v3 – handoff

Branch `marketing/compact-v3` (worktree `Loynara-marketing-v3`), based on premium-v2 `d8ce1f8`. Local commit only; nothing pushed, deployed or published.

## Scene mapping (10 → 7)
| New scene | Replaces (old) | New content |
|---|---|---|
| 1 Hero `#hero` | Hero, Papier | sharper supporting sentence, flow line, small branded stand, referral cue, paper → digital strip |
| 2 Journey `#ablauf` | Ablauf | one stage, chapters Starten · Sammeln · Belohnen · Empfehlen, growth strip, referral example |
| 3 Inhaber `#inhaber` | Momente | one workspace: Überblick · Ruhige Zeiten · Zurückholen, outlook labelled |
| 4 Gestaltung `#gestaltung` | (new; part of Plattform) | stand + browser card + Wallet-Vorschau, Markenstil · Logo · Prämie |
| 5 Rechner `#rechner` | Rechner | maths, inputs, validation, graph unchanged; one result first, ratio only in details |
| 6 Angebot `#angebot` | Plattform, Start, Preis, FAQ | current pilot offer vs. shown outlook, setup, price card, six FAQ disclosures |
| 7 Anfrage `#anfrage` | Anfrage | new closing headline; mail-draft flow unchanged |

## Measurements (same method before/after: `measure.mjs`, Chromium, fonts loaded, optional disclosures closed, legal text excluded)
| | before (v2) | after (v3) | change |
|---|---|---|---|
| scenes | 10 | 7 | −3 |
| document height 1440 px | 9 251 | 6 250 | −32.4 % |
| document height 390 px | 14 014 | 9 619 | −31.4 % |
| default-visible body copy (prose words) | 625 / 625 | 304 / 304 | −51.4 % |
| default-visible words incl. UI/mock text, 1440 / 390 | 1 062 / 1 071 | 762 / 704 | −28.3 % / −34.3 % |
| unique copy incl. optional panels | 1 434 | 1 428 | ≈ same (referral/studio added, repetition removed) |
| distance to calculator, 1440 / 390 | 3 740 / 5 956 | 3 217 / 4 886 | −14 % / −18 % |
| distance to price card, 1440 / 390 | 7 037 / 10 769 | 4 575 / 6 879 | −35 % / −36 % |
| largest module (1440 / 390) | calc 1 173 / calc 2 319 | calc 809 / calc 1 391 | −31 % / −40 % |
| assets raw / gzip | app.js 94.4 / 34 KB, CSS 32.8 / 8.2 KB | app.js 106.7 / 37.7 KB, CSS 47.0 / 11.0 KB | +13 % / +43 % (stand, Wallet, referral, studio) |

Honest reading: height and body-copy targets are met; the broader "all visible words" count is 28 % (desktop) / 34 % (mobile) lower, just under the 35 % floor, because stand, card, tab and owner mock text counts as visible words. No essential idea sits behind a hidden tab: each tab module opens on a visible overview.

## Referral mechanism (chapter "Empfehlen")
Rule shown on the page and verified in the app code (`src/lib/referrals.ts`): opening or sharing a link earns nothing; the friend's enrolment is only an open participation; the bonus is booked once when staff confirm the friend's first earning visit (referrer bonus, friend bonus configurable); conspicuous cases (e.g. same verified e-mail) go to review. States: Link geteilt → Teilnahme offen → Bedingung erfüllt → Bonus verbucht, two fictional cards (A 7/10 → 8/10, B 0 → 1), owner counters (qualified referrals / confirmed visits / booked bonuses), growth strip Besuch → Fortschritt → Prämie → Empfehlung → neuer Besuch. Replays and duplicates are impossible (idempotent state machine, tested).

## Branding / stand / Wallet demonstration
Five colour presets (mirroring the app's card studio), three logo symbols, three reward options act on one shared state: stand, browser card, Wallet-Vorschau, journey stage, hero-independent system mini and owner frame all follow the same CSS variables. Labelled "Gestaltungsbeispiel"; no "Add to Wallet" control, no stand dimensions or inclusion claims; Wallet and stand are listed under "Gezeigter Ausblick · gesondert zu vereinbaren". State lives in page memory only (see privacy facts).

## Owner activation scenarios
Überblick (12 repeat visits, 3 rewards, 2 referrals; example data) is the default and part of the current offer. Ruhige Zeiten (quiet Tuesday afternoon, possible group requiring consent, preview "nicht versendet") and Zurückholen (long pause, example rule, preview) carry "Plattform-Ausblick – nicht im aktuellen Pilotangebot", all eight industries have their own copy.

## Calculator preservation
Maths, inputs, ranges, German parsing/validation, graph, readout strip, zero-gain case, assumptions and single price source unchanged (unit tests + 392 browser checks). Example 50 / 7 € / 26 / 10 % / 39 € → 9.100 / 910 / 871 / 10.452 €; chart month-12 label now "+10.920 € Zusatzumsatz" (before fee); ratio 23,3× only inside "Berechnung und Annahmen im Detail".

## QA results (all local, Chromium via system Chrome)
- `npm run marketing:test`: 43 / 43 pass (calculator, demo, referral, brand, request, site copy and claim guards).
- `marketing:verify`: pass in normal and `MARKETING_PUBLIC=true` mode; the publication guard still fails the build when `legal/impressum.html` is missing (checked, file restored).
- `browser-check.mjs`: 392 checks pass (8 widths, both functional runs, tabs/keyboard, journey, referral, owner views, 8 industries, brand independence, calculator edge cases, mail encoding, clipboard refusal, 320 px, reveals, print, orientation, 125 % text size, reduced motion, no JS).
- `a11y-check.mjs` (axe-core, 9 states incl. opened journey/owner/studio/FAQ/referral/mobile): no violations. It caught two real defects that were fixed: `aria-pressed` was written onto `<html>` and owner cards used h4 under h2.
- `perf-check.mjs` (lab, 4× CPU): LCP 176 ms desktop / 252 ms mobile, CLS 0, TBT 63 / 132 ms, worst interaction 48 / 40 ms.
- Not run: Safari/WebKit (install loop deliberately not repeated), physical iPhone, screen readers. `SAFARI_CHECKLIST.md` is the manual script.

## Reviewer assessments (not user research)
- *Scanner* (reads headlines, tabs, first sentence per scene, 10 s): sees retention + referral + owner visibility + branding + price + CTA without clicking; the 39 € card is reached after 4 575 px desktop. Weak spot: strip text in the referral chapter stays the same sentence across its four steps; state is carried by the step line and counters.
- *Explorer* (clicks everything): every tab opens on a populated view, no state is lost by changing the brand or industry, the calculator is never reset; changing chapters after a redemption shows a coherent snapshot instead of replaying the redemption (by design).

## Privacy
Brand/logo/reward choices, journey and referral examples and owner views make 0 requests, write no storage or cookies, no upload; reset on reload. No amendment required; an optional factual sentence is in `PRIVACY_ADDENDUM_DRAFT.md` (draft only, `legal/` untouched).

## Remaining limitations / publication decisions
- Safari/WebKit and physical iPhone unverified; run the checklist before any approval.
- Mobile hero shows the stand below the first viewport.
- Wallet-Vorschau progress bar is a stylised rendering, not a real pass layout.
- CSS grew 43 % raw (11 KB gzip); 17 unused legacy selectors could be pruned.
- Publication, deployment and preview hosting need separate approval; legal fragments untouched.

## Review access
Local only: `PORT=8791 npm run marketing:preview` → `http://127.0.0.1:8791/`. Screenshots under `marketing-site/evidence/` (git-ignored): `measure-before/`, `measure-after/` (full-page 1440 / 390), `screens/` (close-ups from `browser-check.mjs`), `cap/` (per-scene captures).
