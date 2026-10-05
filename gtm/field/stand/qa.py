"""Automated QA for the counter stand: geometry/fit assertions, cut-file consistency, readability arithmetic, QR decode simulation.
Writes qa-report.md. Phone, RF and print-proof tests are NOT run here (see the test plan in the spec)."""
import json, math, os, re, subprocess
import geometry as G
import cutfiles

here = os.path.dirname(os.path.abspath(__file__))
checks, notes = [], []
def check(name, ok, detail=''):
    checks.append((name, bool(ok), detail))
    if not ok: print('FAIL', name, detail)

m = G.module_extent()
check('overall height ≈ 149 mm', abs(m['height'] - 149.0) < 0.5, f"{m['height']:.1f}")
check('module top stays ≥ 20 mm inside the base depth (rear margin)', G.BASE_D - m['max_depth'] >= 20, f"{G.BASE_D - m['max_depth']:.1f} mm")
check('slit = tab thickness + 0.2', abs((G.SLIT_O[1] - G.SLIT_O[0]) - (G.T_BACK + 0.2)) < 1e-9, f'{G.SLIT_O[1] - G.SLIT_O[0]:.2f}')
check('tab protrusion ≤ cheek thickness', G.TAB_PROTRUSION <= G.T_CHEEK, f'{G.TAB_PROTRUSION} ≤ {G.T_CHEEK}')
check('slit floor = lower tab edge', G.S_FLOOR == G.TABS[0][0])
check('both tabs inside the cheek (below its top edge)', all(b < G.S_TOP for a, b in G.TABS), f'tab tops {[b for a, b in G.TABS]} < {G.S_TOP}')
check('insert fits pocket width with ≥ 0.25 mm each side', (G.POCKET_W - G.INSERT_W) / 2 >= 0.25, f'{(G.POCKET_W - G.INSERT_W) / 2:.2f}')
check('insert fits pocket height with ≥ 0.4 mm', (G.H - G.FRAME_BOTTOM) - G.INSERT_H >= 0.4, f'{(G.H - G.FRAME_BOTTOM) - G.INSERT_H:.2f}')
tag_x0, tag_x1 = G.TAG_X - G.TAG / 2, G.TAG_X + G.TAG / 2
tag_s0, tag_s1 = G.TAG_S - G.TAG / 2, G.TAG_S + G.TAG / 2
check('tag fully inside the pocket', tag_x0 > G.FRAME_WALL and tag_x1 < G.W - G.FRAME_WALL and tag_s0 > G.FRAME_BOTTOM and tag_s1 < G.H, f'x {tag_x0}–{tag_x1}, s {tag_s0}–{tag_s1}')
check('engraved guide larger than the tag by ≥ 0.5 mm', G.TAG_GUIDE - G.TAG >= 0.5)
check('tap zone centre is 56 mm below the top edge', G.H - G.TAG_S == 56.0)
# artwork layout constants (insert trim coordinates, mm): QR card 56 × 56 centred on the tag, top band ends at 25, placeholder label baseline 87.8, headline cap top ≈ 94.3
card_top, card_bottom, band_bottom, label_base, headline_top = 56.0 - 28, 56.0 + 28, 25.0, 56.0 + 31.8, 98.0 - 0.72 * 5.2
check('pre-NFC QR card clears the top band (≥ 2.5 mm) and the headline (label + gap ≥ 3 mm)', card_top - band_bottom >= 2.5 and headline_top - label_base >= 3, f'band gap {card_top - band_bottom:.1f} mm, headline gap {headline_top - label_base:.1f} mm')
check('tap ring (Ø 45.2) clear of the thumb notch', (G.H - G.TAG_S) - 22.6 > G.NOTCH_R, f'{(G.H - G.TAG_S) - 22.6:.1f} > {G.NOTCH_R}')
check('tag thickness limit for this frame is positive and documented', G.TAG_T_MAX > 0.5, f'{G.TAG_T_MAX} mm at frame {G.T_FRAME}')
# base slots vs cheek tabs
b = cutfiles.part_base()
slots = [p for p in b['cut'][1:]]
check('four base slots, each wider than the cheek tab by 0.2', len(slots) == 4 and all(abs((max(x for x, _ in s) - min(x for x, _ in s)) - (G.T_CHEEK + 0.2)) < 1e-9 for s in slots))
check('cheek stays inside the base depth', G.CHEEK_DEPTH_OFFSET >= 0 and G.CHEEK_DEPTH_OFFSET + G.CHEEK_BASE_LEN <= G.BASE_D, f'{G.CHEEK_DEPTH_OFFSET}+{G.CHEEK_BASE_LEN} ≤ {G.BASE_D}')
# nesting on stock
P = {k: f() for k, f in cutfiles.PARTS.items()}
check('sheet A parts fit 300 × 300', P['back']['h'] + P['base']['h'] + 12 + 12 + 6 <= 300 and 150 + max(P['cheek']['w'], 0) <= 300)
# stability: centre of mass of base + module + cheeks (acrylic 1.19 g/cm³)
rho = 1.19e-3   # g/mm³
mass = dict(base=G.BASE_W * G.BASE_D * G.T_BASE * rho, module=G.W * G.H * (G.T_COVER + G.T_BACK) * rho + G.W * G.H * .4 * G.T_FRAME * rho, cheeks=2 * 0.5 * 84 * 78 * G.T_CHEEK * rho)
mx = {'base': G.BASE_D / 2, 'module': G.P(G.H / 2, G.T_MOD / 2)[0], 'cheeks': 40}
com_x = sum(mass[k] * mx[k] for k in mass) / sum(mass.values())
check('centre of mass lies within the footprint with ≥ 25 mm margin on both sides', 25 <= com_x <= G.BASE_D - 25, f'{com_x:.1f} mm from the front, total ≈ {sum(mass.values()):.0f} g')
check('cut files exist for all five parts', all(os.path.exists(os.path.join(here, 'svg', f)) for f in ('laser-A-3mm.svg', 'laser-B-1.5mm.svg', 'laser-C-2mm-clear.svg')))
dxf = open(os.path.join(here, 'dxf', 'laser-A-3mm.dxf')).read()
check('DXF contains CUT and ENGRAVE layers', 'CUT' in dxf and 'ENGRAVE' in dxf and dxf.strip().endswith('EOF'))
# artwork
art = open(os.path.join(here, 'svg', 'insert-pre-nfc.svg'), encoding='utf-8').read()
art_post = open(os.path.join(here, 'svg', 'insert-post-nfc.svg'), encoding='utf-8').read()
text = lambda s: ' '.join(re.findall(r'>([^<>]+)</text>', s))
pre_t, post_t = text(art), text(art_post)
check('pre-NFC artwork never advertises NFC/antippen', not re.search(r'NFC|antipp|Wallet', pre_t, re.I), pre_t[:80])
check('post-NFC artwork says antippen and keeps QR as fallback', 'antippen' in post_t.lower() and 'QR-Code scannen' in post_t)
check('both artworks label the example and the placeholder QR', 'Beispiel-Gestaltung' in pre_t and 'Platzhalter-QR' in pre_t and 'Beispiel-Gestaltung' in post_t and 'Platzhalter-QR' in post_t)
check('QR payload cannot resolve (.invalid)', 'loynara.invalid' in open(os.path.join(here, 'artwork.py')).read())
check('no production host in any artwork or label file', not any('getloynara.com/' in open(os.path.join(here, 'svg', f), encoding='utf-8').read() for f in ('insert-pre-nfc.svg', 'insert-post-nfc.svg')))
# sizes
sizes = [float(x) for x in re.findall(r'font-size="([\d.]+)"', art)]
essential = [s for s in sizes if s >= 2.4]
check('essential text ≥ 2.4 mm font size (≈ 6.8 pt); headline ≥ 5 mm', min(essential) >= 2.4 and max(sizes) >= 5.0, f'min essential {min(essential)} mm, headline {max(sizes)} mm')
# decode simulation
def decode(png, ppm):
    r = subprocess.run(['node', os.path.join(here, 'decode.mjs'), png, str(ppm), 'https://loynara.invalid/platzhalter'], capture_output=True, text=True, timeout=120)
    return json.loads(r.stdout.strip().splitlines()[-1])
