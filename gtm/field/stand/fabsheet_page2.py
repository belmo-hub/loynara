"""Page 2 of the fabrication sheet + combined A3 PDF (page 1 = drawings, page 2 = parts/assembly/tests)."""
import os, subprocess
import geometry as G
import fabsheet

here = os.path.dirname(os.path.abspath(__file__))
fr = G.T_FRAME
PARTS = [
 ('B1', 'Grundplatte', 1, '3,0 mm PMMA GS (Acryl), matt schwarz oder satiniert dunkel', f'{G.BASE_W:.1f} × {G.BASE_D:.0f}', '4 Schlitze 3,2 × 22,2 (Wangenlaschen), Ecken R6, Kanten polieren'),
 ('C1', 'Wange', 2, '3,0 mm PMMA GS, wie B1', '84,0 × 82,9', f'Offener Schlitz {G.SLIT_O[1] - G.SLIT_O[0]:.1f} breit, 20° geneigt; zwei Laschen unten 22 × 3'),
 ('R1', 'Rückplatte', 1, '3,0 mm PMMA GS, wie B1', f'{G.W + 2 * G.TAB_PROTRUSION:.1f} × {G.H:.0f}', 'Vier Laschen 24 × 2,8; Gravur Tag-Eckmarken 29 × 29 auf der Vorderseite'),
 ('F1', 'Distanzrahmen', 1, f'{fr} mm PMMA oder PETG, schwarz/dunkel', f'{G.W:.0f} × {G.H:.0f}', f'U-Form, oben offen; Tasche {G.POCKET_W} × {G.H - G.FRAME_BOTTOM:.1f}. Dicke nach gemessenem Tag (Regel unten)'),
 ('D1', 'Abdeckung', 1, '2,0 mm PMMA GS klar (Schutzfolie bis zum Kleben belassen)', f'{G.W:.0f} × {G.H:.0f}', f'Daumenkerbe R{G.NOTCH_R:.0f} oben mittig, Ecken R{G.R_MOD:.0f}'),
 ('I1', 'Einleger (Druck)', 1, 'Karton 300–350 g/m² gestrichen matt oder 0,3 mm PET/PVC-synthetisch', '105 × 148 (+3 mm Anschnitt)', 'Datei insert-pre-nfc (jetzt) · insert-post-nfc (HOLD bis NFC-Abnahme)'),
 ('T1', 'NFC-Tag', 1, 'PVC On-Metal-Sticker 28 × 28 mm, NXP NTAG 424 DNA (NFC-Tag-Shop.de / NFC21 GmbH, Art.-Nr. 17156)', '28 × 28', 'NICHT beschreiben, nicht konfigurieren. Dicke vor Rahmenbestellung messen'),
 ('E1', 'Füße', 4, 'Silikon-Gummifuß selbstklebend, Ø 10 × 2 (nicht metallisch)', 'Ø 10', 'Unterseite, 12 mm von den Ecken'),
 ('L1', 'Rückseiten-Label', 1, 'Vinyl/Papier-Etikett (optional)', '56 × 26', 'Datei label-back.svg. Stand-ID eintragen, keine Zugangsdaten'),
 ('K1', 'Kleber', 1, 'Lösemittelkleber für PMMA (Herstellerangabe), Isopropanol zum Reinigen', '–', 'Keine Metallpartikel-Kleber, keine metallisierten Folien'),
]
STEPS = [
 'Teile entgraten, Kanten polieren (Flamm- oder Polierpad). Schutzfolien auf den Außenflächen belassen.',
 f'Tag-Dicke mit Messschieber messen. Rahmen wählen: {G.FRAME_RULE}. Ohne Messung keinen Rahmen bestellen.',
 'Rückplatte R1: Vorderseite (Gravurseite) mit Isopropanol reinigen. Tag mit der Tag-Seite zum Betrachter in die Eckmarken 29 × 29 kleben, mittig, Druck 10 s.',
 'Rahmen F1 auf R1 kleben (Kapillarverklebung, Tasche oben offen, Tag-Fenster frei). Aushärten nach Herstellerangabe.',
 'Abdeckung D1 auf F1 kleben. Daumenkerbe oben. Erst danach die Schutzfolie der Abdeckung entfernen. → Modul fertig.',
 'Wangen C1 in die Grundplatte B1 stecken und verkleben (Laschen in Schlitze). Schlitze müssen beide nach hinten 20° zeigen. Das Modul wird NICHT verklebt.',
 'Modul von oben entlang der Wangenschlitze einschieben, bis die untere Lasche auf dem Schlitzgrund aufliegt. Es lässt sich nach oben wieder herausziehen.',
 'Füße E1 auf die Unterseite kleben. Rückseiten-Label L1 aufbringen (optional).',
 'Einleger I1 von oben in die Tasche schieben (Bedruckung nach vorn). Austausch Pre → Post ohne Werkzeug.',
]
TESTS = [
 'Lesetest des Tags durch den fertigen Stapel mit einer reinen Lese-App (nur lesen, nie schreiben): Reichweite in mm an der Tippzone für mindestens 3 Handys notieren (iPhone, Android). Das ist die erste Messung. Vorher keine HF-Aussage.',
 'Vergleich Abdeckung 2,0 mm gegen 1,0 mm und Rahmen nach Messregel. Ergebnis im Prototyp-Protokoll festhalten.',
 'Lesetest auf Metalltresen, neben Kassenterminal und auf dem echten Tresen des Pilotladens.',
 'QR-Test (nach Freigabe des echten Ziels): Scan bei 20 / 30 / 50 / 80 cm mit 3 Handys, auch bei Gegenlicht.',
 'Lesbarkeit: Überschrift aus 1 m Abstand ohne Brille lesbar? Kunde versteht in unter 2 s, was zu tun ist (5 Personen testen).',
 'Handhabung: Einleger rein/raus, Modul rein/raus, Spritztest (Wasser) an der Oberkante, Fall aus Tresenhöhe.',
]
def rows(items): return ''.join(f'<tr><td><b>{a}</b></td><td>{b}</td><td>{c}</td><td>{d}</td><td>{e}</td><td>{f}</td></tr>' for a, b, c, d, e, f in items)

