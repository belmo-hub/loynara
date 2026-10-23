"""Insert artwork (A6 portrait, 105 × 148 mm trim, 3 mm bleed) for the Loynara counter stand. Example merchant: "Take a Piz" (label only, not a customer).
Pre-NFC: QR is the live method. Post-NFC: tap is primary, QR is the fallback (HOLD: do not print until NFC acceptance passes)."""
import base64, os, qrcode
from qrcode.constants import ERROR_CORRECT_M
import geometry as G

here = os.path.dirname(os.path.abspath(__file__))
FONTS = os.path.join(here, '../../../marketing-site/site/assets/fonts')
DEEP, BRAND, CREAM, ACCENT, ONDARK, BAND = '#143D2E', '#245D47', '#F6F3EC', '#F2A078', '#CFE0D5', '#19493A'
PLACEHOLDER_URL = 'https://loynara.invalid/platzhalter'   # RFC 2606 .invalid: cannot resolve, so it can never open a live flow
BLEED = 3.0
TRIM_W, TRIM_H = 105.0, 148.0

def font_css():
    b64 = lambda f: base64.b64encode(open(os.path.join(FONTS, f), 'rb').read()).decode()
    return f"@font-face{{font-family:Manrope;src:url(data:font/woff2;base64,{b64('manrope-latin.woff2')}) format('woff2');font-weight:200 800}}"

def qr_matrix(payload=PLACEHOLDER_URL):
    q = qrcode.QRCode(version=None, error_correction=ERROR_CORRECT_M, box_size=1, border=0); q.add_data(payload); q.make(fit=True)
    return q.get_matrix()

def qr_svg(x, y, size, payload=PLACEHOLDER_URL, fg=DEEP):
    m = qr_matrix(payload); n = len(m); u = size / n
    # merge horizontal runs into one path: fewer elements, crisp edges
    d = []
    for r, row in enumerate(m):
        c = 0
        while c < n:
            if row[c]:
                s = c
                while c < n and row[c]: c += 1
                d.append(f'M{x + s * u:.3f} {y + r * u:.3f}h{(c - s) * u:.3f}v{u:.3f}h{-(c - s) * u:.3f}z')
            else: c += 1
    return f'<path d="{"".join(d)}" fill="{fg}"/>', n, u

def mark(x, y, s):  # Loynara mark (from marketing-site/site/assets/loynara-mark.svg)
    k = s / 64
    return (f'<g transform="translate({x} {y}) scale({k})"><rect width="64" height="64" rx="17" fill="#16473f"/><path d="M17 16v33h30" fill="none" stroke="#f5efdf" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<circle cx="45" cy="21" r="6" fill="#f2a078"/></g>')

def common_top():
    return (f'<rect x="-{BLEED}" y="-{BLEED}" width="{TRIM_W + 2 * BLEED}" height="{TRIM_H + 2 * BLEED}" fill="{DEEP}"/>'
            f'<rect x="-{BLEED}" y="-{BLEED}" width="{TRIM_W + 2 * BLEED}" height="{25 + BLEED}" fill="{BAND}"/>'
            f'<circle cx="16" cy="14.5" r="7.2" fill="none" stroke="{CREAM}" stroke-width=".35" stroke-dasharray="1.2 .9" opacity=".8"/>'
            f'<text x="16" y="15.4" text-anchor="middle" font-size="2.1" font-weight="700" letter-spacing=".25" fill="{CREAM}" opacity=".8">LOGO</text>'
            f'<text x="27.5" y="15.2" font-size="5.6" font-weight="800" letter-spacing="-.1" fill="{CREAM}">Take a Piz</text>'
            f'<text x="27.5" y="20.6" font-size="2.6" font-weight="600" fill="{ONDARK}" opacity=".85">Deine Stempelkarte</text>')

def dots(x, y, n=10, on=7, r=1.5, gap=1.7):
    out = []
    for i in range(n):
        cx = x + r + i * (2 * r + gap)
        out.append(f'<circle cx="{cx:.2f}" cy="{y}" r="{r}" fill="{ACCENT}"/>' if i < on else f'<circle cx="{cx:.2f}" cy="{y}" r="{r - .15}" fill="none" stroke="{CREAM}" stroke-width=".28" stroke-dasharray=".9 .7" opacity=".7"/>')
    return ''.join(out)