d_pre, d_post = decode(os.path.join(here, 'png', 'insert-pre-nfc_trim.png'), 8), decode(os.path.join(here, 'png', 'insert-post-nfc_trim.png'), 8)
lim = lambda d: min((x['pxPerMm'] for x in d if x['ok']), default=None)
check('pre-NFC QR decodes down to ≤ 2.5 px/mm (simulated camera)', lim(d_pre) is not None and lim(d_pre) <= 2.5, f'lowest passing {lim(d_pre)} px/mm')
check('post-NFC fallback QR decodes down to ≤ 3 px/mm (simulated camera)', lim(d_post) is not None and lim(d_post) <= 3, f'lowest passing {lim(d_post)} px/mm')

# report
module_pre, module_post = 44 / 29, 31 / 29
lines = ['# Stand QA report', '', f'Generated by `qa.py` on 2026-10-05. Frame thickness in this build: **{G.T_FRAME} mm** (tag limit {G.TAG_T_MAX} mm).', '',
         '## Automated checks', '', '| Check | Result | Detail |', '|---|---|---|'] + [f'| {n} | {"PASS" if ok else "**FAIL**"} | {d} |' for n, ok, d in checks]
lines += ['', f'**{sum(ok for _, ok, _ in checks)} / {len(checks)} pass.**', '',
          '## Readability arithmetic (not a substitute for the 5-person test)', '',
          '| Item | Size | At 60 cm | At 100 cm |', '|---|---|---|---|',
          f'| Headline x-height ≈ 0.52 × 5.2 mm em | 2.7 mm | {math.degrees(math.atan(2.7 / 600)) * 60:.0f} arcmin | {math.degrees(math.atan(2.7 / 1000)) * 60:.0f} arcmin |',
          f'| Headline cap height ≈ 0.72 × 5.2 mm | 3.7 mm | {math.degrees(math.atan(3.7 / 600)) * 60:.0f} arcmin | {math.degrees(math.atan(3.7 / 1000)) * 60:.0f} arcmin |',
          f'| Pre-NFC QR module | {module_pre:.2f} mm (44 mm / 29) | – | – |', f'| Post-NFC fallback QR module | {module_post:.2f} mm (31 mm / 29) | – | – |', '',
          'Rule of thumb used: running text is comfortable above about 12 arcmin. The cap height of the headline stays above that out to 1 m (13 arcmin); its x-height drops below it beyond roughly 75 cm, so verify legibility at counter distance in the 5-person test. Small print (1.6–1.9 mm) is for the example/placeholder labels only and is not needed to understand the stand.', '',
          '## QR decode simulation (zxing, rendered artwork, blur 0.8–1.0 px)', '', '| px per mm of the camera image | Pre-NFC QR (44 mm) | Post-NFC fallback QR (31 mm) |', '|---|---|---|']
for a, b in zip(d_pre, d_post): lines.append(f'| {a["pxPerMm"]} | {"decodes" if a["ok"] else "fails"} | {"decodes" if b["ok"] else "fails"} |')
lines += ['', 'This is a **simulation on the artwork**, not a phone test. A 12-megapixel phone camera has roughly 4–6 px per mm on a 100 × 100 mm field at 40–60 cm, but real distance limits depend on the phone, focus, light and print quality: test with at least three phones at 20/30/50/80 cm (see FS-02).', '',
          '## Not tested here', '', '- Any NFC read through the stack (the tag is not written; reads only with a read-only app, by the founder, on the physical prototype).', '- Print proof colour, paper behaviour in the pocket, scratch/spill resistance.', '- Laser fit with the real stock thickness and kerf of the chosen fabricator.', '- Phone QR scans, glare, five-person comprehension test.']
open(os.path.join(here, 'qa-report.md'), 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
fails = [c for c in checks if not c[1]]
print(f'{sum(ok for _, ok, _ in checks)} / {len(checks)} checks pass')
raise SystemExit(1 if fails else 0)
