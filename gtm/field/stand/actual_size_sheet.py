"""A4 sheet with the pre-NFC insert at exactly 100 % (cut-out paper prototype), a 100 mm scale bar and a QR scan test strip. Print at 100 %, "actual size", no fit-to-page."""
import os, subprocess
import artwork as A
here = os.path.dirname(os.path.abspath(__file__))
art = A.insert_svg('pre').replace('<svg xmlns="http://www.w3.org/2000/svg"', '<svg xmlns="http://www.w3.org/2000/svg"', 1)
inner = art[art.index('>') + 1:art.rindex('</svg>')]
def sheet():
    W, H = 210, 297
    ox, oy = 14 + A.BLEED, 22 + A.BLEED       # trim origin on the page
    marks = ''
    for (x, y, dx, dy) in ((0, 0, 1, 1), (105, 0, -1, 1), (0, 148, 1, -1), (105, 148, -1, -1)):
        marks += f'<line x1="{ox + x - dx * 1.5}" y1="{oy + y}" x2="{ox + x - dx * 6}" y2="{oy + y}" stroke="#000" stroke-width=".12"/><line x1="{ox + x}" y1="{oy + y - dy * 1.5}" x2="{ox + x}" y2="{oy + y - dy * 6}" stroke="#000" stroke-width=".12"/>'
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" font-family="Manrope,Arial,sans-serif"><defs><style>{A.font_css()}</style></defs><rect width="{W}" height="{H}" fill="#fff"/>'
            f'<g transform="translate({ox} {oy})">{inner}</g>{marks}'
            '<text x="14" y="12" font-size="5" font-weight="800" fill="#17291F">Papier-Prototyp 1:1 · Einleger Pre-NFC (Beispiel „Take a Piz“)</text>'
            '<text x="14" y="17" font-size="2.6" fill="#58645C">Auf A4 mit 100 % („Tatsächliche Größe“, nicht an Seite anpassen) drucken, an den Marken auf 105 × 148 mm schneiden.</text>'
            f'<line x1="{ox + 118}" y1="{oy + 6}" x2="{ox + 118 + 50}" y2="{oy + 6}" stroke="#000" stroke-width=".4"/><line x1="{ox + 118}" y1="{oy + 3.5}" x2="{ox + 118}" y2="{oy + 8.5}" stroke="#000" stroke-width=".4"/><line x1="{ox + 168}" y1="{oy + 3.5}" x2="{ox + 168}" y2="{oy + 8.5}" stroke="#000" stroke-width=".4"/>'
            f'<text x="{ox + 118}" y="{oy + 14}" font-size="2.8" fill="#17291F">Maßstab: dieser Balken muss genau 50 mm lang sein</text>'
            f'<text x="{ox + 118}" y="{oy + 26}" font-size="3" font-weight="800" fill="#17291F">Prüfen (mit Zettel in der Hand):</text>'
            + ''.join(f'<text x="{ox + 118}" y="{oy + 32 + i * 5.4}" font-size="2.7" fill="#17291F">{t}</text>' for i, t in enumerate([
                '1. Überschrift aus 1 m lesbar? Ohne Brille?', '2. Versteht eine fremde Person es in 2 Sekunden?', '3. Platzhalter-QR scannen: 20 / 30 / 50 cm.',
                '   (Er öffnet nichts. Die Kamera erkennt ihn.)', '4. Am Tresen aufstellen: Blendung durch Licht?', '5. Notieren: Handy, Abstand, Ergebnis.']))
            + '</svg>')
if __name__ == '__main__':
    open(os.path.join(here, 'svg', 'actual-size-check_A4.svg'), 'w', encoding='utf-8').write(sheet())
    subprocess.run(['node', os.path.join(here, 'render-svg.mjs'), os.path.join(here, 'svg', 'actual-size-check_A4.svg'), os.path.join(here, 'pdf', 'insert-pre-nfc_actual-size-check_A4.pdf'), os.path.join(here, 'png', 'actual-size-check_A4.png'), '210', '297', '4'], check=True)
    print('actual-size sheet written')
