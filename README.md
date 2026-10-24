# ENG-072 evidence (Impeccable batch 2, PR H: Abrechnung)

Synthetic owner „Café Lindenblüte“ with two locations, on a fresh database; `next dev` on localhost; headless Chrome; 375 and 1280, light and dark.

- `*-normal-*`: before „3 von 10000 aktiven Karten“, after „3 von 10.000 aktiven Karten“.
- `*-error-*`: the page read fails (the shop's subscription row removed). Before: the raw „Subscription not found“; after: „Das gibt es nicht mehr. Bitte lade die Seite neu.“, with the detail only in the server log.
- `*-live-noplan-*` / `*-live-founding-*` (L10, live billing view with synthetic test-mode settings, no Stripe call): before, „98,00 €“ shown while „Tarif offen · 49,00 € / Monat“; after, no amount before a plan („Tarif offen“, „Dein Preis wird mit dir vereinbart.“), and once the founding plan is set „78,00 €“ with „39,00 € pro Standort und Monat. Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.“ (VAT line from the setting).
