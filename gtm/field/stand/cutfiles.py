"""Laser-cut files for the counter stand: one SVG per sheet material (cut = red 0.1 mm, engrave = blue 0.1 mm, notes = green, not cut) and a DXF export.
All shapes come from geometry.py. Units: mm. 1:1 scale. Kerf compensation is the fabricator's job; nominal slot clearances are already included."""
import math, os
import geometry as G

here = os.path.dirname(os.path.abspath(__file__))
CUT, ENG, NOTE = '#FF0000', '#0000FF', '#00A050'

def arc_pts(cx, cy, r, a0, a1, n=12):
    return [(cx + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), cy + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]

def rrect(x, y, w, h, r, rounded=(True, True, True, True)):
    """Rounded rectangle polygon (y down). rounded = (top-left, top-right, bottom-right, bottom-left)."""
    pts = []
    tl, tr, br, bl = rounded
    pts += arc_pts(x + r, y + r, r, 180, 270) if tl else [(x, y)]
    pts += arc_pts(x + w - r, y + r, r, 270, 360) if tr else [(x + w, y)]
    pts += arc_pts(x + w - r, y + h - r, r, 0, 90) if br else [(x + w, y + h)]
    pts += arc_pts(x + r, y + h - r, r, 90, 180) if bl else [(x, y + h)]
    return pts

def circle(cx, cy, r, n=36): return arc_pts(cx, cy, r, 0, 360, n)[:-1]
def shift(pts, dx, dy): return [(x + dx, y + dy) for x, y in pts]

