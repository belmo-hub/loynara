"""Loynara counter stand "Tresenaufsteller A6": all dimensions in mm, one source of truth for drawings, cut files and the spec.
Coordinates in side view: x rearwards (0 = front edge of the base), z upwards (0 = top face of the base plate).
Mechanical/visual design only. No RF performance is claimed; the tag is not written or provisioned."""
import math, os

TH = math.radians(20)                     # module leans back 20° from vertical (face normal 20° above horizontal)
SIN, COS = math.sin(TH), math.cos(TH)
U = (SIN, COS)                            # along the module, bottom → top
D = (COS, -SIN)                           # into the module, front face → rear

# ── module (face assembly): clear cover + spacer frame + back plate, solvent-cemented ──
W, H = 112.0, 150.0                       # module outline
INSERT_T = 0.35                           # printed insert thickness (card 300–350 g/m² or 0.3 mm synthetic)
T_FRAME = float(os.environ.get('LOYNARA_FRAME_MM', '1.5'))   # spacer frame: choose from the MEASURED tag thickness (rule below)
T_COVER, T_BACK = 2.0, 3.0
TAG_T_MAX = round(T_FRAME - INSERT_T - 0.1, 2)  # thickest tag the pocket accepts (1.05 for a 1.5 mm frame, 1.55 for 2.0 mm)
T_MOD = T_COVER + T_FRAME + T_BACK        # 6.5
R_MOD = 4.0                               # corner radius of the module plates
INSERT_W, INSERT_H = 105.0, 148.0         # A6 insert, trimmed
POCKET_W = 105.6                          # frame pocket (0.3 mm clearance per side)
FRAME_WALL = (W - POCKET_W) / 2           # 3.2
FRAME_BOTTOM = 1.5                        # bar below the pocket: pocket height 148.5 for a 148.0 insert
FRAME_RULE = 'Rahmen 1,5 mm bei Tag ≤ 1,05 mm · Rahmen 2,0 mm bei Tag ≤ 1,55 mm · Rahmen 3,0 mm bei Tag ≤ 2,55 mm'
NOTCH_R = 9.0                             # thumb notch in the cover top edge

# ── NFC tag (PVC on-metal sticker, 28 × 28 mm; thickness to be measured, assumed ≤ 1.15 mm) ──
TAG = 28.0
TAG_GUIDE = 29.0                          # engraved placement frame
TAG_S = 94.0                              # tag centre, measured up the module from its bottom edge (= 56 mm below the top edge)
TAG_X = W / 2

# ── cheeks and base ──
T_CHEEK = 3.0
SIDE_GAP = 0.2                            # clearance module ↔ cheek, per side
CHEEK_SPACING = W + 2 * SIDE_GAP          # 112.4
BASE_MARGIN = 2.0                         # base material outside each cheek (keeps the slots closed)
BASE_W = CHEEK_SPACING + 2 * T_CHEEK + 2 * BASE_MARGIN   # 122.4
BASE_D = 92.0
T_BASE = 3.0
R_BASE = 6.0
F0 = (12.0, 8.0)                          # front-bottom corner of the module cover in side view (x, z)
TAB_PROTRUSION = 2.8                      # back-plate tab length through the cheek slit
TABS = [(6.0, 30.0), (38.0, 62.0)]        # tab ranges along the module (s from its bottom edge)
SLIT_O = (T_COVER + T_FRAME - 0.1, T_MOD + 0.1)    # slit across the module depth: back-plate thickness + 0.1 each side → 3.2 wide
S_FLOOR = TABS[0][0]                      # cheek slit floor = lower edge of the lower tab
S_TOP = 70.0                              # cheek top edge, perpendicular to the module
O_FRONT, O_REAR = -18.0, 22.0             # cheek top edge extends this far in front of / behind the module's front face
CHEEK_BASE_LEN = 84.0
CHEEK_DEPTH_OFFSET = (BASE_D - CHEEK_BASE_LEN) / 2   # cheek starts 4 mm behind the base front edge
CHEEK_TABS = [(8.0, 30.0), (54.0, 76.0)]  # cheek bottom tabs (x ranges) into base slots
CHEEK_TAB_DEPTH = T_BASE
SLOT_CLEAR = 0.1                          # added to slots per side

def P(s, o, f0=F0):
    """Side-view point at distance s up the module and depth o behind its front face."""
    return (f0[0] + s * U[0] + o * D[0], f0[1] + s * U[1] + o * D[1])

def cheek_outline():
    """Closed polygon of one cheek in side view (x, z), without the bottom tabs and the slit."""
    return [(0.0, 0.0), (CHEEK_BASE_LEN, 0.0), P(S_TOP, O_REAR), P(S_TOP, O_FRONT)]

def slit_polygon():
    """The open slit for the back-plate tabs: from the floor up through the top edge, as a rotated rectangle."""
    s0, s1 = S_FLOOR, S_TOP + 30.0
    return [P(s0, SLIT_O[0]), P(s0, SLIT_O[1]), P(s1, SLIT_O[1]), P(s1, SLIT_O[0])]

def module_extent():
    top_front, top_rear = P(H, 0), P(H, T_MOD)
    return dict(top_front=top_front, top_rear=top_rear, height=top_front[1], max_depth=max(top_front[0], top_rear[0]))

if __name__ == '__main__':
    m = module_extent()
    print(f'tilt 20°, overall height {m["height"]:.1f} mm, module top reaches x={m["max_depth"]:.1f} of base depth {BASE_D}, base {BASE_W:.1f} × {BASE_D}')
    print('cheek outline', [tuple(round(v, 1) for v in p) for p in cheek_outline()])
    print('tag centre side view', tuple(round(v, 1) for v in P(TAG_S, T_COVER + T_FRAME)))
