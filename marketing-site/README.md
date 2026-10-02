# Loynara marketing site

Static, German-only single page (seven scenes: hero, journey, owner workspace, branding studio, calculator, offer/FAQ, closing) for **https://getloynara.com** (plus Impressum and Datenschutz). No database, application or runtime dependency; the generated `site/` bundle is committed so it can be uploaded as-is.

```sh
npm ci --prefix marketing-site        # once: Motion, esbuild, font packages, axe-core (marketing-site only)
npm run marketing:build               # typecheck + regenerate site/ (HTML, CSS, one minified app.js with Motion bundled)
npm run marketing:test                # unit tests: calculator maths, demo state machine, request builder, copy/claim guards
npm run marketing:verify              # static checks on site/: links, anchors, metadata, CSP, private/old content
PORT=8780 npm run marketing:preview   # loopback server (default port 8765)
BASE=http://127.0.0.1:8780 node marketing-site/browser-check.mjs   # real-browser checks (preview running)
BASE=http://127.0.0.1:8780 node marketing-site/a11y-check.mjs      # axe-core WCAG A/AA scan
BASE=http://127.0.0.1:8780 node marketing-site/perf-check.mjs      # lab metrics, 4x CPU throttle
BASE=http://127.0.0.1:8780 node marketing-site/measure.mjs <label>  # page height, default-visible words, unique copy (writes marketing-site/evidence/, git-ignored)
```

## Structure
- `src/site.ts` – single source for support address, app/login URLs, the €39 offer and the eight industry examples (reward, nouns, scene copy).
- `src/calc.ts` – calculator maths (integer cents), German input parsing/validation, formatting, axis scale. `src/chart.ts` – SVG chart (two geometries), tooltip and table markup.
- `src/demo.ts` – the counter demo as one deterministic state machine (plus chapter snapshots); `src/ref.ts` – the referral example; `src/brand.ts` – the branding example (five colour presets, three logos, three reward options); `src/views.ts` derives the journey stage, owner workspace, stand, Wallet preview and studio from those states.
- `src/browser.ts` – wiring and motion (Motion's `animate`/`inView`; CSS for simple states). Everything lives in page memory: no network, no storage.
- `src/request.ts` – builds the demo-request e-mail. The page never sends anything; it opens a `mailto:` draft to `support@getloynara.com`.
- `template.ts` – page markup and metadata. `styles.css` – design tokens and layout. `build.mts` – build.
- `legal/impressum.html`, `legal/datenschutz.html` – operator-approved legal fragments (published). `MARKETING_PUBLIC=true` fails the build if they are missing.

## Delivery
`getloynara.com` → this site (Cloudflare Pages); `www` → redirect to the apex; `app.getloynara.com` → the application (untouched). `site/_headers` carries the CSP (no inline script or style, no third-party origins) and the cache header required by the Cloudflare delivery setup.

## Claims boundary
The page shows what the pilot offer includes today (cards, stamps/points, rewards, NFC and QR entry, staff confirmation, roles, customer overview, results, referrals, locations) and marks campaigns, messaging, automated reminders and Wallet as a platform outlook that is not part of the offer. Message previews are labelled as not sent. The calculator is a labelled scenario, not a forecast. No testimonials, logos, customer counts, uplift percentages or device-compatibility claims. Physical NFC tags are not described as verified. `tests/site.test.ts` guards these boundaries.
