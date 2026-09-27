# Loynara marketing experience

Static German site with a typed industry/pricing configuration, eight industry routes, a deterministic customer/cashier/owner demonstration, and a contribution calculator. The generated `site/` bundle runs independently of the loyalty application, database and protected preview. No new dependency or paid service was added.

From the repository root:

```sh
npm run marketing:build
npm run marketing:test
npm run marketing:verify
npm run marketing:preview
# Separate terminal, with the loopback preview running:
node marketing-site/browser-check.mjs
```

Local URL: `http://127.0.0.1:8765`. Stop its terminal with Ctrl-C. `preview.mjs` serves only loopback and applies the same headers as the static deployment. Edit `template.ts`, `styles.css` and `src/`; build regenerates HTML, CSS and the small browser modules. `src/config.ts` is the single industry and offer source. Build output is committed so it can be inspected/uploaded without a Node runtime.

**READY-BUT-LEGAL-GATED.** Commercial publication remains blocked; the separately approved audit copy below is the only exception. It includes the explicitly labelled, unapproved €99 package draft (setup plus month one, then €49). Existing proposed offers remain €99 setup plus €49 or €69 monthly, giving €148 or €168 initially. Contract duration, cancellation and final service scope remain unapproved. `MARKETING_PUBLIC=true` fails closed until legal/contact/commercial launch work is completed; the guard is not itself a publishing permission system.

All inputs and simulated events live only in page memory. No account, storage, analytics or application calls. CSP permits local scripts but forbids connections and form submission. The optional conversation note is downloaded locally; the send button remains disabled. It does not include calculator figures. Industry changes reset the simulation and preserve entered economics. QR artwork encodes a plain demo label, never a real customer or recovery link.

The recording is the existing genuine local synthetic recording, with a text alternative. It uses its original 5-stamp example; the interactive demo explicitly uses a separate 8-stamp rule. No external email or Wallet capability is established by either demonstration.

`browser-evidence.json` records the exact built-source hash, lab conditions and checks; screenshots are in `screenshots/marketing-interactive/`. Measurements are local Chromium lab results, not field INP or a conversion result. Reflow at an effective 200% zoom was emulated by halving the CSS viewport; browser UI zoom and physical screen-reader/device review were not performed.

Publication prerequisites: `LEGAL_LAUNCH_FIELDS.md`. Once approved, use a separate static Cloudflare Pages deployment, never the Mac tunnel. Preserve `preview.getloynara.com`, its tester policy, 30-minute session and database.

