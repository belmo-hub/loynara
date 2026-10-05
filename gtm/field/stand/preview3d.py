"""Orthographic preview of the assembled stand: the real geometry projected to SVG (painter's algorithm), the insert artwork mapped onto the face with an exact affine transform.
A visual impression for judging the design, not a CAD model or a render of material properties."""
import math, os, sys
import geometry as G
here = os.path.dirname(os.path.abspath(__file__))

def world(w, x, z):   # model (across, rearwards x, up z) → world (X right, Y up, Z toward viewer)
    return (w, z, G.BASE_D / 2 - x)

def rot(p, yaw, pitch):
    x, y, z = p
    a, b = math.radians(yaw), math.radians(pitch)
    x1, z1 = x * math.cos(a) + z * math.sin(a), -x * math.sin(a) + z * math.cos(a)
    y1, z2 = y * math.cos(b) - z1 * math.sin(b), y * math.sin(b) + z1 * math.cos(b)
    return (x1, y1, z2)

class Scene:
    def __init__(self, yaw, pitch, scale, cx, cy):
        self.yaw, self.pitch, self.k, self.cx, self.cy = yaw, pitch, scale, cx, cy
        self.light = self._norm((-0.45, 0.8, 0.55))
    @staticmethod
    def _norm(v):
        l = math.sqrt(sum(c * c for c in v)); return tuple(c / l for c in v)
    def proj(self, p):
        x, y, z = rot(p, self.yaw, self.pitch)
        return (self.cx + x * self.k, self.cy - y * self.k, z)
    def face(self, pts, base, opacity=1.0, stroke=None):
        r = [rot(p, self.yaw, self.pitch) for p in pts]
        # normal in camera space from the first three points; cull faces turned away
        u = (r[1][0] - r[0][0], r[1][1] - r[0][1], r[1][2] - r[0][2]); v = (r[2][0] - r[0][0], r[2][1] - r[0][1], r[2][2] - r[0][2])
        n = (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0])
        # world normal for lighting
        u2 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]); v2 = (pts[2][0] - pts[0][0], pts[2][1] - pts[0][1], pts[2][2] - pts[0][2])
        wn = self._norm((u2[1] * v2[2] - u2[2] * v2[1], u2[2] * v2[0] - u2[0] * v2[2], u2[0] * v2[1] - u2[1] * v2[0]))
        facing = n[2]                                  # camera looks down −z in camera space, so n.z > 0 means turned toward the viewer
        depth = sum(q[2] for q in r) / len(r)
        return dict(pts=[self.proj(p) for p in pts], facing=facing, light=max(0.0, wn[0] * self.light[0] + wn[1] * self.light[1] + wn[2] * self.light[2]), base=base, opacity=opacity, depth=depth, stroke=stroke)

def shade(hexcol, f):
    c = [int(hexcol[i:i + 2], 16) for i in (1, 3, 5)]
    k = 0.45 + 0.7 * f
    return '#%02x%02x%02x' % tuple(max(0, min(255, int(v * k))) for v in c)

def box_faces(sc, w0, w1, y0, y1, z0, z1, col):
    P = lambda a, b, c: (a, b, c)
    quads = [([P(w0, y0, z1), P(w1, y0, z1), P(w1, y1, z1), P(w0, y1, z1)]), ([P(w1, y0, z0), P(w0, y0, z0), P(w0, y1, z0), P(w1, y1, z0)]),
             ([P(w0, y0, z0), P(w0, y0, z1), P(w0, y1, z1), P(w0, y1, z0)]), ([P(w1, y0, z1), P(w1, y0, z0), P(w1, y1, z0), P(w1, y1, z1)]),
             ([P(w0, y1, z1), P(w1, y1, z1), P(w1, y1, z0), P(w0, y1, z0)]), ([P(w0, y0, z0), P(w1, y0, z0), P(w1, y0, z1), P(w0, y0, z1)])]
    return [sc.face(q, col) for q in quads]

def prism_faces(sc, poly2d, w0, w1, col):
    """Extrude a side-view polygon (x rearwards, z up) between across-coordinates w0 and w1."""
    n = len(poly2d); faces = []
    A = [world(w0, x, z) for x, z in poly2d]; B = [world(w1, x, z) for x, z in poly2d]
    faces.append(sc.face(A[::-1], col)); faces.append(sc.face(B, col))
    for i in range(n):
        j = (i + 1) % n
        faces.append(sc.face([A[i], A[j], B[j], B[i]], col))
    return faces

