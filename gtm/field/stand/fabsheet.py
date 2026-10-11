"""Dimensioned fabrication sheet (A3 landscape, 2 pages) for the Loynara counter stand. Page 1: drawings at 1:1. Page 2: parts, materials, assembly, tolerances, tests.
Everything is derived from geometry.py. Mechanical/visual only: no RF performance is claimed."""
import math, os
import geometry as G

here = os.path.dirname(os.path.abspath(__file__))
INK, DIM, SOFT, LINE = '#17291F', '#B02A2A', '#E8E6DF', '#17291F'

def arrow(x, y, ang, size=2.4):
    a = math.radians(ang)
    p1 = (x - size * math.cos(a) + size * .32 * math.sin(a), y - size * math.sin(a) - size * .32 * math.cos(a))
    p2 = (x - size * math.cos(a) - size * .32 * math.sin(a), y - size * math.sin(a) + size * .32 * math.cos(a))
    return f'<path d="M{x:.2f} {y:.2f}L{p1[0]:.2f} {p1[1]:.2f}L{p2[0]:.2f} {p2[1]:.2f}Z" fill="{DIM}"/>'

def dim(x1, y1, x2, y2, text, off=10.0, ext=2.0, size=3.1, tx=None):
    L = math.hypot(x2 - x1, y2 - y1); vx, vy = (x2 - x1) / L, (y2 - y1) / L
    nx, ny = -vy, vx
    if off < 0: nx, ny = -nx, -ny
    o = abs(off)
    a, b = (x1 + nx * o, y1 + ny * o), (x2 + nx * o, y2 + ny * o)
    s = [f'<line x1="{x1 + nx * 1.2:.2f}" y1="{y1 + ny * 1.2:.2f}" x2="{a[0] + nx * ext:.2f}" y2="{a[1] + ny * ext:.2f}" stroke="{DIM}" stroke-width=".18"/>',
         f'<line x1="{x2 + nx * 1.2:.2f}" y1="{y2 + ny * 1.2:.2f}" x2="{b[0] + nx * ext:.2f}" y2="{b[1] + ny * ext:.2f}" stroke="{DIM}" stroke-width=".18"/>',
         f'<line x1="{a[0]:.2f}" y1="{a[1]:.2f}" x2="{b[0]:.2f}" y2="{b[1]:.2f}" stroke="{DIM}" stroke-width=".22"/>',
         arrow(a[0], a[1], math.degrees(math.atan2(-vy, -vx))), arrow(b[0], b[1], math.degrees(math.atan2(vy, vx)))]
    mx, my = (a[0] + b[0]) / 2 + nx * 1.6, (a[1] + b[1]) / 2 + ny * 1.6
    ang = math.degrees(math.atan2(vy, vx))
    if ang > 90 or ang < -90: ang += 180
    s.append(f'<text x="{mx:.2f}" y="{my:.2f}" font-size="{size}" text-anchor="middle" fill="{DIM}" transform="rotate({ang:.1f} {mx:.2f} {my:.2f})">{text}</text>')
    return ''.join(s)

def poly(pts, fill='none', stroke=LINE, sw=.35, extra=''):
    return f'<polygon points="{" ".join(f"{x:.2f},{y:.2f}" for x, y in pts)}" fill="{fill}" stroke="{stroke}" stroke-width="{sw}" {extra}/>'

def label(x, y, t, size=3.0, anchor='start', fill=INK, weight=500, rot=0):
    r = f' transform="rotate({rot} {x} {y})"' if rot else ''
    return f'<text x="{x}" y="{y}" font-size="{size}" text-anchor="{anchor}" fill="{fill}" font-weight="{weight}"{r}>{t}</text>'

