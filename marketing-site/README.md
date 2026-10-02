# Loynara marketing site

Static, German-only single page for **https://getloynara.com**. It has no database, application or runtime dependency; the generated `site/` bundle is committed so it can be uploaded as-is.

```sh
npm run marketing:build      # regenerates site/ (3 pages, CSS, browser modules)
npm run marketing:test       # unit tests: demo flow, request builder, copy/claims guards
npm run marketing:verify     # static checks on site/: links, anchors, metadata, CSP, private/old content
npm run marketing:preview    # loopback server on http://127.0.0.1:8765
node marketing-site/browser-check.mjs   # real-browser checks (preview must be running)
```

## Structure
- `src/site.ts` – the single source for the support address, app/login URLs, the €39 offer and the eight industry examples.
- `src/demo.ts`, `src/views.ts`, `src/browser.ts` – the in-page product demo (customer → cashier → owner; NFC tap or QR entry). Runs only in page memory: no network, no storage.
- `src/request.ts` – builds the demo-request e-mail. The page never sends anything; it opens a `mailto:` draft to `support@getloynara.com`.
- `template.ts` – page markup and metadata. `styles.css` – styling (functional pass; the visual redesign is a separate step).
- `legal/impressum.html`, `legal/datenschutz.html` – **operator-approved legal text goes here** (not present yet). Without them the legal pages hold a neutral placeholder and are `noindex`.

## Publication gate
`MARKETING_PUBLIC=true npm run marketing:build` fails while the approved Impressum/Datenschutz fragments are missing. See `LEGAL_LAUNCH_FIELDS.md`. Nothing in this directory deploys anything.

## Routing
- `getloynara.com` → this site (Cloudflare Pages custom domain)
- `www.getloynara.com` → redirect to `getloynara.com` (Cloudflare redirect rule; Pages `_redirects` cannot match hosts)
- `app.getloynara.com` → the Loynara application (unchanged by this site)
The site links to the application only through `https://app.getloynara.com/login` and `/teilnahmebedingungen`.

## Claims boundary
The copy states only what the application does today: browser cards, stamps or points, NFC-tap and QR entry, staff-confirmed visits, customer list, results, team roles, locations, referrals and brand colours. It does not advertise campaigns/e-mail sending, Wallet, billing automation or logo upload (all withheld in production), automatic stamping, NFC payment, Apple VAS/Google Smart Tap, customer numbers or revenue/ROI figures. Physical NFC tags are not yet hardware-verified; the copy describes the flow without claiming deployment or device results. `tests/site.test.ts` guards these boundaries.

The previous audit-copy site (three languages, €49/€69 proposals, calculators, stale screenshots, internal wording) was removed; it remains in git history.