def page2_html():
    css = '''@page{size:420mm 297mm;margin:0}*{box-sizing:border-box}body{margin:0;font:400 3.4mm/1.4 Manrope,Arial,sans-serif;color:#17291F}.pg{width:420mm;height:297mm;position:relative;page-break-after:always;overflow:hidden}
    .in{position:absolute;inset:6mm;border:.5mm solid #17291F;padding:7mm 8mm}h1{font-size:6.4mm;margin:0 0 1mm}h2{font-size:4.2mm;margin:0 0 2mm}.sub{font-size:3mm;color:#58645C;margin-bottom:5mm}
    table{border-collapse:collapse;width:100%;font-size:2.9mm}th,td{border:.2mm solid #b9bdb2;padding:1mm 1.6mm;vertical-align:top;text-align:left}th{background:#E6EEDF}
    .cols{display:grid;grid-template-columns:1.55fr 1fr;gap:8mm}ol{margin:0;padding-left:5mm}li{margin-bottom:1.3mm}.box{border:.25mm solid #b9bdb2;border-radius:2mm;padding:3mm 4mm;margin-bottom:4mm;background:#FCFBF7}.warn{background:#F7E8E0;border-color:#E9C9B8}.p{font-size:3mm;margin:0 0 1.2mm}'''
    fonts = open(os.path.join(here, 'svg', 'insert-pre-nfc.svg'), encoding='utf-8').read().split('<style>')[1].split('</style>')[0]
    return f'''<!doctype html><html lang="de"><head><meta charset="utf-8"><style>{fonts}{css}</style></head><body>
<div class="pg"><div class="in" style="padding:0;border:0;inset:0">{fabsheet.page1_svg().replace('<svg ', '<svg style="display:block" ')}</div></div>
<div class="pg"><div class="in"><h1>Loynara Tresenaufsteller A6 · Fertigungsblatt FS-02 (2/2)</h1><div class="sub">Teile, Materialien, Montage, Toleranzen, Tests · Stand 2026-10-05 · Mechanisch/visuell. Keine HF-Leistung zugesichert, Tag nicht beschrieben, keine Schlüssel.</div>
<div class="cols"><div>
<h2>Teileliste</h2><table><tr><th>ID</th><th>Teil</th><th>Menge</th><th>Material</th><th>Maß (mm)</th><th>Hinweis</th></tr>{rows(PARTS)}</table>
<h2 style="margin-top:6mm">Montage</h2><ol>{''.join(f'<li>{s}</li>' for s in STEPS)}</ol></div>
<div>
<div class="box"><h2>Toleranzen und Passungen</h2><p class="p">Laserzuschnitt ±0,2 mm (Schnittfuge durch die Werkstatt kompensieren).</p><p class="p">Wangenschlitz {G.SLIT_O[1] - G.SLIT_O[0]:.1f} für 3,0 Rückplatte (0,1 Spiel je Seite). Laschenlänge 2,8 in Wange 3,0.</p><p class="p">Einleger 105 × 148 in Tasche {G.POCKET_W} × {G.H - G.FRAME_BOTTOM:.1f} (0,3 / 0,5 Spiel).</p><p class="p">Modul ↔ Wangen {G.SIDE_GAP} je Seite. Modulunterkante 5,8–8 mm über der Grundplatte (Absicht: schwebende Optik, Tropfwasser läuft ab).</p></div>
<div class="box warn"><h2>Metallfreiraum um den Tag</h2><p class="p">Der Tag ist ein On-Metal-Typ mit Ferritrücken. Trotzdem: Im Umkreis von mindestens 15 mm um den Tag (in alle Richtungen) kein Metall, keine Magnete, keine Metallschrauben, keine Metalleffekt-Folie, keine metallisierte Tinte oder Heißprägung, kein Metallkern im Einleger. Befestigung nur Lösemittelkleber, Kunststoff-Schrauben nur außerhalb der Zone.</p><p class="p">Der Stand steht nicht auf einem Metallteller. Metalltresen: im Test prüfen (siehe unten). <b>Es wird keine Reichweite behauptet, bevor gemessen wurde.</b></p></div>
<div class="box"><h2>Tag-Montage und Austausch</h2><p class="p">Der Tag klebt mit seiner Klebeseite auf der Rückplatte, die Tag-Seite zeigt zum Telefon. Er ist hinter Einleger und Abdeckung unsichtbar.</p><p class="p">Ein personalisierter Tag wird nie umgeschrieben. Ein Ersatz ist ein neuer Tag in einem <b>neuen Modul</b> (R1 + F1 + D1), der alte wird per Prozess widerrufen. Deshalb ist das Modul verklebt und von oben aus den Wangen ziehbar.</p><p class="p">Einleger (Pre ↔ Post) wechseln ohne Werkzeug von oben.</p></div>
<div class="box"><h2>QR-Platzhalter und späterer Austausch</h2><p class="p">Gedruckt wird ein Platzhalter-QR (Ziel nicht auflösbar, .invalid). Er öffnet keinen Live-Ablauf.</p><p class="p">Nach der Freigabe des Produktions-Demo-Händlers neu erzeugen: Einleger-QR mit der Beitritts-URL des Demo-Programms (Fehlerkorrektur M), danach Einleger neu drucken. Tag und Stand-ID getrennt.</p></div>
</div></div>
<h2 style="margin-top:6mm">Prüfplan vor einer Serie</h2><ol>{''.join(f'<li>{t}</li>' for t in TESTS)}</ol>
</div></div></body></html>'''

if __name__ == '__main__':
    open(os.path.join(here, 'fabrication-sheet.html'), 'w', encoding='utf-8').write(page2_html())
    print('html written')
