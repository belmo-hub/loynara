# 01 · Product truth: what we may say today

Every script, ad, page and handout in `gtm/` is checked against this file. If a claim is not in the **Sell now** column, it does not go into a sentence that a merchant could read as a promise.

Evidence base:
- Pilot RC plus `product/merchant-completion`, final config commit `71319e6`.
- Marketing Concept D, branch `marketing/concept-d` `978016e`.
- Production config check: email off (`SMTP_HOST=disabled`), live billing refused, NFC only with derived keys.
- Review date 2026-10-05. Re-check this file whenever an RC is deployed.

## Sell now (deployed pilot, evidenced)

| Capability | How to say it (German) | Limit you must say out loud |
|---|---|---|
| Browser customer card via QR | „Dein Kunde scannt den QR-Code am Tresen, die Karte öffnet sich im Browser. Keine App.“ | Needs a phone with a camera and mobile data/Wi-Fi. |
| Stamps or points, rewards | „Du legst fest: 10 Stempel, eine Prämie.“ | One programme per location for the pilot. |
| Staff confirmation | „Ein Besuch zählt erst, wenn dein Team ihn bestätigt.“ | Staff need their own login on a phone or tablet. |
| Roles (owner/manager/staff) | „Jeder Mitarbeiter hat seinen eigenen Zugang.“ | No shared-device PIN mode. |
| Customer referrals | „Stammkunde teilt seinen Link, Bonus erst nach dem ersten bestätigten Besuch des Neuen.“ | No monthly cap. The same verified email is held for review. Bonus amount is frozen at signup. |
| Owner overview & analytics | „Du siehst, wer wiederkommt und wer länger fehlt.“ | Counts only confirmed loyalty activity, not total revenue. Days are UTC-based. |
| Pseudonymous customer list | „Name, letzter bestätigter Besuch, Stempel.“ | No CRM, no notes, no phone numbers. |
| Multi-location | „Ein Konto, mehrere Standorte.“ | Each location is priced separately (€39). |
| Rules-based adviser | „Dashboard schlägt den nächsten sinnvollen Schritt vor.“ | Rules, not AI. Never call it KI. |
| Printable counter sign (Tresenschild) | „Du druckst das Schild aus und stellst es an die Kasse.“ | Printed by the merchant. We don't ship hardware. |
| Export | „Deine Daten kannst du jederzeit exportieren.“ | JSON export, not CSV. |
| Offline award queue | „Fällt das Netz kurz aus, werden Stempel nachgebucht.“ | Rewards are redeemed online only. |
| Lost card (today's path) | „Verliert ein Kunde seinen Kartenlink, bekommt er eine neue Karte, und du buchst die Stempel, die du kennst, ganz normal nach.“ | No self-service recovery. Email recovery is off in production. Tell customers at signup: „Kartenlink speichern.“ See `docs/pilot-recovery-runbook.md` §A. |
| Forgotten staff/owner password | „Passwort vergessen? Wir setzen es nach persönlicher Prüfung zurück.“ | Operator-assisted only, with the owner's approval each time (`pilot-recovery-runbook.md` §B). No self-service reset. |

## Qualified (built in the RC, not yet deployed): say "kommt mit dem nächsten Update", never "geht schon"

| Capability | Allowed phrasing | Switch to *Sell now* when |
|---|---|---|
| Card number lookup (K-XXXXXX) | „Mit dem nächsten Update findet dein Team eine Karte auch über die Kartennummer.“ | RC deployed and verified in production |
| Corrections with reason | „Fehlbuchungen korrigieren – kommt mit dem nächsten Update.“ | same |
| Card reissue (lost phone) | „Neue Karte, gleicher Stand – kommt mit dem nächsten Update.“ | same |
| Readiness checklist | (don't mention in sales; it's onboarding) | same |
| Invite-gated staff signup | „Bis dahin richten wir die Mitarbeiterzugänge gemeinsam ein.“ | `STAFF_INVITE_SIGNUP_ENABLED=true` approved and deployed |

## Future: do not sell, do not imply

Only ever say „zeigen wir als Ausblick, ist nicht Teil des Pilotangebots“. Never put these in a hero, an ad hook, or a price line.

| Not available | Why | Typical trap sentence to avoid |
|---|---|---|
| Campaigns / automations / messages to customers | Production email disabled, sending not approved | „Hol inaktive Kunden automatisch zurück.“ |
| Apple / Google Wallet | Provider-blocked | „Karte direkt im Wallet.“ |
| Physical NFC tap | No physical acceptance test | „Einfach Handy antippen.“ |
| Quiet-hour actions, win-back sending | depend on messaging | „Schick am Dienstag eine Aktion raus.“ |
| Logo on the browser card | deferred | „Deine Karte mit deinem Logo.“ (colour/name only) |
| Self-checkout billing / online signup | live billing refused by config check | „Jetzt online buchen.“ |
| POS / Lieferando / booking-tool integration | not built | „Läuft über deine Kasse.“ |
| Customer email recovery in production | email off | „Kunde stellt die Karte selbst per Mail wieder her.“ |
| Revenue uplift, ROI, retention % | no customers yet | „+20 % Stammkunden.“ |

## Commercial truth

- **Price:** €39 / Monat / Standort (`SITE.price`, marketing-site). This is the only price used anywhere in `gtm/`.
- **Not yet resolved:**
  - VAT treatment (net or gross)
  - Contract term
  - Payment method
  - Invoicing route
  These block collecting money, not having conversations. Launch Ledger items (`docs/launch-ledger/` on branch `docs/launch-ledger-checkpoint-001`): O-001 (operator identity), O-011 (invoice route), O-012 (pricing/VAT), O-013 (legal documents: AGB/AVV).
- **Until resolved:** say „39 € pro Monat und Standort. Die Rechnungsdetails schicke ich dir schriftlich, bevor du irgendetwas zahlst.“ Do not quote a VAT figure. Do not promise a free period.
- **Public website:** not yet published (O-014). Until it is, the walk-in is the channel and the phone demo is the website. No paid ads can run, because they would need a public landing page with an Impressum.

## Proof truth

We have **zero** paying merchants, **zero** testimonials, **zero** measured outcomes. Every example in scripts and ads is labelled *Beispiel* / *Beispieldaten*. The only numbers we may use are arithmetic:
- „Bei 25 € pro Haarschnitt sind 39 € zwei Haarschnitte.“
- The website calculator (*Rechenbeispiel, keine Prognose*).

The first real proof comes from [13-learning-system.md](13-learning-system.md). Record it, ask permission, then use it.
