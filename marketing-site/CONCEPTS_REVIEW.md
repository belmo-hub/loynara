# Design-direction prototypes (A / B / C) – owner review

Branch `marketing/clean-concepts` from `marketing/mobile-clean` (`047db30`). Prototypes only: not deployed, not in the sitemap, `noindex,nofollow`, generated only with `MARKETING_CONCEPTS=true` (a public build refuses that flag), outputs git-ignored. The production page, legal text, maths and state machines are unchanged; the default and public builds produce byte-identical `site/` output.

```sh
MARKETING_CONCEPTS=true npm run marketing:build
PORT=8793 npm run marketing:preview          # http://127.0.0.1:8793/concepts/
BASE=http://127.0.0.1:8793 node marketing-site/concept-check.mjs
```

| | A – Fidelix-klar | B – Editorial Product | C – Hybrid |
|---|---|---|---|
| Idea | one column, broad flat cards, one point per block | large objects, open background, Fraunces display type, almost no frames | A's structure + Loynara's green/cream personality, two interactive stages |
| Story | card → Kasse (confirm button) → Inhaber counter, stacked | one phone changes state through a full visit cycle (open, confirm, next visit, reward, redeem) | one phone, tabs Besuch · Prämie · Empfehlung · Überblick |
| Referral | one timeline card, five steps | two tokens (Kunde A / Freund B) + four ticks, step-through button | numbered stepper (vertical on phone, horizontal on desktop) |
| Owner | segmented Überblick · Ruhige Zeiten · Zurückholen, one card | one editorial statement + quiet-hours bars + message bubble, capability list | same three tabs on a dark-green section |
| Brand | colour row, then stand → card → Wallet in sequence | stand as hero on a tinted field, card + Wallet as a fanned pair | one stage, tabs Aufsteller · Karte · Wallet + colour row |
| Calculator | label / large value / slider, dark result card, graph in a disclosure | editorial: small caps label, large Fraunces value, open result and graph | boxed inputs, dark result card, graph card |
| Price | large single card | giant centred price | two-tone offer card |

Shared: `src/concept-parts.ts` (card, stand, Wallet preview, calculator field, owner panels), `src/concepts.ts` (tabs, brand, visit flow via `demo.ts`, referral via `ref.ts`, calculator via `calc.ts`/`chart.ts`), `concepts/pages.ts`, `concepts/concepts.css`. Assets (concept build only): concepts.js 24.0 KB (8.5 KB gzip), concepts.css 34.5 KB (8.5 KB gzip).

Checks: `marketing:test` 47/47 (4 new concept guards), `marketing:verify` pass (default, public, and concept build), `concept-check.mjs` 113/113 (calculator edge cases, visit/referral state, tabs + keyboard, brand scope, reduced motion, no-JS, no console errors or external requests), axe: no violations on all concept pages at 390 and 1440. Overflow/clipping/console checked at 320, 360, 375, 390, 430 and 1440 for every concept. Chromium only – no Safari/WebKit, no physical iPhone.

Screenshots (git-ignored): `marketing-site/evidence/concepts/full/` (all widths, full page) and `.../modules/` (hero, story states, referral, owner views, brand presets, calculator default/zero/invalid, price, contact at 390 and 1440).

Prototype simplifications: no FAQ, request form or industry switch; chart has no month inspection (table instead); the Wallet pass and stand are stylised design examples.
