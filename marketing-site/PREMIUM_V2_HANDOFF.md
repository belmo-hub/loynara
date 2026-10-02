# Premium marketing pass v2 — implementation handoff

- **Branch / base:** `marketing/premium-v2` from live commit `88632be4e78b056e262aa7a1dfb418c843ef4284` (Cloudflare Pages project `loynara-marketing`). Earlier functional commit: `41b1c6e`.
- **Preserved from the live commit:** factual Impressum and Datenschutz fragments (`legal/*.html`, rendered unchanged), no Teilnahmebedingungen link, tablet navigation breakpoint (menu below 1100 px), Cloudflare `Cache-Control` header in `_headers`, `MARKETING_PUBLIC` guard and its stricter verifier branch.
- **Not touched:** application, Railway, Cloudflare, DNS, auth origins, NFC keys/tags, `railway-rc`, other worktrees. Nothing deployed.

## What changed
Complete redesign in the specified order: hero (connected customer/cashier/owner scene) → paper vs. relationship → sticky counter demo (one state machine, NFC/QR, new vs. returning customer, 8/10 → reward → redemption, eight industries) → business moments (quiet afternoon, missing regular, near reward; platform preview, never "sent") → revenue-scenario calculator with SVG 12-month chart → platform depth (now vs. outlook) → setup and ownership → pricing (39 € / Monat / Standort, pilot qualifier) → six FAQ answers → honest mail-draft request flow.

Stack: static TypeScript, Motion vanilla (`animate`, `inView`) bundled by esbuild into one `app.js`, native CSS for simple states, native SVG for the chart. Fonts: Manrope + Fraunces (SIL OFL, self-hosted WOFF2, licences in `site/assets/fonts/`). Dependencies live in `marketing-site/package.json` only.

## Calculator
`baseline = visits × basket × days`; `additional = baseline × gain`; `difference = additional − fee`; `annualised = difference × 12`; `ratio = additional ÷ fee` (n/a at fee 0). Integer-cent arithmetic. Example (50, €7, 26, 10 %, €39): 9.100 € / 910 € / 871 € / 10.452 € / 23,3×. Fee is read from `SITE.price.amount` only (a test forbids a second copy).

**Fidelix observation (fidelix.ma, 2026-10-02, desktop + mobile, evidence in `evidence/fidelix/`):** four native range sliders only (clients 10–500 step 5; basket 20–500 step 5; days 20–31 step 1; gain 5–20 step 1); no editable number fields; no reset; keyboard = native range (ArrowRight +5, End 500, Home 10); no chart (the only SVGs in the section are icons); results formatted ×N.N below 10, ×N above. Formula confirmed with five changed-input cases (e.g. 100 clients → 18.200 DH, gain 5 % → 4.550 DH, all minimums → 800 DH, annual = (additional − fee) × 12). The Fidelix page labels the difference "Bénéfice net"; Loynara deliberately does not (revenue minus fee, not profit). The Loynara chart, typed inputs, validation, reset and table are therefore additions, not Fidelix parity. Motion/animation on the Fidelix calculator was not characterised.

## Verification (local, Chromium)
`npm run marketing:test` 32 unit tests; static verifier (also with `MARKETING_PUBLIC=true`); `browser-check.mjs` 216 checks (widths 1440/1280/1024/768/720/390/360/320, full demo paths incl. all 8 industries, moments, calculator edge cases, chart keyboard/pointer/touch, mail draft encoding, reduced motion, no-JS, 200 % zoom equivalent, console/external-request cleanliness); axe-core: no violations on six page states. No physical device or screen-reader testing.

Lab performance (loopback, 4× CPU throttle, not field data): app.js 90 KB / 32.7 KB gzip; styles 30.6 KB / 7.7 KB gzip; fonts 107 KB total; mobile LCP ≈ 350 ms, CLS 0, TBT ≈ 190 ms; worst interaction event 56 ms (mobile) while dragging a slider and typing.

## Known limitations
- Header blur and sticky stage were checked in emulation only; real iOS Safari behaviour is unverified.
- The guide step list on narrow screens and the sticky stage on short desktop windows switch layout at 1023 px / 699 px height.
- The calculator chart is a scenario graph; Fidelix has none.
- Impressum/Datenschutz text is the operator's published text; this pass did not review it. Datenschutz mentions a "lokale Produktdemo" and clipboard use is not described there (clipboard write occurs only on an explicit "Text kopieren" click and stays on the device).
- Marketing build now needs `npm ci --prefix marketing-site` before `npm run marketing:build`.