def pre_body():
    cx, cy = TRIM_W / 2, 56.0   # = tag centre (tap zone)
    qrs, n, u = qr_svg(cx - 22, cy - 22, 44)
    return (f'<rect x="{cx - 28}" y="{cy - 28}" width="56" height="56" rx="4" fill="#fff"/>{qrs}'
            f'<text x="{cx}" y="{cy + 31.8}" text-anchor="middle" font-size="1.75" font-weight="600" fill="{CREAM}" opacity=".6">Platzhalter-QR · führt nirgendwohin</text>'
            f'<text x="{cx}" y="98" text-anchor="middle" font-size="5.2" font-weight="800" letter-spacing="-.08" fill="{CREAM}">Für deine Kundenkarte</text>'
            f'<text x="{cx}" y="104.6" text-anchor="middle" font-size="5.2" font-weight="800" letter-spacing="-.08" fill="{ACCENT}">QR-Code scannen</text>'
            f'<text x="{cx}" y="111.2" text-anchor="middle" font-size="2.75" font-weight="600" fill="{ONDARK}">Die Karte öffnet sich im Browser. Ohne App.</text>'
            f'<line x1="9" y1="116.6" x2="96" y2="116.6" stroke="{CREAM}" stroke-width=".15" opacity=".3"/>'
            + dots(9, 123.4) +
            f'<text x="9" y="130.2" font-size="2.7" font-weight="700" fill="{CREAM}">Bei 10 Stempeln: Pizza aufs Haus</text>'
            f'<text x="9" y="133.4" font-size="1.9" font-weight="500" fill="{ONDARK}" opacity=".75">Beispiel-Prämie</text>'
            f'<text x="96" y="122" text-anchor="end" font-size="2.45" font-weight="600" fill="{ONDARK}">Dein Team bestätigt</text>'
            f'<text x="96" y="125.4" text-anchor="end" font-size="2.45" font-weight="600" fill="{ONDARK}">jeden Besuch.</text>')

def waves(cx, cy):
    """Contactless symbol: four arcs opening to the right (the universally recognised tap mark)."""
    import math
    out = []
    ox = cx - 9.0
    for r in (3.6, 7.2, 10.8, 14.4):
        a = math.radians(40)
        x0, y0, x1, y1 = ox + r * math.cos(-a), cy + r * math.sin(-a), ox + r * math.cos(a), cy + r * math.sin(a)
        out.append(f'<path d="M{x0:.2f} {y0:.2f}A{r} {r} 0 0 1 {x1:.2f} {y1:.2f}" fill="none" stroke="{ACCENT}" stroke-width="1.5" stroke-linecap="round"/>')
    return ''.join(out)

def post_body():
    cx, cy = TRIM_W / 2, 56.0
    qrs, n, u = qr_svg(61.3, 105.3, 31)
    return (f'<circle cx="{cx}" cy="{cy}" r="25" fill="#1B4C3A"/><circle cx="{cx}" cy="{cy}" r="22.6" fill="none" stroke="{ACCENT}" stroke-width="1.3"/>'
            + waves(cx, cy - 2) +
            f'<text x="{cx}" y="{cy + 14.5}" text-anchor="middle" font-size="2.2" font-weight="800" letter-spacing=".5" fill="{ACCENT}">HIER ANTIPPEN</text>'
            f'<text x="{cx}" y="92" text-anchor="middle" font-size="5.6" font-weight="800" letter-spacing="-.08" fill="{CREAM}">Handy kurz antippen</text>'
            f'<text x="{cx}" y="98" text-anchor="middle" font-size="3.3" font-weight="700" fill="{ACCENT}">oder QR-Code scannen</text>'
            f'<rect x="57" y="101" width="39.6" height="39.6" rx="3.2" fill="#fff"/>{qrs}'
            f'<text x="76.8" y="143.9" text-anchor="middle" font-size="1.6" font-weight="600" fill="{CREAM}" opacity=".6">Platzhalter-QR · führt nirgendwohin</text>'
            + dots(9, 108) +
            f'<text x="9" y="114.6" font-size="2.7" font-weight="700" fill="{CREAM}">Bei 10 Stempeln: Pizza aufs Haus</text>'
            f'<text x="9" y="117.8" font-size="1.9" font-weight="500" fill="{ONDARK}" opacity=".75">Beispiel-Prämie</text>'
            f'<text x="9" y="124" font-size="2.45" font-weight="600" fill="{ONDARK}">Dein Team bestätigt jeden Besuch.</text>')

