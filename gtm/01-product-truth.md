# 01 · Product truth: three evidence states

Every script, ad, page and printed piece in `gtm/` is checked against this file. Angles in [02](02-positioning-angles.md) carry the matching status.

| Evidence state | Meaning | Angle status |
|---|---|---|
| **LIVE NOW** | Running in production today and evidenced in the deployed code | SELL NOW (or QUALIFIED where a boundary sentence is required) |
| **RC READY — NOT DEPLOYED** | Implemented and hardened in the merchant-completion RC candidate, not deployed | RC READY |
| **FUTURE / NOT READY** | Not built, not enabled, or blocked by a provider or a physical test | FUTURE / DO NOT SELL YET |

**Evidence base (reviewed 2026-10-05):**
- **Production:** the pilot RC line (`65f32fd`). On production, `lib/pilot-surfaces` withholds billing, campaigns, automations, audiences, Wallet previews, the card logo and the NFC surface. The deployed commit is as reported in the release handoff; this pass did not inspect production.
- **RC candidate:** `product/merchant-completion` at `71319e6` (hardening `3f0a450`, docs `bee812d`). Not deployed.
- **Production config:** email off (`SMTP_HOST=disabled`), live billing refused, NFC only with the derived-key provider.
- **Re-check this file** the day the RC is deployed. The website switches its copy with one line (see [15-copy-switches.md](15-copy-switches.md)).

## LIVE NOW

| Capability | How to say it (German) | Boundary you must keep |
|---|---|---|
| Browser customer card via QR | „Dein Kunde scannt den QR-Code am Tresen, die Karte öffnet sich im Browser. Keine App.“ | Needs a phone with a camera and a data connection. |
| Stamps or points, rewards | „Du legst fest: zehn Stempel, eine Prämie – oder Punkte.“ | One programme per location in the pilot. |
| Staff confirmation, exactly once | „Ein Besuch zählt erst, wenn dein Team ihn bestätigt.“ | Staff need their own login on a phone or tablet. |
| Several stamps in one step | „Bei einer großen Bestellung vergibt dein Team mehrere Stempel auf einmal.“ | — |
| Roles and team access | „Jeder Mitarbeiter hat seinen eigenen Zugang, als Kasse oder Leitung. Zugänge kannst du sperren.“ | Invitees cannot self-register in production yet; the operator provisions staff accounts. No shared-device PIN mode. |
| Customer referrals | „Stammkunde teilt seinen Link, Bonus erst nach dem ersten bestätigten Besuch des Neuen.“ | No monthly cap. The same verified email is held for review. The bonus amount is frozen at signup. |
| Analytics (Auswertung) | „Du siehst neue Karten, bestätigte Besuche, wiederkehrende Karten und Prämien.“ | Counts only confirmed loyalty activity, not revenue. Days are UTC-based. |
| Customer cards (pseudonymous) | „Pro Karte siehst du Stand, bestätigte Vorgänge, ersten und letzten Vorgang und den Empfehlungsstatus.“ | **No names and no contact data** („Namen und Kontaktdaten zeigt Loynara hier nicht“). Cards are labelled by an internal ID. There is no list of dormant or near-reward customers in production (audiences are withheld). |
| Rule-based hints | „Hinweise nach festen Regeln, mit Begründung.“ | Hints, not actions. Never call it KI. |
| Team access history | „Du siehst die letzten Teamereignisse, etwa Einladungen und Sperrungen.“ | Access events only. Per-card booking history arrives with the RC. |
| Multi-location | „Ein Konto, mehrere Standorte.“ | Each location is priced separately. |
| Printable counter sign (Tresenschild) | „Du druckst das Schild aus und stellst es an die Kasse.“ | Printed by the merchant; no hardware is shipped. |
| Export | „Deine Daten kannst du jederzeit exportieren.“ | JSON export, not CSV. |
| Offline award queue | „Fällt das Netz kurz aus, werden Stempel nachgebucht.“ | Rewards are redeemed online only. |
| No double booking | „Zweimal getippt? Trotzdem nur ein Stempel.“ | — |
| **Lost card link (today)** | „Wer seinen Kartenlink gespeichert hat oder auf demselben Handy den QR-Code erneut nutzt, kommt wieder zu seiner Karte. Ist er weg, legt der Kunde eine neue Karte an, und du buchst die Stempel, die du kennst, als normale Buchung nach.“ | This is **today's** path (`docs/pilot-recovery-runbook.md` §A), not the permanent product. Tell customers at signup: „Kartenlink speichern.“ After the RC: reissue (below). |
| Forgotten staff or owner password | „Passwort vergessen? Wir setzen es nach persönlicher Prüfung zurück.“ | Operator-assisted only, with the owner's approval each time (runbook §B). |