def side_view(ox, oy):
    X = lambda x: ox + x
    Z = lambda z: oy - z
    P = lambda s, o: (X(G.P(s, o)[0]), Z(G.P(s, o)[1]))
    out = [label(ox, oy - 176, 'A · Seitenansicht (1:1)', 4.2, weight=800)]
    # base
    out.append(f'<rect x="{X(0)}" y="{Z(0)}" width="{G.BASE_D}" height="{G.T_BASE}" fill="#CFCABB" stroke="{LINE}" stroke-width=".35"/>')
    # module layers (front face at o=0): cover 0-2 (clear), insert, frame 2-3.5, back plate 3.5-6.5
    def band(o0, o1, fill, **kw):
        return poly([P(0, o0), P(G.H, o0), P(G.H, o1), P(0, o1)], fill=fill, **kw)
    out += [band(G.T_COVER + G.T_FRAME, G.T_MOD, '#2B2B2B'), band(G.T_COVER, G.T_COVER + G.T_FRAME, '#6D6D6D'), band(0, G.T_COVER, '#D6EDF3')]
    # tag
    t0, t1 = P(G.TAG_S - G.TAG / 2, G.T_COVER + G.T_FRAME - G.TAG_T_MAX), P(G.TAG_S + G.TAG / 2, G.T_COVER + G.T_FRAME - G.TAG_T_MAX)
    t2, t3 = P(G.TAG_S + G.TAG / 2, G.T_COVER + G.T_FRAME), P(G.TAG_S - G.TAG / 2, G.T_COVER + G.T_FRAME)
    out.append(poly([t0, t1, t2, t3], fill='#C0392B', stroke='#C0392B', sw=.2))
    # cheek (transparent so the module behind stays visible)
    ch = []
    for (x, z) in G.cheek_outline(): ch.append((X(x), Z(z)))
    out.append(poly(ch, fill='rgba(160,160,150,.35)', sw=.35))
    sl = [(X(x), Z(z)) for (x, z) in G.slit_polygon()]
    out.append(poly(sl[:4], fill='none', stroke=LINE, sw=.2, extra='stroke-dasharray="1.2 .8"'))
    # dimensions
    top = G.P(G.H, 0); topr = G.P(G.H, G.T_MOD)
    out.append(dim(X(G.BASE_D + 4), Z(0), X(G.BASE_D + 4), Z(top[1]), f'{top[1]:.1f}', off=7))
    out.append(dim(X(0), Z(-G.T_BASE), X(G.BASE_D), Z(-G.T_BASE), f'{G.BASE_D:.0f}', off=-9))
    out.append(dim(X(0), Z(top[1]) , X(top[0]), Z(top[1]), f'{top[0]:.1f}', off=-9))
    out.append(dim(X(G.F0[0]), Z(0), X(G.F0[0]), Z(G.F0[1]), f'{G.F0[1]:.0f}', off=-8))
    out.append(dim(X(0), Z(0), X(G.F0[0]), Z(0), f'{G.F0[0]:.0f}', off=-18))
    # tilt angle
    f0 = (X(G.F0[0]), Z(G.F0[1])); tp = (X(top[0]), Z(top[1]))
    out.append(f'<line x1="{f0[0]}" y1="{f0[1]}" x2="{f0[0]}" y2="{f0[1] - 40}" stroke="{DIM}" stroke-width=".18" stroke-dasharray="1.5 1"/>')
    r = 30
    out.append(f'<path d="M{f0[0]} {f0[1] - r}A{r} {r} 0 0 1 {f0[0] + r * math.sin(G.TH):.2f} {f0[1] - r * math.cos(G.TH):.2f}" fill="none" stroke="{DIM}" stroke-width=".25"/>')
    out.append(label(f0[0] + 6, f0[1] - 33, '20°', 3.4, fill=DIM, weight=700))
    # tag leader
    tc = G.P(G.TAG_S, G.T_COVER + G.T_FRAME - .5)
    out.append(f'<line x1="{X(tc[0])}" y1="{Z(tc[1])}" x2="{X(tc[0]) + 40}" y2="{Z(tc[1]) - 4}" stroke="{INK}" stroke-width=".2"/>')
    out.append(label(X(tc[0]) + 41, Z(tc[1]) - 4, 'NFC-Tag 28×28 (liegt hinter Abdeckung + Einleger)', 2.6))
    out.append(label(X(tc[0]) + 41, Z(tc[1]) - .6, f'Tag-Mitte {G.TAG_S:.0f} mm über Modulunterkante', 2.6))
    # labels
    out.append(label(X(G.P(G.H, 0)[0]) + 6, Z(G.P(G.H, 0)[1]) + 8, 'Modul 112 × 150 × 6,5', 2.8, weight=700))
    out.append(label(X(2), Z(G.cheek_outline()[3][1]) - 6, 'Wange (Pos. C1)', 2.6))
    out.append(label(X(38), Z(-1.2), 'Grundplatte B1, 3,0', 2.6))
    return ''.join(out)

