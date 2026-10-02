# Required before public activation

The site must not be published until the operator supplies and approves the following. None of it is inferred or invented here.

1. **Impressum** – approved HTML fragment at `marketing-site/legal/impressum.html` (operator's full legal name and form, serviceable address, contact e-mail, register/VAT details where applicable, responsible person where applicable).
2. **Datenschutzerklärung** – approved fragment at `marketing-site/legal/datenschutz.html`, covering the actual static hosting (Cloudflare), the support mailbox as the contact channel, and server logs. The page itself sets no cookies, loads no third-party scripts and sends no form data.
3. **Teilnahmebedingungen** – linked to `https://app.getloynara.com/teilnahmebedingungen`. That page is currently an unapproved draft ("Entwurf") inside the application and must be finalised there.
4. **Application privacy page** – `https://app.getloynara.com/datenschutz` currently reads "Entwurf" and "Vor öffentlichem Start ergänzen"; it needs approved text before customers are sent to it.
5. **Support mailbox** – `support@getloynara.com` must receive and be monitored; the demo request is an e-mail to it.
6. **Commercial terms** – the €39 / location / month figure is a provisional pilot offer. Setup fees, contract term, cancellation and VAT treatment are intentionally not stated.
7. **Approval** – Cloudflare Pages project, apex assignment and the `www` redirect, after review of the finished site.

`MARKETING_PUBLIC=true` makes the build fail while items 1–2 are missing.
