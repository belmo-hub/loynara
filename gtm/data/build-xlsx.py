"""Builds funnel-model.xlsx (sheets: Funnel, Month one) from funnel-model.csv and month-one-model.csv with live formulas (stdlib only).
Run: python3 gtm/data/build-xlsx.py"""
import csv, zipfile, os
from xml.sax.saxutils import escape

here = os.path.dirname(os.path.abspath(__file__))
rows = list(csv.reader(open(os.path.join(here, 'funnel-model.csv'), encoding='utf-8')))
thresholds = [
    ['', 'Diagnostic floors (target scenario)', 'floor', 'judge after n', '', '', 'If below the floor'],
    ['', 'door → owner conversation', 0.30, 60, '', '', 'Wrong time of day/street. Move to Tue–Thu 14:30–17:00; avoid lunch rush and Saturdays.'],
    ['', 'conversation → demo', 0.35, 40, '', '', 'Opener problem. Switch to the hand-the-phone opener (scan the demo QR).'],
    ['', 'demo → pilot', 0.20, 25, '', '', 'Offer/fit problem. Tag every lost demo with its objection; review the top 2.'],
    ['', 'pilot active by day 14 (≥25 confirmed visits)', 0.60, 10, '', '', 'Onboarding problem. Staff not scanning: day-3 visit, re-brief team.'],
    ['', 'pilot → paid', 0.60, 10, '', '', 'Value not visible. Review owner usage; run the day-21 review in person.'],
]

def col(i): return chr(ord('A') + i)
def cell(ref, v):
    if isinstance(v, (int, float)): return f'<c r="{ref}"><v>{v}</v></c>'
    if isinstance(v, str) and v.startswith('='): return f'<c r="{ref}"><f>{escape(v[1:].replace(";", ","))}</f></c>'
    try: return f'<c r="{ref}"><v>{float(v)}</v></c>' if v not in ('',) and v.replace('.', '', 1).isdigit() else (f'<c r="{ref}" t="inlineStr"><is><t>{escape(v)}</t></is></c>' if v else '')
    except Exception: return f'<c r="{ref}" t="inlineStr"><is><t>{escape(str(v))}</t></is></c>'

def sheet_xml(rows, widths):
    out = []
    for r, row in enumerate(rows, start=1):
        cells = ''.join(cell(f'{col(c)}{r}', v) for c, v in enumerate(row))
        out.append(f'<row r="{r}">{cells}</row>')
    cols = ''.join(f'<col min="{a}" max="{b}" width="{w}" customWidth="1"/>' for a, b, w in widths)
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            f'<cols>{cols}</cols><sheetData>{"".join(out)}</sheetData></worksheet>')

month = list(csv.reader(open(os.path.join(here, 'month-one-model.csv'), encoding='utf-8')))
sheet = sheet_xml(rows + [[]] + thresholds, [(2, 2, 38), (3, 5, 14), (7, 7, 80)])
sheet2 = sheet_xml(month, [(2, 2, 40), (3, 8, 16), (10, 10, 80)])
files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Funnel" sheetId="1" r:id="rId1"/><sheet name="Month one" sheetId="2" r:id="rId2"/></sheets><calcPr fullCalcOnLoad="1"/></workbook>',
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': sheet,
    'xl/worksheets/sheet2.xml': sheet2,
}
with zipfile.ZipFile(os.path.join(here, 'funnel-model.xlsx'), 'w', zipfile.ZIP_DEFLATED) as z:
    for name, data in files.items(): z.writestr(name, data)
print('wrote funnel-model.xlsx')