# ── parts (each returns dict: cut = [polygons], eng = [polygons or lines], w, h, name) ──
def part_base():
    W, D = G.BASE_W, G.BASE_D
    cut = [rrect(0, 0, W, D, G.R_BASE)]
    slots = []
    for xs in ((G.BASE_MARGIN, ), (W - G.BASE_MARGIN - G.T_CHEEK, )):
        for (a, b) in G.CHEEK_TABS:
            x0, x1 = xs[0] - G.SLOT_CLEAR, xs[0] + G.T_CHEEK + G.SLOT_CLEAR
            y0, y1 = G.CHEEK_DEPTH_OFFSET + a - G.SLOT_CLEAR, G.CHEEK_DEPTH_OFFSET + b + G.SLOT_CLEAR
            slots.append([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    return dict(name='B1 Grundplatte', mat=3.0, cut=cut + slots, eng=[], w=W, h=D,
                notes=[('Front →', 6, -2.2)])

def part_cheek():
    pts = []
    def z(p): return (p[0], -p[1])      # side view z up → svg y down
    base = [(0, 0)]
    for (a, b) in G.CHEEK_TABS:
        base += [(a, 0), (a, G.CHEEK_TAB_DEPTH), (b, G.CHEEK_TAB_DEPTH), (b, 0)]
    base += [(G.CHEEK_BASE_LEN, 0)]
    poly = [(x, y) for x, y in base]
    P = G.P
    poly += [z(P(G.S_TOP, G.O_REAR)), z(P(G.S_TOP, G.SLIT_O[1])), z(P(G.S_FLOOR, G.SLIT_O[1])), z(P(G.S_FLOOR, G.SLIT_O[0])), z(P(G.S_TOP, G.SLIT_O[0])), z(P(G.S_TOP, G.O_FRONT))]
    xs, ys = [p[0] for p in poly], [p[1] for p in poly]
    mx, my = min(xs), min(ys)
    poly = shift(poly, -mx, -my)
    return dict(name='C1 Wange (2×)', mat=3.0, cut=[poly], eng=[], w=max(xs) - mx, h=max(ys) - my, notes=[('2 Stück, identisch', 4, -2.2)])

def part_back():
    W, H = G.W, G.H
    t = G.TAB_PROTRUSION
    pts = []
    # build the outline clockwise in plate coordinates: x 0..W, s up (svg y = H - s)
    Y = lambda s: H - s
    pts += arc_pts(G.R_MOD, Y(H) + G.R_MOD, G.R_MOD, 180, 270)                         # top-left
    pts += arc_pts(W - G.R_MOD, Y(H) + G.R_MOD, G.R_MOD, 270, 360)                     # top-right
    for (a, b) in sorted(G.TABS, reverse=True):                                         # right side, going down
        pts += [(W, Y(b)), (W + t, Y(b)), (W + t, Y(a)), (W, Y(a))]
    pts += arc_pts(W - G.R_MOD, Y(0) - G.R_MOD, G.R_MOD, 0, 90)                         # bottom-right
    pts += arc_pts(G.R_MOD, Y(0) - G.R_MOD, G.R_MOD, 90, 180)                           # bottom-left
    for (a, b) in sorted(G.TABS):                                                       # left side, going up
        pts += [(0, Y(a)), (-t, Y(a)), (-t, Y(b)), (0, Y(b))]
    pts = shift(pts, t, 0)
    cx, cy = t + G.TAG_X, Y(G.TAG_S)
    g = G.TAG_GUIDE / 2
    guide = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            guide.append([(cx + sx * g, cy + sy * (g - 5)), (cx + sx * g, cy + sy * g), (cx + sx * (g - 5), cy + sy * g)])   # corner marks
    guide.append([(cx - 3, cy), (cx + 3, cy)]); guide.append([(cx, cy - 3), (cx, cy + 3)])
    return dict(name='R1 Rückplatte', mat=3.0, cut=[pts], eng=guide, w=W + 2 * t, h=H,
                notes=[('Gravur auf der VORDERSEITE (Tag-Seite): Eckmarken 29×29, Mitte = Tippzone', 2, -2.2)])

def part_frame():
    W, H = G.W, G.H
    wall, bar = G.FRAME_WALL, G.FRAME_BOTTOM
    # explicit trace: outer left going down, bottom (rounded), outer right going up, right wall top, pocket right side down, pocket bottom, pocket left side up, left wall top
    pts = [(0, 0)]
    pts += arc_pts(G.R_MOD, H - G.R_MOD, G.R_MOD, 180, 90)          # bottom-left corner, from left side down to bottom
    pts += arc_pts(W - G.R_MOD, H - G.R_MOD, G.R_MOD, 90, 0)        # bottom-right corner, to right side
    pts += [(W, 0), (W - wall, 0), (W - wall, H - bar), (wall, H - bar), (wall, 0)]
    return dict(name='F1 Distanzrahmen', mat=1.5, cut=[pts], eng=[], w=W, h=H, notes=[('U-Form: oben offen (Einschubtasche 105,6 × 148,5)', 2, -2.2)])

def part_cover():
    W, H = G.W, G.H
    # thumb notch: a semicircle cut down into the top edge, centred
    pts = arc_pts(G.R_MOD, G.R_MOD, G.R_MOD, 180, 270)
    pts += [(W / 2 - G.NOTCH_R, 0)]
    pts += [(W / 2 - G.NOTCH_R * math.cos(math.radians(a)), G.NOTCH_R * math.sin(math.radians(a))) for a in range(0, 181, 10)]
    pts += arc_pts(W - G.R_MOD, G.R_MOD, G.R_MOD, 270, 360)
    pts += arc_pts(W - G.R_MOD, H - G.R_MOD, G.R_MOD, 0, 90)
    pts += arc_pts(G.R_MOD, H - G.R_MOD, G.R_MOD, 90, 180)
    return dict(name='D1 Abdeckung klar', mat=2.0, cut=[pts], eng=[], w=W, h=H, notes=[('klar, Schutzfolie bis zum Verkleben drauflassen', 2, -2.2)])

PARTS = dict(base=part_base, cheek=part_cheek, back=part_back, frame=part_frame, cover=part_cover)

def poly_svg(pts, color, closed=True):
    d = 'M' + 'L'.join(f'{x:.3f} {y:.3f}' for x, y in pts) + ('Z' if closed else '')
    return f'<path d="{d}" fill="none" stroke="{color}" stroke-width=".1"/>'

def sheet(name, sw, sh, placements, mat, title):
    """placements: list of (part dict, x, y, copies...). Returns svg text."""
    body = []
    for part, x, y in placements:
        for poly in part['cut']: body.append(poly_svg(shift(poly, x, y), CUT))
        for line in part['eng']: body.append(poly_svg(shift(line, x, y), ENG, closed=False))
        body.append(f'<text x="{x}" y="{y - 1.6}" font-size="2.6" font-family="Arial,sans-serif" fill="{NOTE}">{part["name"]} · {part["mat"]} mm · {part["w"]:.1f} × {part["h"]:.1f}</text>')
        for (t, dx, dy) in part.get('notes', []): body.append(f'<text x="{x + dx}" y="{y + part["h"] + 4.2}" font-size="2.2" font-family="Arial,sans-serif" fill="{NOTE}">{t}</text>')
    border = f'<rect x="0" y="0" width="{sw}" height="{sh}" fill="none" stroke="{NOTE}" stroke-width=".15" stroke-dasharray="2 2"/>'
    head = (f'<text x="4" y="{sh - 7}" font-size="2.6" font-family="Arial,sans-serif" fill="{NOTE}">{title} · Material {mat}</text>'
            f'<text x="4" y="{sh - 3}" font-size="2.4" font-family="Arial,sans-serif" fill="{NOTE}">mm · 1:1 · Rot = schneiden, Blau = gravieren, Grün = Hinweis (nicht schneiden) · 2026-10-05</text>')
    return f'<svg xmlns="http://www.w3.org/2000/svg" width="{sw}mm" height="{sh}mm" viewBox="0 0 {sw} {sh}">{border}{"".join(body)}{head}</svg>'

def build():
    P = {k: f() for k, f in PARTS.items()}
    b, c, r, f, d = P['base'], P['cheek'], P['back'], P['frame'], P['cover']
    s3 = sheet('3mm', 300, 300, [(r, 10, 12), (b, 10, 12 + r['h'] + 12), (c, 150, 12), (c, 150, 12 + c['h'] + 12)], '3,0 mm Acryl (matt schwarz oder dunkel), 300 × 300 mm', 'Blatt A')
    s15 = sheet('1.5mm', 140, 180, [(f, 12, 12)], '1,5 mm Acryl/PETG (schwarz oder dunkel), mind. 140 × 180 mm', 'Blatt B')
    s2 = sheet('2mm', 140, 180, [(d, 12, 12)], '2,0 mm Acryl klar (PMMA, gegossen), mind. 140 × 180 mm', 'Blatt C')
    for name, svg in (('laser-A-3mm.svg', s3), ('laser-B-1.5mm.svg', s15), ('laser-C-2mm-clear.svg', s2)):
        open(os.path.join(here, 'svg', name), 'w', encoding='utf-8').write(svg)
    return P, (s3, s15, s2)

def dxf_for(sheet_parts, path):
    """Minimal ASCII DXF (R12, mm): closed polylines on layer CUT (red) and open polylines on ENGRAVE (blue)."""
    out = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', '2',
           '0', 'LAYER', '2', 'CUT', '70', '0', '62', '1', '6', 'CONTINUOUS', '0', 'LAYER', '2', 'ENGRAVE', '70', '0', '62', '5', '6', 'CONTINUOUS', '0', 'ENDTAB', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES']
    def poly(pts, layer, closed):
        o = ['0', 'POLYLINE', '8', layer, '66', '1', '70', '1' if closed else '0']
        for x, y in pts: o += ['0', 'VERTEX', '8', layer, '10', f'{x:.4f}', '20', f'{-y:.4f}']
        return o + ['0', 'SEQEND', '8', layer]
    for part, x, y in sheet_parts:
        for p in part['cut']: out += poly(shift(p, x, y), 'CUT', True)
        for p in part['eng']: out += poly(shift(p, x, y), 'ENGRAVE', False)
    out += ['0', 'ENDSEC', '0', 'EOF']
    open(path, 'w').write('\n'.join(out) + '\n')

if __name__ == '__main__':
    P, _ = build()
    b, c, r, f, d = P['base'], P['cheek'], P['back'], P['frame'], P['cover']
    os.makedirs(os.path.join(here, 'dxf'), exist_ok=True)
    dxf_for([(r, 10, 12), (b, 10, 12 + r['h'] + 12), (c, 150, 12), (c, 150, 12 + c['h'] + 12)], os.path.join(here, 'dxf', 'laser-A-3mm.dxf'))
    dxf_for([(f, 12, 12)], os.path.join(here, 'dxf', 'laser-B-1.5mm.dxf')); dxf_for([(d, 12, 12)], os.path.join(here, 'dxf', 'laser-C-2mm-clear.dxf'))
    for k, v in P.items(): print(f'{k:6} {v["name"]:22} {v["mat"]} mm  {v["w"]:.1f} × {v["h"]:.1f}')
