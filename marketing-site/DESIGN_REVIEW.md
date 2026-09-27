# Loynara marketing design review — 27 September 2026

Scope: existing static marketing site only, starting at `beeb7eb`. No platform, release-gate, Access, provider or database changes. No commercial launch or new spending.

## Live reference audit

Visually inspected [Fidelix](https://fidelix.ma/) in an interactive browser at 1440×900, 390×844 and intermediate 768×1024. Exercised navigation, mobile menu, calculator slider/keyboard, location count, annual pricing and public demo CTA; no form submitted, account created, private app inspected or source/assets copied. Reference screenshots stay in ignored local `evidence/premium-pass/` and are excluded from the site bundle.

Observed principles: a dominant product/heading pair; approximately 1150px desktop content width; condensed, confident headlines contrasted with quieter body copy; coral as a scene colour and action cue, black as a strong anchor, warm off-white as breathing space. Rounded product panels overlap with restrained depth. Light/dark contrast makes the comparison and economic result immediately legible. Navigation condenses into a mobile menu. Pricing changes instantly. Commercial rhythm goes product → return motivation → contrast → economics → breadth → process → price → physical object → action. Technical detail follows the outcome. Strong hierarchy, consistent spacing and immediate feedback account for much of the polish. The observed tablet header was crowded; that is not a pattern to reproduce.

Loynara's original response: forest/ivory/copper; mixed editorial typography; a contained, explicitly controlled visit/reward/activity/return scene; row-based contrast; eight materially different industry rules; customer/cashier/owner demonstration; four editorial capability groups with genuine local product captures; cost coverage rather than predicted uplift; distinct counter-stand concept labelled upcoming. No third-party statistics were added: economic reasoning and merchant assumptions are sufficient without extrapolating general research into product results.

## Visual correction passes

Pass 1: desktop headline broke awkwardly; mobile overlap obscured product content. Reduced desktop headline size and changed mobile to sequential full-width product panels. Pass 2: shortened excess demo spacing, corrected a mobile sentence join, and replaced the generic programme/growth capture with readable crops of the actual reward catalogue/referral report. Compared the final rendered reference and Loynara again for hierarchy, product impact, mobile legibility, rhythm and price clarity. This is design judgement, not evidence of conversion uplift.

## Claims inventory

| Claim family | Basis / treatment |
| --- | --- |
| Return-oriented headline and value narrative | Product purpose, without a promised outcome, sales uplift or attribution claim. |
| Browser card, stamps/points, reward catalogue, explicit cashier confirmation, activity, roles/locations | Existing `FEATURE_STATUS.md` local evidence; framed as controlled pilot/examples, not commercially launched. |
| Mac/iPhone QR scans in FAQ | Existing owner-reported tests in their two stated directions; no Android or two-phone claim. |
| Audience, offer planning, automation preferences and referral qualification | Local synthetic evidence. Sending clearly simulated; first qualifying purchase required for referral bonus; anonymous identity limits disclosed. |
| Customer reopening and offline behaviour | Saved private link; no independently verified recovery. Pending offline events require server acceptance; redemption stays online. |
| Wallet and secure NFC | In preparation. NFC visual is an original design concept, not a product photograph or purchase offer; physical tests not claimed. |
| Calculator and frequency | Merchant inputs or explicitly loaded assumptions; rounded-up contribution break-even, 30-day frequency convention, missing costs unknown, no net-profit or uplift forecast. |
| Pricing/setup | Existing €49/€69 monthly plus €99 setup proposals preserved; initial €148/€168 shown. €99 including month one stays a separate unapproved draft. Cancellation/contract terms remain unapproved. No scarcity/guarantee. |
| Contact/final CTA | Working demo and local note download; no invented inbox, form success or submitted inquiry. |

Reworded the hero from selling primarily a browser card to a customer-retention system; made no-sales/pilot status explicit. Removed implications of generic dashboard proof by labelling actual capture context. Retained unavailable-provider, lost-link and local-send limitations. No testimonials, merchant logos, review rewards, AI claims or external retention statistics.

## Verification and deployment

`npm run typecheck -- --pretty false`, `npm run lint`, `npm run marketing:test`, `npm run marketing:build`, `npm run marketing:verify`; existing `node marketing-site/browser-check.mjs` extended for eight industries, hero states, price synchronization, five viewports, navigation, FAQ, recording and key target sizes. Browser evidence, source hash, contrast ratios and a single throttled lab load are in `browser-evidence.json`. Screenshots are local under `evidence/premium-pass/`; `INDEX.md` lists them. Browser emulation and zoom-equivalent reflow are not physical phone or assistive-technology evidence. No field INP or conversion measurement is claimed.

Final results: typecheck/lint/build/static verification PASS; 8 marketing/calculator tests PASS; 22 browser checks PASS. One throttled lab run: LCP 996 ms, CLS 0, no observed long tasks. Output and staged secret scans passed. No physical-device, screen-reader, field-INP or conversion measurement.

Audit packaging: `node marketing-site/audit-build.mjs` creates only `var/loynara-audit-ready`, with the existing audit destination, explicit banner and noindex metadata/header. It publishes nothing. Root deployment remains blocked by `LEGAL_LAUNCH_FIELDS.md`; `MARKETING_PUBLIC=true` still refuses activation. Cloudflare authentication is currently required to update the existing audit deployment.