def render(variant='pre', yaw=-32, pitch=20, W=1100, H=1250, scale=5.2):
    sc = Scene(yaw, pitch, scale, W / 2, H * 0.72)
    out = []
    # ground shadow
    sh = [world(x, d, 0) for x, d in ((-70, -6), (70, -6), (74, 96), (-70, 100))]
    out.append('<polygon points="' + ' '.join(f'{sc.proj(p)[0]:.1f},{sc.proj(p)[1] + 3:.1f}' for p in [(p[0], -3.2, p[2]) for p in sh]) + '" fill="rgba(0,0,0,.10)" filter="url(#bl)"/>')
    def draw(faces):
        for f in sorted(faces, key=lambda f: f['depth']):
            if f['facing'] <= 0 and f['opacity'] >= .99: continue
            if f['facing'] <= 0: continue
            pts = ' '.join(f'{x:.1f},{y:.1f}' for x, y, _ in f['pts'])
            out.append(f'<polygon points="{pts}" fill="{shade(f["base"], f["light"])}" fill-opacity="{f["opacity"]}" stroke="{f["stroke"] or shade(f["base"], f["light"] * .6)}" stroke-width=".6" stroke-linejoin="round"/>')
    BLACK = '#262626'
    draw(box_faces(sc, -G.BASE_W / 2, G.BASE_W / 2, -G.T_BASE, 0, -G.BASE_D / 2, G.BASE_D / 2, BLACK))
    pts = G.cheek_outline()
    slit = G.slit_polygon()
    poly = [pts[0], pts[1], pts[2], G.P(G.S_TOP, G.SLIT_O[1]), G.P(G.S_FLOOR, G.SLIT_O[1]), G.P(G.S_FLOOR, G.SLIT_O[0]), G.P(G.S_TOP, G.SLIT_O[0]), pts[3]]
    off = G.CHEEK_SPACING / 2
    left, right = prism_faces(sc, poly, -off - G.T_CHEEK, -off, BLACK), prism_faces(sc, poly, off, off + G.T_CHEEK, BLACK)
    far, near = (left, right) if yaw < 0 else (right, left)
    draw(far)
    # module: three layers + insert + clear cover edge
    def layer(o0, o1, col, op=1.0):
        c = lambda w, s, o: world(w, *G.P(s, o)) if False else None
        W2 = G.W / 2
        def pt(w, s, o):
            x, z = G.P(s, o); return world(w, x, z)
        quads = [[pt(-W2, 0, o0), pt(W2, 0, o0), pt(W2, G.H, o0), pt(-W2, G.H, o0)],          # front (towards viewer)
                 [pt(W2, 0, o1), pt(-W2, 0, o1), pt(-W2, G.H, o1), pt(W2, G.H, o1)],           # back
                 [pt(-W2, 0, o1), pt(-W2, 0, o0), pt(-W2, G.H, o0), pt(-W2, G.H, o1)],         # left
                 [pt(W2, 0, o0), pt(W2, 0, o1), pt(W2, G.H, o1), pt(W2, G.H, o0)],             # right
                 [pt(-W2, G.H, o0), pt(W2, G.H, o0), pt(W2, G.H, o1), pt(-W2, G.H, o1)]]       # top
        return [sc.face(q, col, op) for q in quads]
    draw(layer(G.T_COVER + G.T_FRAME, G.T_MOD, '#202020'))
    draw(layer(G.T_COVER, G.T_COVER + G.T_FRAME, '#1a1a1a'))
    # insert as a textured quad at o = T_COVER
    W2 = G.INSERT_W / 2
    def tp(w, s):
        x, z = G.P(s, G.T_COVER); return sc.proj(world(w, x, z))
    s0 = G.FRAME_BOTTOM
    tl, tr, bl = tp(-W2, s0 + G.INSERT_H), tp(W2, s0 + G.INSERT_H), tp(-W2, s0)
    iw, ih = 105 * 8, 148 * 8
    m = ((tr[0] - tl[0]) / iw, (tr[1] - tl[1]) / iw, (bl[0] - tl[0]) / ih, (bl[1] - tl[1]) / ih, tl[0], tl[1])
    import base64
    b64 = base64.b64encode(open(os.path.join(here, 'png', f'insert-{variant}-nfc_trim.png'), 'rb').read()).decode()
    insert = f'<image href="data:image/png;base64,{b64}" width="{iw}" height="{ih}" transform="matrix({" ".join(f"{v:.5f}" for v in m)})"/>'
    # cover (clear): edges tinted, front gets a faint highlight
    cover = layer(0, G.T_COVER, '#bfe6f2', .16)
    cover_front = [f for f in cover]
    draw(near[:0])
    out.append(insert)
    draw(cover)
    # glare on the cover front
    c0 = [sc.proj(world(-G.W / 2, *G.P(0, 0))), sc.proj(world(G.W / 2, *G.P(0, 0))), sc.proj(world(G.W / 2, *G.P(G.H, 0))), sc.proj(world(-G.W / 2, *G.P(G.H, 0)))]
    out.append('<polygon points="' + ' '.join(f'{p[0]:.1f},{p[1]:.1f}' for p in c0) + '" fill="url(#gl)"/>')
    draw(near)
    cap = ('Vorschau Pre-NFC · QR primär · Beispiel „Take a Piz“ · Platzhalter-QR' if variant == 'pre' else 'Vorschau Post-NFC · HOLD: nicht drucken bis NFC-Abnahme · Beispiel „Take a Piz“')
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{W}" height="{H}" viewBox="0 0 {W} {H}" font-family="Manrope,Arial,sans-serif">'
           f'<defs><radialGradient id="bg" cx="50%" cy="30%" r="80%"><stop offset="0" stop-color="#F2EEE3"/><stop offset="1" stop-color="#D9D2C1"/></radialGradient>'
           f'<linearGradient id="gl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset=".35" stop-color="#fff" stop-opacity="0"/><stop offset=".78" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#fff" stop-opacity=".10"/></linearGradient>'
           f'<filter id="bl"><feGaussianBlur stdDeviation="9"/></filter></defs><rect width="{W}" height="{H}" fill="url(#bg)"/>{"".join(out)}'
           f'<text x="28" y="{H - 26}" font-size="16" font-weight="600" fill="#17291F" opacity=".85">{cap}</text></svg>')
    return svg

if __name__ == '__main__':
    os.makedirs(os.path.join(here, 'preview'), exist_ok=True)
    for v in ('pre', 'post'):
        open(os.path.join(here, 'preview', f'stand-{v}-nfc.svg'), 'w', encoding='utf-8').write(render(v))
    print('previews written')
