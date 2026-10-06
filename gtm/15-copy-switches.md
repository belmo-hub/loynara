# 15 · Copy switches: NFC and RC release

Two product gates change what Loynara may say. The website switches with **one line** in `marketing-site/src/claims.ts`. Both versions of every gated sentence live there side by side and are tested (`marketing-site/tests/claims.test.ts`). The GTM documents switch with the exact replacements below.

| Gate | Flag in `src/claims.ts` | Flip only when | Owner of the decision |
|---|---|---|---|
| **NFC acceptance** | `nfcAccepted` | (1) the merchant-completion RC is deployed, **and** (2) the physical NFC tag acceptance test (`PHYSICAL_NFC_TEST.md`) has passed in production on real phones | Owner, on the test record |
| **RC release** | `rcDeployed` | The RC is deployed **and** its targeted production verification passed: locator lookup at the counter; reissue keeps membership, balance, history and locator while the old link/QR stop working; a compensating correction | Owner, on the verification record |

The gates are independent: the RC can ship before NFC acceptance passes.

## Public website release state · 2026-10-06

The owner confirmed canonical application `c822d2381dc67544a0ba0c898bf2ddcf98035943` healthy in production, including manual K-XXXXXX lookup, correction and secure same-membership reissue. The public website gate is now `rcDeployed: true`, `nfcAccepted: false`. TAG-01 passed physical acceptance in preview only; production NFC, Wallet and promotional sending remain disabled. The historical before/after tables below describe the transition; printed collateral and sales-kit updates are a separate workstream.

## Positioning rule for NFC

- **Pre-NFC-acceptance (now):** QR is primary. NFC is qualified as „vorbereitet“ / „Ausblick“ (owner-approved temporary wording). NFC stays a **major** angle (CORE-11), not a demoted one.
- **Post-NFC-acceptance:** NFC is primary, QR is the fallback. Hero line: „Antippen oder QR-Code“. Spoken line: „Handy an den Tresen halten – oder QR-Code scannen.“

## Procedure on the day a gate passes

1. Set the flag in `RELEASED_GATES` (`marketing-site/src/claims.ts`).
2. Update the first test in `tests/claims.test.ts` to the new released state. It fails on purpose until you do, so the switch is never accidental.
3. Run `npm run marketing:test`, `npm run marketing:build`, `npm run marketing:verify`, then the browser, pages and accessibility checks against the preview.
4. Apply the GTM replacements below, set the affected angles' `status` in `gtm/data/angle-library.csv`, and run `node gtm/data/angles.mjs`.
5. Publishing stays a separate decision (O-014).

## Website: exact copy, NFC gate

