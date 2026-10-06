# Public Concept D website release · 6 October 2026

Prepared only. No Cloudflare production mutation or deployment performed.

## Source and isolation

Starting SHA: `191e156b6f4fed8b7ebd27ff7deb608a4b6db038`, branch `marketing/gtm-first-100`.
Release branch: `codex/marketing-public-release`, isolated worktree `/Users/youssefbelmokhtar/.codex/worktrees/marketing-public-release/Loynara`.
Concept D SHA `978016e` is an ancestor; the five intervening commits add GTM/supporting pages, reconciliation and the field kit. The source branch has no later local commit. A successful `git ls-remote origin 'refs/heads/marketing/*'` returned no remote marketing refs. Existing untracked field files in the original GTM worktree were not copied or edited.
Claude's worktrees, application RC branches, application source, Railway, DNS and production product flags were not changed.

## Exact changes

- `src/claims.ts`: `rcDeployed: true`, `nfcAccepted: false`; live manual lookup in format K-XXXXXX, owner/manager correction with reason, secure reissue keeping membership, balance, history and card number; old link and card QR invalidated.
- `template.ts`: preserve Concept D headline, structure, typography, visuals and interaction; use the requested retention/referral core line in German in the hero lead; add one correction FAQ.
- `src/pages.ts`: expose the same live lookup, correction and recovery details through native FAQ disclosures on `/fuer-barber/` and `/fuer-pizzerien/`. `/empfehlungen/` remains truthful and unchanged.
- Regenerate the committed public HTML/browser bundle. Update claim guards and release-state documentation.
- QR remains primary. NFC is prepared outlook; TAG-01 preview acceptance does not imply production availability. Wallet and promotional sending/automations remain unsent, labelled previews.
- Proposed pilot price remains 39 €/month/location. Demo mail drafts remain the acquisition path; no public registration, payment, discount, urgency, proof or ROI guarantee was added. Commercial onboarding remains a personal discussion.

## Verification

- Full `npm run marketing:test`: 79/79 passed, including GTM angle/field-kit tests and both gate variants; final run on Node 26.3.0.
- `MARKETING_PUBLIC=true npm run marketing:build`: passed, including marketing TypeScript check; six public pages, no concepts. `MARKETING_PUBLIC=true npm run marketing:verify`: passed, 180 links/anchors/assets, metadata, CSP and browser data-flow checks.
- Public concepts guard: expected rejection verified. Build rejects test-only gate override through the suite. No public `.invalid` flows or signup/payment CTA.
- `node gtm/data/angles.mjs`: 76 canonical angles, 169 sources; generated files already current (0 writes).
- Existing `browser-check.mjs`: 400/400 passed, final run on Node 26.3.0. Navigation, returning/new-card flows, redemption, duplicate-action safety, referrals, colour/logo/reward/Wallet controls, owner preview tabs, calculator edges/keyboard/zero/invalid input, request industry selection, mail draft encoding, clipboard fallback, print, orientation, reduced motion, enlarged text and no JavaScript.
- `pages-check.mjs`: 211/211 passed; all four requested routes at 320, 360, 390×844, 768, 1280×800, 1440×900; reduced motion, keyboard FAQs, 200% text and no JavaScript. Full interaction suite also checks 1024, 430, 375 and 360.
- `a11y-check.mjs`: 14 states, zero automated violations. No console-breaking errors, clipped controls or horizontal overflow found.
- Performance lab, loopback Chromium with 4× CPU throttle: mobile LCP 252 ms / CLS 0 / TBT 95 ms; desktop LCP 148 ms / CLS 0 / TBT 44 ms. These are lab measurements, not field metrics.
- Independent review: no release blockers; clarified the team antecedent and authorized correction roles. `git diff --check` passed.
- Screenshot inspection: desktop/mobile hero, 320 calculator, 768 demo, industry/referral pages, social image and recovery disclosures. No redesign needed.

Local dependency reads initially stalled through the Desktop checkout's old dependency directory. The isolated release worktree now uses the existing marketing dependency directory. Final build, tests and interaction checks pass on the required Node 26 runtime. No dependency or public stylesheet change was necessary. Safari, physical phones and screen readers were not exercised; email receipt/reply was not externally tested or sent during this work.

## Cloudflare state verified read-only

Account: `3d22051f9fe1732ae3c62e210795629a`. Pages project: `loynara-marketing` (direct upload, no Git provider, no functions or configured analytics). Production branch: `marketing/functional-v1`.
Domains: `getloynara.com`, `loynara-marketing.pages.dev`; `www.getloynara.com` redirects to apex.
Current canonical production deployment: `39480f99-36d1-4dc8-b26c-5ca3e90218e5`, source `88632be4e78b056e262aa7a1dfb418c843ef4284`, successful 2026-10-02 17:21:31 UTC.
Current immutable deployment: https://39480f99.loynara-marketing.pages.dev . Apex and immutable URL both served the old functional homepage with status 200. Supporting URLs on current production fall back to that homepage; the candidate contains distinct supporting HTML pages.
Concept D preview: `2f4a0e4f-8a68-47a7-853e-12c1f5d03656`, source `978016e`, https://2f4a0e4f.loynara-marketing.pages.dev . Preview is not a production rollback target.
Previous production rollback target before this release: `1afeb19c-10da-4a74-a3c2-56bbc3df542d`, source `548faf623a541fc81722df02a9af28158ca4e94d`.
Immediate rollback target after the proposed upload: current successful production `39480f99-36d1-4dc8-b26c-5ca3e90218e5`.

## Production action — requires explicit owner approval

From this clean isolated worktree, first recheck canonical deployment and production branch; if they differ from the record, stop and reconcile before upload. Use the already verified committed `marketing-site/site` bundle. Do not upload concepts or GTM collateral.

```sh
npx --no-install wrangler pages deploy marketing-site/site \
  --project-name loynara-marketing \
  --branch marketing/functional-v1 \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "release(marketing): reconcile Concept D with live product truth" \
  --commit-dirty=false
```

The branch argument intentionally matches the existing Cloudflare production branch; it does not switch or edit the Git functional branch. This publishes the reviewed Concept D candidate to `https://getloynara.com` through the existing project, without DNS mutation.
After approval and upload: verify Cloudflare canonical deployment ID/source/status and all four routes, assets, headers, demo/mail CTAs, QR-first wording and 39 € pricing on the apex. Retain immutable deployment URL and rollback ID.

Rollback action if needed: use Cloudflare Pages → `loynara-marketing` → Deployments → `39480f99` → Rollback to this deployment; or authorized authenticated POST to `/accounts/3d22051f9fe1732ae3c62e210795629a/pages/projects/loynara-marketing/deployments/39480f99-36d1-4dc8-b26c-5ca3e90218e5/rollback`, then verify apex and canonical ID.
[Cloudflare rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/) · [API rollback action](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/deployments/methods/rollback/).

Screenshots, test logs and bundle checksums live in ignored `marketing-site/evidence/`; they are not included in the deployment bundle. Final candidate SHA is the single release commit containing this handoff, reported with the approval request.
