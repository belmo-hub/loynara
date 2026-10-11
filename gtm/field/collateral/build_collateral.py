"""Builds the printed field collateral (PDF + HTML) from templates/*.html and variants.py.
Default = LIVE NOW wording. After the gates pass: python3 build_collateral.py --rc --nfc   (writes to build-post/ and print-post/, never over the current print set)"""
import os, re, subprocess, sys
import variants as V

here = os.path.dirname(os.path.abspath(__file__))
nfc, rc = '--nfc' in sys.argv, '--rc' in sys.argv
suffix = '' if not (nfc or rc) else '-post'
build, out = os.path.join(here, 'build' + suffix), os.path.join(here, 'print' + suffix)
prev = os.path.join(here, 'preview' + suffix)
for d in (build, out, prev): os.makedirs(d, exist_ok=True)
v = V.variant(nfc=nfc, rc=rc)
TEMPLATES = [f for f in sorted(os.listdir(os.path.join(here, 'templates'))) if f.endswith('.html')]
if '--only' in sys.argv: TEMPLATES = [f for f in TEMPLATES if sys.argv[sys.argv.index('--only') + 1] in f]
for t in TEMPLATES:
    html = open(os.path.join(here, 'templates', t), encoding='utf-8').read()
    html = re.sub(r'\{\{(\w+)\}\}', lambda m: v[m.group(1)], html)  # KeyError = a template uses an undefined key
    assert '{{' not in html, t
    name = t[:-5]
    open(os.path.join(build, t), 'w', encoding='utf-8').write(html)
    subprocess.run(['node', os.path.join(here, 'render.mjs'), os.path.join(build, t), os.path.join(out, name + '.pdf'), os.path.join(prev, name + '.png')], check=True)
    print('built', name, '·', v['variant'])