## RC READY — NOT DEPLOYED

Say these only as „kommt mit dem nächsten Update“, and always say today's live path next to them. Never in a hero, ad hook or price line before deployment.

| RC capability | Before deployment (say this) | After deployment (switch to this) |
|---|---|---|
| Short random card number (locator, e.g. `K-7QX2MA`) on the card and in the owner list | „Mit dem nächsten Update bekommt jede Karte eine kurze Kartennummer.“ | „Jede Karte hat eine kurze Kartennummer.“ |
| Cashier manual lookup fallback | „Heute: Karte scannen. Mit dem nächsten Update findet dein Team sie auch über die Kartennummer.“ | „Klappt der Scan nicht, findet dein Team die Karte über ihre Kartennummer.“ |
| Compensating corrections with reason (owner/manager) | „Fehlbuchungen korrigieren – kommt mit dem nächsten Update.“ | „Falscher Stempel? Du oder deine Leitung korrigiert ihn mit Begründung; der Verlauf bleibt sichtbar.“ |
| Merchant-assisted card reissue (owner/manager entitlement check) | „Heute: neue Karte und Stempel nachbuchen. Mit dem nächsten Update stellst du die Karte neu aus, mit gleichem Stand.“ | „Handy weg? Du oder deine Leitung stellt die Karte neu aus: gleiche Mitgliedschaft, gleicher Stand, gleicher Verlauf, gleiche Kartennummer.“ |
| Reissue invalidates the old link and QR | (part of the line above) | „Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr.“ |
| Per-card booking timeline with source labels and correction reasons | „Mit dem nächsten Update siehst du pro Karte jede Buchung mit Ursprung.“ | „Jede Buchung hat einen Ursprung und, bei Korrekturen, einen Grund.“ |
| Invite-gated staff signup (`STAFF_INVITE_SIGNUP_ENABLED`) | „Die Mitarbeiterzugänge richten wir gemeinsam ein.“ | „Du lädst dein Team per Link ein; nur die eingeladene Adresse kann sich anmelden.“ (only once the flag is approved and deployed) |
| State-derived readiness checklist | (onboarding only) | „Du siehst jederzeit, was vor dem Start noch fehlt.“ |
| Quiet-hours policy (21–09 local, defer not drop) | Not a sales claim while messaging is off | Becomes a TRUST line only when messaging is enabled (TRU-06) |
| Login hydration fix | No marketing claim | No marketing claim |
| NFC surface no longer withheld in production (NFC v1) | „Antippen per NFC ist vorbereitet.“ | Still QUALIFIED until physical tag acceptance passes (next section) |
| Owner export includes card numbers and reissue audit | „Export als JSON.“ | „Export als JSON, mit Kartennummern.“ |

**Switch trigger:** the RC is deployed AND its targeted production verification passed (locator lookup, reissue keeping balance/history/locator with old access dead, correction). Then flip `rcDeployed` in `marketing-site/src/claims.ts` and replace the RC lines in `gtm/` per [15-copy-switches.md](15-copy-switches.md).

## QUALIFIED / PREVIEW (live or built, but only with the boundary sentence)