| Where | QR (now) | NFC (after the gate) |
|---|---|---|
| Homepage meta/social description (`social`) | Per QR-Code, ohne App | Antippen oder QR-Code, ohne App |
| Hero fact chip (home + vertical pages) (`fact`) | Per QR-Code | Antippen oder QR-Code |
| Home FAQ „Müssen meine Kunden eine App installieren?“ (`appAnswer`) | Nein. Die Karte öffnet sich im Browser, sobald dein Kunde den QR-Code am Tresen scannt. | Nein. Dein Kunde hält sein Handy an den NFC-Tag am Tresen oder scannt den QR-Code – die Karte öffnet sich im Browser. |
| Home FAQ, NFC question (`nfcFaq`) | Und NFC zum Antippen? → Das Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick. Gestartet wird mit dem QR-Code. Er öffnet dieselbe Karte und bleibt auch später immer als Alternative. | Und wenn ein Handy kein NFC kann? → Dann scannt dein Kunde den QR-Code. Er öffnet dieselbe Karte und bleibt immer als Alternative. |
| Home FAQ „Was gehört zum Pilotangebot“ (entry) (`pilotEntry`) | QR-Einstieg | NFC- und QR-Einstieg |
| Home FAQ „Was gehört zum Pilotangebot“ (outlook list) (`pilotOutlook`) | Aufsteller, NFC-Antippen, Wallet-Karte, Logo-Darstellung sowie Kampagnen und Nachrichten | Aufsteller, Wallet-Karte, Logo-Darstellung sowie Kampagnen und Nachrichten |
| Price card list item (`included`) | QR-Einstieg am Tresen | NFC-Antippen und QR-Einstieg am Tresen |
| Price card fine print (outlook list) (`priceOutlook`) | Aufsteller, NFC-Antippen, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten | Aufsteller, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten |
| Roles strip, „Kunde“ (`roleCustomer`) | Scannt den Code, sammelt bis zur Prämie. | Tippt an oder scannt, sammelt bis zur Prämie. |
| Visit demo caption (`visitCaption`) | Dein Kunde scannt den QR-Code am Tresen. | Dein Kunde hält sein Handy an den Tresen oder scannt den QR-Code. |
| Visit demo, first phone sheet (`sheetStart`) | QR-Code am Tresen scannen → Die Karte öffnet sich im Browser. | Handy an den Tresen halten → Oder QR-Code scannen. Die Karte öffnet sich im Browser. |
| Counter stand illustration text (`standText`) | Scannen und sammeln | Antippen oder scannen |
| Counter stand accessible name (`standAria`) | Aufsteller am Tresen mit QR-Code, Gestaltungsbeispiel | Aufsteller am Tresen mit NFC und QR-Code, Gestaltungsbeispiel |
| /fuer-barber/ step „Einmal anmelden“ (`pageSignup`) | Der Kunde scannt den QR-Code an deinem Tresen. Die Karte öffnet sich im Browser. | Der Kunde hält sein Handy an den NFC-Tag an deinem Tresen oder scannt den QR-Code. Die Karte öffnet sich im Browser. |
| /fuer-pizzerien/ step „Einmal anmelden“ (`pageSignupShort`) | QR-Code am Tresen scannen. Die Karte öffnet sich im Browser. | Handy an den Tresen halten oder QR-Code scannen. Die Karte öffnet sich im Browser. |
| Vertical page FAQ „Brauchen meine Kunden/Gäste eine App?“ (`pageAppAnswer`) | Nein. Die Karte läuft im Browser. Einmal den QR-Code scannen, danach öffnet der gespeicherte Link die Karte. | Nein. Die Karte läuft im Browser. Einmal antippen oder den QR-Code scannen, danach öffnet der gespeicherte Link die Karte. |
| Vertical page FAQ „Apple Wallet oder NFC?“ (`pageWalletFaq`) | Was ist mit Apple Wallet oder NFC? → Beides zeigen wir als Ausblick; das Antippen per NFC ist vorbereitet. Gestartet wird mit dem QR-Code im Browser – das funktioniert mit jedem Handy, das QR-Codes scannen kann. | Was ist mit Apple Wallet oder NFC? → Antippen per NFC funktioniert, der QR-Code bleibt immer als Alternative. Die Wallet-Karte zeigen wir als Ausblick. |

Visual note: the counter-stand illustration changes only its text. Re-adding a tap symbol to the stand is an optional design task after the gate.

## Website: exact copy, RC gate

| Where | LIVE (now) | RC (after the gate) |
|---|---|---|
| Home FAQ „Was macht mein Team an der Kasse?“ (`counterAnswer`) | Es sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Erst dann gibt es einen Stempel, genau einmal. Bezahlt wird wie bisher; Loynara ist keine Kassenanbindung und kein Bezahlsystem. | Es sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Klappt der Scan nicht, findet dein Team die Karte über ihre kurze Kartennummer. Erst dann gibt es einen Stempel, genau einmal. Bezahlt wird wie bisher; Loynara ist keine Kassenanbindung und kein Bezahlsystem. |
| Home FAQ „Was passiert, wenn jemand seine Karte nicht mehr findet?“ (`lostAnswer`) | Die Karte gehört zu einem privaten Link. Wer ihn gespeichert hat oder das Schild beziehungsweise den QR-Code erneut nutzt, kommt wieder zu seiner Karte. Eine pauschale Wiederherstellungsgarantie geben wir nicht. | Die Karte gehört zu einem privaten Link. Wer ihn gespeichert hat, kommt jederzeit wieder zu seiner Karte. Ist er verloren, stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer. Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr. |

## GTM documents: NFC gate

| File | Replace (now) | With (after NFC acceptance) |
|---|---|---|
| `gtm/data/angle-library.csv` CORE-11 | status QUALIFIED; hook „Antippen per NFC ist vorbereitet – heute startest du mit dem QR-Code.“ | status SELL NOW; hook „Antippen. Öffnen. Sammeln.“; use adds `static-ad;video;content;demo` |
| CORE-04 boundary | „QR is the live entry. NFC only as prepared outlook…“ | „Antippen oder QR-Code; QR bleibt die Alternative.“ |
| [05](05-sales-playbook.md) walk-in hand-the-phone line | „Halt mal deine Kamera drauf.“ | „Halt mal dein Handy hier an den Tresen. … Geht auch per Kamera, falls dein Handy kein NFC hat.“ |
| [06](06-demo-script.md) step 1 | QR scan | Tap the demo tag, then show the QR as the fallback |
| [07](07-objections.md) WALLET-NFC | „Wallet-Karte und Antippen per NFC sind Ausblick…“ | „Antippen per NFC geht, der QR-Code bleibt die Alternative. Die Wallet-Karte ist Ausblick.“ |
| [08](08-ad-concepts.md) AD-03 / AD-16 | „Keine App. Kein Gerät. Ein QR-Code am Tresen.“ / „Kamera drauf“ | New cut: „Keine App. Antippen oder scannen.“ / „Antippen – fertig“ with the real tag |
| [12](12-collateral.md) handout „So läuft's“ step 1 and the Ausblick list | QR scan; „Antippen per NFC“ in the Ausblick list | „Handy an den Tresen halten oder QR-Code scannen“; remove NFC from the Ausblick list |
| [02](02-positioning-angles.md) spoken positioning | „…ohne App.“ | „…ohne App – antippen oder QR-Code scannen.“ |

