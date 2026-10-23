# ENG-072 evidence (Impeccable batch 2, PR H: Abrechnung)

Synthetic owner „Café Lindenblüte“ with two locations, on a fresh database; `next dev` on localhost; headless Chrome; 375 and 1280, light and dark.

- `*-normal-*`: before „3 von 10000 aktiven Karten“, after „3 von 10.000 aktiven Karten“.
- `*-error-*`: the page read fails (the shop's subscription row removed). Before: the raw „Subscription not found“; after: „Das gibt es nicht mehr. Bitte lade die Seite neu.“, with the detail only in the server log.
