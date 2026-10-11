"""Builds every stand deliverable from geometry.py and artwork.py. Usage: python3 gtm/field/stand/build_stand.py [--frame 1.5|2.0]
(frame thickness comes from the measured tag; default 1.5). Needs Chrome via Playwright for PDFs/PNGs."""
import os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
env = dict(os.environ)
if '--frame' in sys.argv: env['LOYNARA_FRAME_MM'] = sys.argv[sys.argv.index('--frame') + 1]
def run(*a): subprocess.run(list(a), cwd=here, env=env, check=True)
py = sys.executable
run(py, 'artwork.py'); run(py, 'cutfiles.py')
from PIL import Image
for v in ('pre', 'post'):   # render insert PNG (8 px/mm incl. bleed) and the trimmed copy
    run('node', 'render-svg.mjs', f'svg/insert-{v}-nfc.svg', '-', f'png/insert-{v}-nfc.png', '111', '154', '8')
    im = Image.open(os.path.join(here, 'png', f'insert-{v}-nfc.png')); k = 8
    im.crop((3 * k, 3 * k, 108 * k, 151 * k)).save(os.path.join(here, 'png', f'insert-{v}-nfc_trim.png'))
run('node', 'render-svg.mjs', 'svg/insert-pre-nfc.svg', 'pdf/insert-pre-nfc_print-bleed.pdf', '-', '111', '154')
run('node', 'render-svg.mjs', 'svg/insert-pre-nfc-cropmarks.svg', 'pdf/insert-pre-nfc_print-cropmarks.pdf', 'png/insert-pre-nfc_cropmarks.png', '125', '168', '6')
run('node', 'render-svg.mjs', 'svg/insert-post-nfc.svg', 'pdf/HOLD_insert-post-nfc_print-bleed.pdf', '-', '111', '154')
run('node', 'render-svg.mjs', 'svg/insert-post-nfc-cropmarks.svg', 'pdf/HOLD_insert-post-nfc_print-cropmarks.pdf', 'png/insert-post-nfc_cropmarks_HOLD.png', '125', '168', '6')
run('node', 'render-svg.mjs', 'svg/label-back.svg', 'pdf/label-back.pdf', 'png/label-back.png', '56', '26', '10')
for name, w, h in (('laser-A-3mm', 300, 300), ('laser-B-1.5mm', 140, 180), ('laser-C-2mm-clear', 140, 180)):
    run('node', 'render-svg.mjs', f'svg/{name}.svg', f'pdf/{name}.pdf', '-', str(w), str(h))
run(py, 'fabsheet_page2.py'); run('node', 'render-html.mjs', 'fabrication-sheet.html', 'pdf/fabrication-sheet_FS-01-02_A3.pdf', 'png/fabrication-sheet', '3')
run(py, 'preview3d.py')
run('node', 'render-svg.mjs', 'preview/stand-pre-nfc.svg', '-', 'png/stand-pre-nfc_3d.png', '291', '331', '4')
run('node', 'render-svg.mjs', 'preview/stand-post-nfc.svg', '-', 'png/stand-post-nfc_3d_HOLD.png', '291', '331', '4')
run(py, 'actual_size_sheet.py')
run(py, 'qa.py')
print('stand build complete')
