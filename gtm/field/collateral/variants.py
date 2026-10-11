"""Release-gated wording for the printed field collateral. Same switch logic as marketing-site/src/claims.ts and gtm/15-copy-switches.md.
Default build = LIVE NOW. Build the post-gate versions only when the gate has passed: python3 build_collateral.py --nfc --rc"""
PRE = dict(
  nfc_footer='Antippen per NFC ist vorbereitet; heute startest du mit dem QR-Code.',
  customer='Scannt den QR-Code am Tresen. Die Karte öffnet sich im Browser, ohne App und ohne Download. Link speichern, fertig.',
  customer_short='QR-Code scannen, Karte öffnet sich im Browser',
  lost_card='Wer den Kartenlink gespeichert hat, kommt wieder rein. Ist er weg, legt der Kunde eine neue Karte an und du buchst die Stempel nach, die du kennst. Neu ausstellen mit gleichem Stand kommt mit dem nächsten Update.',
  mistake='Heute buchst du nach. Korrigieren mit Begründung kommt mit dem nächsten Update, der Verlauf bleibt sichtbar.',
  nfc_objection='Heute startest du mit dem QR-Code, der geht mit jeder Handykamera. Antippen per NFC ist vorbereitet. Den QR-Code gibt es später immer als Alternative.',
  demo_step1='Karte auf dem Tablet zeigen: „So sieht das dein Kunde: Kamera auf den Code am Tresen, Karte im Browser. Keine App.“',
  demo_recovery='„Link gespeichert, alles da. Sonst neue Karte und du buchst nach. Neu ausstellen kommt mit dem nächsten Update.“',
  demo_nfc='„Antippen per NFC ist vorbereitet, heute ist es der QR-Code.“',
  variant='Stand: vor RC-Release und vor NFC-Abnahme',
)
POST_RC = dict(
  lost_card='Du oder deine Leitung stellt die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer. Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr.',
  mistake='Du oder deine Leitung korrigiert mit Begründung. Das Original bleibt im Verlauf sichtbar.',
  demo_recovery='„Handy weg? Du oder deine Leitung stellt die Karte neu aus: gleicher Stand, gleicher Verlauf. Der alte Link ist danach tot.“',
)
POST_NFC = dict(
  nfc_footer='Handy kurz antippen oder QR-Code scannen: beides öffnet dieselbe Karte.',
  customer='Hält das Handy kurz an den Tresen oder scannt den QR-Code. Die Karte öffnet sich im Browser, ohne App. Link speichern, fertig.',
  customer_short='Handy antippen oder QR-Code scannen',
  nfc_objection='Dann scannt der Kunde den QR-Code. Der bleibt immer die Alternative und öffnet dieselbe Karte.',
  demo_step1='Tag am Tresen antippen, dann den QR-Code als Alternative zeigen.',
  demo_nfc='„Handy kurz antippen. Und wenn das Handy kein NFC kann: QR-Code.“',
)
def variant(nfc=False, rc=False):
    v = dict(PRE)
    if rc: v.update(POST_RC)
    if nfc: v.update(POST_NFC)
    v['variant'] = 'Stand: ' + ('nach RC-Release' if rc else 'vor RC-Release') + ', ' + ('nach NFC-Abnahme' if nfc else 'vor NFC-Abnahme')
    return v