def footer(example=True):
    return (mark(9, 135.4, 5.4) + f'<text x="15.6" y="139.4" font-size="2.9" font-weight="800" letter-spacing="-.05" fill="{CREAM}">Loynara</text>'
            + (f'<text x="9" y="144.4" font-size="1.75" font-weight="500" fill="{ONDARK}" opacity=".65">Beispiel-Gestaltung · Take a Piz ist kein Loynara-Kunde</text>' if example else ''))

def insert_svg(variant, marks=False, example=True):
    """variant: 'pre' or 'post'. marks=True adds crop marks in a 7 mm slug."""
    body = pre_body() if variant == 'pre' else post_body()
    slug = 7.0 if marks else 0.0
    w, h = TRIM_W + 2 * BLEED + 2 * slug, TRIM_H + 2 * BLEED + 2 * slug
    crop = ''
    if marks:
        o = slug + BLEED
        L = 4.0
        for (x, y, dx, dy) in ((0, 0, 1, 1), (TRIM_W, 0, -1, 1), (0, TRIM_H, 1, -1), (TRIM_W, TRIM_H, -1, -1)):
            crop += (f'<line x1="{x - dx * 1.5}" y1="{y}" x2="{x - dx * (1.5 + L)}" y2="{y}" stroke="#000" stroke-width=".12"/>'
                     f'<line x1="{x}" y1="{y - dy * 1.5}" x2="{x}" y2="{y - dy * (1.5 + L)}" stroke="#000" stroke-width=".12"/>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="{-BLEED - slug} {-BLEED - slug} {w} {h}" font-family="Manrope,sans-serif">'
            f'<defs><style>{font_css()}</style></defs>{crop}<g>{common_top()}{body}{footer(example)}</g></svg>')

def back_label_svg():
    w, h = 56.0, 26.0
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}" font-family="Manrope,sans-serif"><defs><style>{font_css()}</style></defs>'
            f'<rect width="{w}" height="{h}" rx="2.5" fill="{DEEP}"/>{mark(3.5, 3.5, 7)}<text x="12.4" y="8.9" font-size="3.6" font-weight="800" letter-spacing="-.05" fill="{CREAM}">Loynara</text>'
            f'<text x="3.5" y="14.8" font-size="2.2" font-weight="600" fill="{ONDARK}">Digitale Stempelkarte · ohne App</text>'
            f'<text x="3.5" y="19.2" font-size="2.1" font-weight="700" fill="{CREAM}">Stand-ID: ST-______   Standort: __________</text>'
            f'<text x="3.5" y="23.2" font-size="1.9" font-weight="500" fill="{ONDARK}" opacity=".8">support@getloynara.com · keine Zugangsdaten auf diesem Label</text></svg>')

if __name__ == '__main__':
    for v in ('pre', 'post'):
        open(os.path.join(here, 'svg', f'insert-{v}-nfc.svg'), 'w', encoding='utf-8').write(insert_svg(v))
        open(os.path.join(here, 'svg', f'insert-{v}-nfc-cropmarks.svg'), 'w', encoding='utf-8').write(insert_svg(v, marks=True))
    open(os.path.join(here, 'svg', 'label-back.svg'), 'w', encoding='utf-8').write(back_label_svg())
    m = qr_matrix(); print('QR modules:', len(m), 'payload:', PLACEHOLDER_URL)