| Capability | Allowed wording | Gate to full claim |
|---|---|---|
| NFC tap at the counter | „Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick. Gestartet wird mit dem QR-Code.“ | RC deployed **and** physical tag acceptance passed in production → NFC primary, QR fallback |
| „Who comes back“ | „Du siehst, wie viele wiederkommen, und pro Karte den letzten Besuch.“ | Never „wer“ by name; the list is pseudonymous |
| Branding | „Deine Farbe und dein Ladenname auf Karte und Schild.“ | Logo on the card is FUTURE |
| Referral performance | „Pro Karte siehst du den Empfehlungsstatus und wie viele sie geworben hat.“ | No aggregate referral report is claimed |

## FUTURE / NOT READY: do not sell, do not imply

Only ever say „zeigen wir als Ausblick, ist nicht Teil des Pilotangebots“.

| Not available | Why | Trap sentence to avoid |
|---|---|---|
| Campaigns, automations, messages to customers (win-back, near-reward, welcome, quiet-hour actions) | Production email disabled; surfaces withheld | „Hol inaktive Kunden automatisch zurück.“ |
| Lists of dormant or near-reward customers (audiences) | Withheld in production | „Du siehst auf einen Blick, wer fehlt.“ |
| Day/time patterns, campaign return, acquisition source, location comparison | Not in live analytics | „Du siehst, wann es ruhig ist.“ |
| Apple / Google Wallet | Provider-blocked | „Karte direkt im Wallet.“ |
| Physical NFC acceptance | Not yet tested on real tags | „Einfach Handy antippen.“ (before the gate) |
| Logo on the browser card; premium stand | Withheld / not offered | „Deine Karte mit deinem Logo.“ |
| Self-checkout billing / online signup | Live billing refused by the config check | „Jetzt online buchen.“ |
| POS, delivery-platform or booking-tool integration | Not built | „Läuft über deine Kasse.“ |
| Customer email recovery in production | Email off | „Kunde stellt die Karte selbst per Mail wieder her.“ |
| Revenue uplift, ROI, retention % | No customers yet | „+20 % Stammkunden.“ |

## Commercial truth: project gates vs legal requirements

- **Price:** €39 / Monat / Standort (`SITE.price`). This is the only price used anywhere in `gtm/`.

**Project commercial / launch gates.** These are owner decisions recorded in the Launch Ledger (`docs/launch-ledger/` on branch `docs/launch-ledger-checkpoint-001`):

| Gate | What it is |
|---|---|
| O-001 | Operator identity (who the merchant contracts with; Impressum data) |
| O-011 | Invoice route |
| O-012 | Pricing and VAT presentation of the €39 |
| O-013 | Commercial and data-protection documents (AGB, AVV) |
| O-014 | Publishing the public website |
| D-1 | Pilot terms before invoicing exists |

**Legal requirements** are a separate question. Whether and how any of these documents is legally required before a first payment, before processing a merchant's customer data, or before publishing is for qualified legal and tax review. This file does not claim that a missing document makes payment collection legally impossible. The gates exist because the owner decided to clear them first.

**What GTM may do before the gates clear:**
- Visit merchants
- Demo
- Ask for product feedback
- Invite merchants to **express pilot interest**, recorded in `pipeline.csv` as `pilot_interest_date`

**What GTM may not do until the owner separately clears the gates:**
- Collect payment
- Promise a paid-start date
- Improvise terms, discounts or free months
- Take a merchant live with real customer data (D-1)

**The founder line until then:**
> „39 € pro Monat und Standort. Bevor du irgendetwas zahlst, bekommst du alle Bedingungen schriftlich – ein Startdatum nenne ich dir erst, wenn die stehen.“

## Proof truth

We have **zero** paying merchants, **zero** testimonials and **zero** measured outcomes. Every example in scripts, pages and ads is labelled *Beispiel* / *Beispieldaten*, and owner screens show pseudonymous cards. The only numbers we may use are arithmetic:
- „Bei 25 € pro Haarschnitt sind 39 € zwei Haarschnitte.“
- The website calculator (*Rechenbeispiel, keine Prognose*).

The first real proof comes from [13-learning-system.md](13-learning-system.md): record it, ask permission, then use it.