## GTM documents: RC gate (recovery and counter)

| File | Replace (now) | With (after RC release) |
|---|---|---|
| `angle-library.csv` OPS-02, OPS-03, OPS-04, OPS-08, TRU-02 | status RC READY | status SELL NOW. Remove the „Live today …“ boundary; keep the owner/manager entitlement wording |
| [01](01-product-truth.md) | RC rows under RC READY; „Lost card link (today)“ under LIVE NOW | Move the RC rows to LIVE NOW using their right-hand column; delete the „today“ recovery row |
| [06](06-demo-script.md) step 6 Recovery/trust | „Heute: … neue Karte, und du buchst die Stempel nach, die du kennst. Mit dem nächsten Update stellst du die Karte neu aus…“ | „Verliert ein Kunde sein Handy, stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer. Der alte Link funktioniert dann nicht mehr. Und klappt der Scan nicht, tippt dein Team die Kartennummer ein.“ (then click it live) |
| [07](07-objections.md) LOST | today + update wording | „Dann stellst du oder deine Leitung die Karte neu aus – gleicher Stand, gleicher Verlauf. Der alte Link ist danach tot.“ |
| [07](07-objections.md) TIME-COUNTER / MISTAKE | „…Korrektur kommt mit dem nächsten Update“ | „Klappt der Scan nicht: Kartennummer. Falscher Stempel: korrigieren mit Begründung.“ |
| [08](08-ad-concepts.md) AD-19 | „Kartenlink speichern“ carousel (today's path) | Slides: „Handy weg?“ → „Neu ausstellen“ → „Gleicher Stand, gleicher Verlauf“ → „Alter Link funktioniert nicht mehr“ |
| [12](12-collateral.md) cheat-sheet line 6, objection cheat sheet „Handy verloren“, onboarding checklist recovery line | today's path | reissue wording above; onboarding adds „Kartennummer bei Kamerafehler zeigen“ |
| [12](12-collateral.md) onboarding „Staff accounts“ | „operator-provisioned until invite signup is deployed“ | Only if `STAFF_INVITE_SIGNUP_ENABLED` is approved and deployed: „Team per Einladungslink“ |

## Recovery messaging, side by side

| | Before the RC (LIVE NOW) | After the RC (switch) |
|---|---|---|
| Customer still has the link or the same phone | Opens the saved link, or re-scans the QR on the same phone | Same |
| Link or phone lost | New card; the merchant re-books the stamps they know as normal bookings | Owner or manager reissues: same membership, balance, history and card number; old link and QR invalidated |
| Camera fails at the counter | Retry the scan | Staff type the short card number |
| Wrong stamp | No merchant correction button; say „kommt mit dem nächsten Update“ | Owner/manager correction with reason; the original stays in the history |
| What never to say before the switch | „Neue Karte, gleicher Stand“ as if it were live | — |

## Physical collateral and the counter stand

| Item | Now | After the gate | How |
|---|---|---|---|
| Printed handout, cheat sheets, pilot sheet | Current wording | After RC / after NFC acceptance | `python3 gtm/field/collateral/build_collateral.py --rc --nfc` (writes `print-post/`, never overwrites `print/`). Wording lives in `gtm/field/collateral/variants.py` |
| Counter stand insert | `insert-pre-nfc`: „Für deine Kundenkarte QR-Code scannen“, no NFC wording | `HOLD_insert-post-nfc`: „Handy kurz antippen“ / „oder QR-Code scannen“, QR as fallback | Print the held file and drop it into the already-installed stands (tag position is identical). Nothing else changes physically |
| Insert QR | Placeholder (`loynara.invalid`) | The approved demo/production join URL, error correction M | Edit `PLACEHOLDER_URL` in `gtm/field/stand/artwork.py`, rebuild, reprint (see `STAND-SPEC.md` §8) |