def front_view(ox, oy):
    """True face-on view of the module plane (looking along the module normal), 1:1."""
    W, H = G.W, G.H
    X = lambda x: ox + x
    Y = lambda s: oy - s     # s from bottom
    out = [label(ox, oy - H - 12, 'B · Ansicht auf die Modulebene (1:1)', 4.2, weight=800)]
    out.append(f'<rect x="{X(0)}" y="{Y(H)}" width="{W}" height="{H}" rx="{G.R_MOD}" fill="#D6EDF3" stroke="{LINE}" stroke-width=".4"/>')
    # frame walls
    out.append(f'<rect x="{X(G.FRAME_WALL)}" y="{Y(H)}" width="{G.POCKET_W}" height="{H - G.FRAME_BOTTOM}" fill="#fff" stroke="{LINE}" stroke-width=".25" stroke-dasharray="1.5 1"/>')
    # insert
    iw, ih = G.INSERT_W, G.INSERT_H
    out.append(f'<rect x="{X((W - iw) / 2)}" y="{Y(G.FRAME_BOTTOM + ih)}" width="{iw}" height="{ih}" fill="#143D2E" stroke="{LINE}" stroke-width=".25"/>')
    # notch
    out.append(f'<path d="M{X(W / 2 - G.NOTCH_R)} {Y(H)}A{G.NOTCH_R} {G.NOTCH_R} 0 0 0 {X(W / 2 + G.NOTCH_R)} {Y(H)}Z" fill="#fff" stroke="{LINE}" stroke-width=".35"/>')
    # tag + tap ring + QR box (pre)
    cx, cy = X(G.TAG_X), Y(G.TAG_S)
    out.append(f'<rect x="{cx - 28}" y="{cy - 28}" width="56" height="56" rx="4" fill="none" stroke="#F2A078" stroke-width=".4" stroke-dasharray="1.6 1"/>')
    out.append(f'<circle cx="{cx}" cy="{cy}" r="22.6" fill="none" stroke="#F2A078" stroke-width=".4"/>')
    out.append(f'<rect x="{cx - G.TAG / 2}" y="{cy - G.TAG / 2}" width="{G.TAG}" height="{G.TAG}" fill="#C0392B" fill-opacity=".85" stroke="#fff" stroke-width=".3"/>')
    out.append(label(cx, cy + 1, 'TAG', 3.2, 'middle', '#fff', 800))
    out.append(label(cx - 52, cy - 30.5, 'Pre-NFC: QR-Karte 56 × 56 (QR 44) deckt den Tag ab', 2.3, fill='#F2A078', weight=700))
    out.append(label(cx - 52, cy + 33.5, 'Post-NFC: Tippring Ø 45,2 um denselben Tag', 2.3, fill='#F2A078', weight=700))
    # dims
    out.append(dim(X(0), Y(H), X(W), Y(H), f'{W:.0f}', off=-8))
    out.append(dim(X(W), Y(0), X(W), Y(H), f'{H:.0f}', off=10))
    out.append(dim(X(0), Y(H), X(0), Y(G.TAG_S), f'{H - G.TAG_S:.0f}', off=-10, size=2.8))
    out.append(dim(X(G.TAG_X - G.TAG / 2), Y(G.TAG_S + G.TAG / 2 + 0), X(G.TAG_X + G.TAG / 2), Y(G.TAG_S + G.TAG / 2), f'{G.TAG:.0f}', off=-34, size=2.6))
    out.append(label(X(1), Y(-5), f'Taschenöffnung oben · Tasche {G.POCKET_W} × {H - G.FRAME_BOTTOM:.1f} · Daumenkerbe R{G.NOTCH_R:.0f} · Ecken R{G.R_MOD:.0f}', 2.4))
    return ''.join(out)

def top_view(ox, oy):
    X = lambda x: ox + x
    Y = lambda d: oy + d        # d = depth from base front edge
    out = [label(ox, oy - 8, 'C · Draufsicht (1:1)', 4.2, weight=800)]
    out.append(f'<rect x="{X(0)}" y="{Y(0)}" width="{G.BASE_W}" height="{G.BASE_D}" rx="{G.R_BASE}" fill="#CFCABB" stroke="{LINE}" stroke-width=".4"/>')
    for xs in (G.BASE_MARGIN, G.BASE_W - G.BASE_MARGIN - G.T_CHEEK):
        out.append(f'<rect x="{X(xs)}" y="{Y(G.CHEEK_DEPTH_OFFSET)}" width="{G.T_CHEEK}" height="{G.CHEEK_BASE_LEN}" fill="#9a9a90" stroke="{LINE}" stroke-width=".3"/>')
    m = G.module_extent()
    x0 = G.F0[0]; x1 = max(m['top_front'][0], m['top_rear'][0])
    out.append(f'<rect x="{X(G.BASE_MARGIN + G.T_CHEEK + G.SIDE_GAP)}" y="{Y(x0 - 0.0)}" width="{G.W}" height="{x1 - x0 - 0:.2f}" fill="rgba(23,41,31,.12)" stroke="{LINE}" stroke-width=".3" stroke-dasharray="1.5 1"/>')
    out.append(dim(X(0), Y(G.BASE_D), X(G.BASE_W), Y(G.BASE_D), f'{G.BASE_W:.1f}', off=9))
    out.append(dim(X(G.BASE_W), Y(0), X(G.BASE_W), Y(G.BASE_D), f'{G.BASE_D:.0f}', off=9))
    out.append(dim(X(G.BASE_MARGIN + G.T_CHEEK), Y(2), X(G.BASE_W - G.BASE_MARGIN - G.T_CHEEK), Y(2), f'{G.CHEEK_SPACING:.1f}', off=-0.1, size=2.6))
    out.append(label(X(G.BASE_W / 2), Y(G.BASE_D / 2 + 2), 'Modulgrundfläche', 2.6, 'middle', weight=600))
    out.append(label(X(3), Y(-3.5), 'Front', 2.8, weight=700))
    return ''.join(out)

