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

**READY-BUT-LEGAL-GATED.** Do not upload this private bundle publicly yet. It includes the explicitly labelled, unapproved €99 package draft (setup plus month one, then €49). Existing proposed offers remain €99 setup plus €49 or €69 monthly, giving €148 or €168 initially. Contract duration, cancellation and final service scope remain unapproved. `MARKETING_PUBLIC=true` fails closed until legal/contact/commercial launch work is completed; the guard is not itself a publishing permission system.

All inputs and simulated events live only in page memory. No account, storage, analytics or application calls. CSP permits local scripts but forbids connections and form submission. The optional conversation note is downloaded locally; the send button remains disabled. It does not include calculator figures. Industry changes reset the simulation and preserve entered economics. QR artwork encodes a plain demo label, never a real customer or recovery link.

The recording is the existing genuine local synthetic recording, with a text alternative. It uses its original 5-stamp example; the interactive demo explicitly uses a separate 8-stamp rule. No external email or Wallet capability is established by either demonstration.

`browser-evidence.json` records the exact built-source hash, lab conditions and checks; screenshots are in `screenshots/marketing-interactive/`. Measurements are local Chromium lab results, not field INP or a conversion result. Reflow at an effective 200% zoom was emulated by halving the CSS viewport; browser UI zoom and physical screen-reader/device review were not performed.

Publication prerequisites: `LEGAL_LAUNCH_FIELDS.md`. Once approved, use a separate static Cloudflare Pages deployment, never the Mac tunnel. Preserve `preview.getloynara.com`, its tester policy, 30-minute session and database.

References consulted: [Core Web Vitals and lab/field distinctions](https://web.dev/articles/vitals), [optional interaction animation](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html), [target sizing](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Existing hosting handoff: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/).
