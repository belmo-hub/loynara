# Loynara static marketing site

`site/` is the ready-to-upload static bundle for Cloudflare Pages Direct Upload. It has no server, form handler, tracker or connection to the protected preview. It must remain unpublished until operator-specific Impressum and privacy text are reviewed and added. The final publication also needs owner approval of the exact Cloudflare Pages project and apex/www DNS changes. Do not point the root to the Mac tunnel.

After legal completion, upload `site/` as a Direct Upload project in the existing Cloudflare account, attach `getloynara.com` as a custom apex domain, and optionally configure a `www` to apex Bulk Redirect. The preview Access application and route remain separate. Verify HTTPS, the canonical URL, redirect, sitemap, mobile layout and that the root never serves the private app.

Cloudflare references: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [www redirect](https://developers.cloudflare.com/pages/how-to/www-redirect/).