References consulted: [Core Web Vitals and lab/field distinctions](https://web.dev/articles/vitals), [optional interaction animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), [target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Existing hosting handoff: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).

## Owner-approved public audit copy — 27 September 2026

https://loynara-audit.pages.dev is a separate static Cloudflare Pages project, published with explicit owner approval for GPT Pro website review. Source revision: `3f813e8`. The ignored `var/loynara-audit.zip` contains 29 static files; its derived bundle adds an audit banner, audit-host canonicals and robots meta/header `noindex, nofollow, noarchive`. Crawling is allowed for direct review. This is publicly readable, not private access protection. Unapproved price proposals remain labelled; contact submission remains disabled.

Verified after deployment: anonymous HTTPS 200; CSP and noindex header; rendered audit banner; enrollment/scan simulation remains at zero until explicit +1 confirmation; owner activity then shows one visit and one stamp; reset works. Calculator example F=49, m=8, B=20, H=10, N=10 shows 10 required visits and €1 estimated contribution change. Protected application preview still returns an anonymous 302 Access redirect. No root-domain/DNS, Access, tunnel, database or application changes were made. No paid plan, Functions, subscription or purchase was added; new spending €0. This is an audit publication, not commercial-launch approval.

## Premium marketing pass — 27 September 2026

Original editorial redesign informed by live visual reference review; see `DESIGN_REVIEW.md` for decisions and claim boundaries. Eight distinct industry choices now update reward thresholds, examples and the deterministic story without changing economics. The hero is explicitly controlled; no autoplay. Actual reward/referral captures support four capability groups. NFC remains an upcoming design concept.

`node marketing-site/audit-build.mjs` prepares the existing audit-host bundle under ignored `var/loynara-audit-ready` with noindex and an audit banner. It does not deploy. The latest rendered screenshots are in ignored `evidence/premium-pass/`; browser evidence remains in `browser-evidence.json`. The premium build was published to the existing audit site after owner sign-in; operator/legal/contact and approved commercial terms still block root commercial publication.

### Premium audit deployment verified

Published source `f3a4967` to the existing `https://loynara-audit.pages.dev/` on 27 September 2026 (32 static files). Anonymous HTTPS returned 200; deployed HTML exactly matched the prepared bundle (SHA256 `b8815c172758ae4c8659d5fd4d30f0c6d01a43e79816a3817857c4fc0975e939`). CSP and noindex header remain present. Browser smoke checks: new hero/audit banner rendered, explicit visit confirmation changed 0/8 to 1/8, calculator assumptions produced 10 visits and €1 contribution change. Protected application preview still returned anonymous 302. No DNS, Access, tunnel, database, plan or root-domain changes; new spending €0. The separate web text-fetch tool could not access the Pages URL, so GPT Pro browsing compatibility is not established by the browser/HTTP success.

## Four-input scenario update — 27 September 2026

Source `116c3ab` adds a labelled visit scenario beside the existing cost coverage calculator: customers/day × basket × open days/month × assumed extra visits percentage. Results show added monthly revenue, the recurring software price, revenue after subtracting only that price, their rounded ratio, and 12 equal months. Inputs start blank; sample values require a click. The default price proposal produces €9,100, €9,051, 186× and €108,612 with sample values 50 × €70 × 26 × 10%. These are arithmetic scenarios, not expected outcomes, net profit or ROI. Material, labour, payment, reward and setup costs are omitted from this scenario. The separate cost coverage calculator remains available for them.

The 32-file update was uploaded to the existing `https://loynara-audit.pages.dev/` project. Anonymous HTTPS served the exact prepared HTML (SHA256 `bfabec4368b54fe5fbace2d59009201410a000f614bb2999f87e8f16c6ec822e`) with a noindex header. The live browser example returned €9,100 extra monthly revenue, €49 fee, €9,051 after only that fee, 186× and €108,612 over 12 equal months. No root domain, Access, tunnel or database changes; additional spending €0. Local screenshot evidence: `evidence/premium-pass/traffic-scenario-390.png` and `traffic-scenario-1440.png` (ignored, browser emulation).

## Mobile calculator correction — 27 September 2026

Source `f5f968f` moves the four-slider scenario ahead of the detailed cost calculator, shows visibly labelled example assumptions immediately, aligns editable values with their sliders, separates the result visually, and keeps the site navigation available while scrolling. The result updates immediately; the selected monthly price also updates the detailed calculator. The `Werte leeren` action removes the sample values. Browser checks passed at 360, 390, 768, 1024 and 1440 CSS pixels, with reduced motion and keyboard controls. The existing audit site was updated with the 32-file static bundle; anonymous HTTPS returned 200 and the deployed HTML matched the prepared bundle (SHA256 `045c758d0b7aebe1ab932d9a21e28bae026aa1e3396c3245e6933ca6230b4eaf`). CSP and noindex headers remained present. A live browser interaction changed the scenario result to €18,200 when the uplift slider was moved to 20%. No root-domain, protected-preview, DNS, database or Access change; additional spending €0.

## Fluid UI refinement — 27 September 2026

Recomposed forest/ivory hero and mobile product scene, locally hosted licensed Geist, smoother selection/step transitions and a live industry preview. Slider editing preserves layout and precise values; price choices stay synchronized; demo focus and calculator announcements follow actions; feature images and captions change together after decoding. See the latest `DESIGN_REVIEW.md` entry and `browser-evidence.json` for the 26 passing browser checks and lab limitations. The existing calculator formula, proposed commercial terms and protected loyalty application are unchanged. Screenshots: `evidence/premium-pass/before-fluid-home-{390,1440}.png` and `home-{390,1440}.png` (local/ignored).

Published the 34-file refinement bundle from source `e2dcee9` to the existing audit project. Anonymous curl HTTPS returned 200; HTML SHA256 `eb91e710376a88a54bb7e7ac4c4e5929a8a1b424bc81667b045dde9e53e68c50` matched the prepared bundle, as did CSS, browser script and font. CSP/noindex headers remained. Live browser smoke checks passed: explicit hero confirmation 0→1, slider at 20% shows €18,200, price controls remain synchronized. The Python HTTP client received 403 while curl and the browser succeeded; universal agent/text-fetch compatibility is not established. No DNS, Access, tunnel, database, root-domain or paid-plan changes. Additional spending €0. One upstream licence trailing space was normalized without changing its text.

## English + Arabic — 27 September 2026

The marketing site now has 33 statically rendered pages: German at the existing paths, English under `/en/`, and Modern Standard Arabic under `/ar/`. A persistent language selector links equivalent pages without JavaScript; metadata, canonical/hreflang links, all eight industries, FAQ, pricing proposals, calculator errors/assumptions, the complete interactive demo and local note downloads are translated. The original application captures and recording remain German and are explicitly labelled, with a translated recording transcript. This work does not localize the protected merchant application or approve a new market launch.

Arabic uses RTL layout, isolated monetary/transaction values, and locally hosted [Noto Sans Arabic](https://github.com/google/fonts/tree/main/ofl/notosansarabic) with its SIL OFL licence included. No runtime font/translation service is used. Both Arabic-Indic and Persian digits are normalized for input; decimal/group separators follow the chosen locale. EUR, programme thresholds, prices and calculation rules are unchanged. Static copy lives in `template-copy.ts`; dynamic copy is in `src/dynamic-copy.ts` and locale-aware UI functions. Missing static translations fail the build.

Verification: typecheck, lint, build, 15 unit/calculator/localization tests, static checks for all 33 pages, 26 existing German browser checks and 11 EN/AR browser check groups PASS. `node marketing-site/locale-browser-check.mjs` exercises both full journeys, all industry routes, pricing, numeric validation, local download, keyboard, reduced motion, no-JS navigation, five viewport sizes and 200%-equivalent reflow. Evidence: `locale-browser-evidence.json`; screenshots: ignored `evidence/languages/`. The visual pass corrected a vertically stacked mobile selector, English headline wrapping and RTL signed-count ordering. These are browser emulation results; physical-phone, screen-reader and native-language human editorial review are not claimed. Root commercial launch remains gated, the app preview is unchanged, and additional spending is €0.