def layers(ox, oy, k=6.0):
    """Section through the tap zone, 6:1."""
    items = [('Abdeckung klar', G.T_COVER, '#D6EDF3', '2,0'), ('Einleger', G.INSERT_T, '#143D2E', '≈ 0,35'), ('Tag + Luft', G.T_FRAME - G.INSERT_T, '#FBE3D8', f'Tasche {G.T_FRAME} gesamt'), ('Rückplatte', G.T_BACK, '#2B2B2B', '3,0')]
    out = [label(ox, oy - 30, 'D · Schichtaufbau am Tag (Schnitt, 6:1)', 4.0, weight=800)]
    x = ox
    for name, t, fill, txt in items:
        out.append(f'<rect x="{x:.2f}" y="{oy}" width="{t * k:.2f}" height="46" fill="{fill}" stroke="{LINE}" stroke-width=".3"/>')
        x += t * k
    # tag in the pocket: ≤ 1.15 thick, stuck to the back plate
    tx = ox + (G.T_COVER + G.T_FRAME - G.TAG_T_MAX) * k
    out.append(f'<rect x="{tx:.2f}" y="{oy + 9}" width="{G.TAG_T_MAX * k:.2f}" height="28" fill="#C0392B"/>')
    out.append(label(ox - 1, oy - 18, 'Telefon ↓ (vorne)', 3, weight=700))
    out.append(label(ox, oy + 55, 'Abdeckung 2,0 (klar, PMMA)', 2.7))
    out.append(label(ox, oy + 59, 'Einleger ≈ 0,35 (Karton/PET)', 2.7))
    out.append(label(ox, oy + 63, f'Tag auf Rückplatte geklebt, Dicke MESSEN: ≤ {G.TAG_T_MAX} bei Rahmen {G.T_FRAME}', 2.7))
    out.append(label(ox, oy + 67, f'Tasche (Rahmen) {G.T_FRAME} · Rückplatte 3,0', 2.7))
    out.append(label(ox, oy + 71, 'Zwischen Telefon und Tag: Abdeckung + Einleger + Luftspalt (Test-Variable)', 2.7, fill=DIM, weight=700))
    out.append(dim(ox, oy + 47, ox + (G.T_COVER + 0.35) * k, oy + 47, '2,35', off=3, size=2.4))
    return ''.join(out)

def page1_svg():
    W, H = 420, 297
    body = [f'<rect width="{W}" height="{H}" fill="#fff"/>', f'<rect x="6" y="6" width="{W - 12}" height="{H - 12}" fill="none" stroke="{LINE}" stroke-width=".5"/>',
            label(12, 18, 'Loynara Tresenaufsteller A6 · Fertigungsblatt FS-01 (1/2)', 6.4, weight=800),
            label(12, 25, 'Alle Maße in mm · Zeichnungen 1:1 (außer D) · Neigung 20° · Beispiel-Händler „Take a Piz“ nur Beispielinhalt · Stand 2026-10-05 · Nur mechanisch/visuell: keine HF-Leistung zugesichert, Tag nicht beschrieben', 3.0, fill='#58645C'),
            side_view(16, 262), front_view(150, 262), top_view(278, 62), layers(284, 190)]
    key = [('Außenmaß', f'{G.BASE_W:.1f} × {G.BASE_D:.0f} × {G.module_extent()["height"]:.0f} (B×T×H)'), ('Neigung', '20° nach hinten'), ('Modul', f'{G.W:.0f} × {G.H:.0f} × {G.T_MOD}'),
           ('Tag-Mitte', f'{G.H - G.TAG_S:.0f} mm unter der Oberkante, mittig'), ('Metallfreiraum', '≥ 15 mm um den Tag (FS-02)')]
    y = 38
    body.append(label(12, y, 'Eckdaten', 4.2, weight=800)); y += 6
    for k, v in key:
        body.append(label(12, y, k, 2.8, weight=700)); body.append(label(40, y, v, 2.8)); y += 5
    body.append(label(278, 262 + 22, 'Teileliste, Materialien, Montage, Toleranzen und Tests: Blatt FS-02', 2.8, weight=700))
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}" font-family="Manrope,Arial,sans-serif">{"".join(body)}</svg>'

if __name__ == '__main__':
    open(os.path.join(here, 'svg', 'fabrication-sheet-1.svg'), 'w', encoding='utf-8').write(page1_svg())
    print('page 1 written')
