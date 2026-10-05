"""Builds prospects.csv, prospects.xlsx (sheets: Alle, FIRST 20, NEXT 20, FINAL 20, Legende) and route.md from prospect_data.py.
Run: python3 gtm/field/build_prospects.py   (stdlib only)"""
import csv, os, re, zipfile
from urllib.parse import quote_plus
from xml.sax.saxutils import escape
import prospect_data as D

here = os.path.dirname(os.path.abspath(__file__))
KIND = {'barber': 'Barber', 'pizza': 'Pizzeria', 'imbiss': 'Imbiss'}
WINDOWS = {
 'barber_tue': 'Di–Do 10:30–12:00 oder 14:30–16:30. Samstag und Mittagszeit meiden.',
 'barber_any': 'Mo–Do 10:30–12:00 oder 14:30–16:30. Samstag meiden.',
 'continuous': 'Mo–Do 14:30–16:30 (Nachmittagsflaute vor dem Abendgeschäft).',
 'split': 'Di–Do kurz vor dem Mittagsgeschäft (ca. 10:45–11:25, nur wenn Personal sichtbar) oder zum Mittagsende 14:10–14:40. Nicht 12:00–13:30, nicht ab 17:30.',
 'evening': 'Di–Do 15:15–16:45, kurz nach Öffnung. Nicht ab 18:00.',
 'lunch_only': 'Mo–Fr 14:00–15:30 (nach dem Mittagsansturm).',
}
OBJ = {'PAPER': 'Ich habe schon Stempelkarten (PAPER)', 'REGULARS': 'Ich kenne meine Stammkunden (REGULARS)', 'PRICE': '39 € ist zu teuer (PRICE)', 'STAFF': 'Meine Mitarbeiter machen das nicht (STAFF)',
       'TIME-COUNTER': 'Das dauert an der Kasse zu lange (TIME-COUNTER)', 'LIEFERANDO': 'Bestellungen laufen über Lieferando (LIEFERANDO)', 'CHAIN': 'Die Zentrale/der Vermieter entscheidet (CHAIN)'}
ANGLE = {'CORE-01': 'Der nächste Besuch', 'CORE-02': 'Sichtbarer Fortschritt', 'CORE-03': 'Papierkarte ablösen', 'CORE-05': 'Ein Ablauf im Stress', 'CORE-07': 'Empfehlung zählt beim echten Besuch',
         'OPS-05': 'Eigene Zugänge und Rollen', 'ACQ-05': 'Nicht der Laden nebenan', 'VER-02': 'Pizzeria: aus einer Bestellung die nächste', 'RET-03': 'Gehört deinem Laden, nicht einer Plattform'}
CONF = {'A': 'A · eigene Website abgerufen', 'B': 'B · mindestens zwei Quellen stimmen überein', 'C': 'C · eine Quelle oder Quellen widersprechen sich. Vor Ort prüfen'}

def maps(r): return 'https://www.google.com/maps/search/?api=1&query=' + quote_plus(f"{r['street'].split(' (')[0].split(' / ')[0]}, {r['plz']} Kassel")

def window(r):
    w = WINDOWS[r['window']]
    closed = re.findall(r'(Mo(?:/So)?|So/Mo|Mo/Di) zu', r['hours'])
    return w + (' Ruhetag beachten: ' + ', '.join(sorted(set(closed))) + ' zu.' if closed else '')

def enrich(r):
    o = dict(r)
    o['category'] = KIND[r['kind']]
    o['paper_stamp_card_evidence'] = 'Not evidenced online. Look at the counter on arrival.'
    o['digital_loyalty_evidence'] = 'None found online' if 'none found' in r['loyalty'] else 'See loyalty_public'
    o['loyalty_public'] = r['loyalty']
    o['best_walkin'] = window(r)
    o['angle_name'] = ANGLE[r['angle']]
    o['objection'] = OBJ[r['obj']]
    o['maps_url'] = maps(r)
    o['confidence_label'] = CONF[r['conf']]
    o['route_group'] = {'FIRST': 'FIRST 20', 'NEXT': 'NEXT 20', 'FINAL': 'FINAL 20'}[r['route']]
    o['retrieved'] = D.RETRIEVED
    o['visit_date'] = ''; o['visit_result'] = ''; o['visit_notes'] = ''
    return o

rows = [enrich(r) for r in D.ROWS]
COLS = [('id','merchant_id'),('route_group','route_group'),('day','route_day'),('order','route_order'),('name','business_name'),('category','category'),('street','street'),('plz','postcode'),('hood','neighborhood'),('cluster','cluster'),
 ('hours','opening_hours'),('web','website'),('insta','instagram'),('phone','public_phone'),('loyalty_public','loyalty_programme_public'),('paper_stamp_card_evidence','paper_stamp_card_evidence'),('digital_loyalty_evidence','digital_loyalty_evidence'),
 ('indep','chain_vs_independent'),('locs','approx_locations'),('owner','owner_operated_likely'),('booking','booking_or_ordering'),('staff','staff_visible'),('fit','why_loyalty_fits'),('angle','strongest_angle_id'),('angle_name','strongest_angle'),
 ('objection','likely_objection'),('demo','recommended_demo_story'),('best_walkin','best_walkin_period'),('pri','priority'),('conf','data_confidence'),('note','verification_note'),('src','sources'),('retrieved','retrieved_on'),('maps_url','maps_url'),
 ('visit_date','visit_date'),('visit_result','visit_result'),('visit_notes','visit_notes')]

def write_csv():
    with open(os.path.join(here, 'prospects.csv'), 'w', newline='', encoding='utf-8') as f:
        w = csv.writer(f); w.writerow([h for _, h in COLS]); [w.writerow([r[k] for k, _ in COLS]) for r in rows]

# ── minimal xlsx writer (inline strings, styles, frozen header, autofilter) ──
def colname(i): return chr(65 + i) if i < 26 else chr(64 + i // 26) + chr(65 + i % 26)
def sheet_xml(header, body, widths, pri_col=None):
    out = []
    def cell(ref, v, s): return f'<c r="{ref}" t="inlineStr" s="{s}"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'
    out.append('<row r="1" ht="32" customHeight="1">' + ''.join(cell(f'{colname(i)}1', h, 1) for i, h in enumerate(header)) + '</row>')
    for n, row in enumerate(body, start=2):
        cells = []
        for i, v in enumerate(row):
            s = 0
            if pri_col is not None and i == pri_col: s = {'A': 2, 'B': 3, 'C': 4}.get(v, 0)
            cells.append(cell(f'{colname(i)}{n}', v, s))
        out.append(f'<row r="{n}">' + ''.join(cells) + '</row>')
    cols = ''.join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i, w in enumerate(widths))
    last = f'{colname(len(header)-1)}{len(body)+1}'
    return ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
            '<sheetViews><sheetView workbookViewId="0"><pane xSplit="5" ySplit="1" topLeftCell="F2" activePane="bottomRight" state="frozen"/></sheetView></sheetViews>'
            f'<cols>{cols}</cols><sheetData>{"".join(out)}</sheetData><autoFilter ref="A1:{last}"/></worksheet>')
STYLES = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
 '<fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
 '<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
 '<fill><patternFill patternType="solid"><fgColor rgb="FF245D47"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFCDE6D2"/></patternFill></fill>'
 '<fill><patternFill patternType="solid"><fgColor rgb="FFFBEFC8"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE5E5E0"/></patternFill></fill></fills>'
 '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
 '<cellXfs count="5"><xf xfId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
 '<xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
 '<xf xfId="0" fontId="0" fillId="3" borderId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>'
 '<xf xfId="0" fontId="0" fillId="4" borderId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf>'
 '<xf xfId="0" fontId="0" fillId="5" borderId="0" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="top"/></xf></cellXfs></styleSheet>')

def write_xlsx():
    full_w = {'merchant_id':9,'route_group':10,'route_day':16,'route_order':7,'business_name':30,'category':10,'street':26,'postcode':8,'neighborhood':18,'cluster':14,'opening_hours':36,'website':32,'instagram':24,'public_phone':20,
              'loyalty_programme_public':26,'paper_stamp_card_evidence':26,'digital_loyalty_evidence':18,'chain_vs_independent':22,'approx_locations':16,'owner_operated_likely':14,'booking_or_ordering':22,'staff_visible':18,'why_loyalty_fits':50,
              'strongest_angle_id':10,'strongest_angle':24,'likely_objection':30,'recommended_demo_story':44,'best_walkin_period':40,'priority':8,'data_confidence':8,'verification_note':44,'sources':50,'retrieved_on':11,'maps_url':36,'visit_date':11,'visit_result':16,'visit_notes':30}
    sheets = []
    hdr = [h for _, h in COLS]
    sheets.append(('Alle 60', hdr, [[r[k] for k, _ in COLS] for r in rows], [full_w[h] for h in hdr], hdr.index('priority')))
    RH = ['#','Tag / Gebiet','Geschäft','Typ','Adresse','Öffnungszeiten (prüfen)','Beste Zeit','Winkel','Demo-Story','Wahrscheinlicher Einwand','Prio','Daten','Hinweis','Besucht (Datum)','Ergebnis','Notizen']
    RW = [5,18,28,10,30,36,40,28,40,30,6,6,40,12,16,30]
    for key, title in (('FIRST','FIRST 20'),('NEXT','NEXT 20'),('FINAL','FINAL 20')):
        sub = [r for r in rows if r['route'] == key]
        body = [[r['order'], r['day'], r['name'], r['category'], f"{r['street']}, {r['plz']} {r['hood']}", r['hours'], r['best_walkin'], f"{r['angle']} {r['angle_name']}", r['demo'], r['objection'], r['pri'], r['conf'], r['note'], '', '', ''] for r in sub]
        sheets.append((title, RH, body, RW, 10))
    leg = [['Priority A','Independent, counter or chair business, strong angle, route-friendly. Visit first.'],['Priority B','Good fit with one open question (hours, delivery share, unisex salon).'],
           ['Priority C','Weak fit or high uncertainty: chain/franchise possibility, shopping-centre tenant, delivery-heavy, restaurant, or conflicting data.'],
           ['Data confidence A','The business\'s own website was read.'],['Data confidence B','At least two public directory sources agree.'],['Data confidence C','One source, or sources conflict. Confirm on the door.'],
           ['Retrieved','2026-10-05. Public information only; nothing was contacted. Hours and existence can change: look before you walk in.'],
           ['Loyalty evidence','Paper stamp cards are only visible inside a shop, so none is claimed. "None found online" means only that.'],
           ['Names','No owner names or private data are recorded.'],['Phones','Landline or numbers a business publishes itself. Directory-only mobile numbers are left out.'],
           ['Instagram','Filled only when the shop\'s own site links it ("site") or a search hit names the shop ("search hit"). Verify before relying on it.'],['Source','sources column lists up to two URLs.']]
    sheets.append(('Legende', ['Begriff','Bedeutung'], leg, [24,110], None))
    ct = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
          + ''.join(f'<Override PartName="/xl/worksheets/sheet{i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in range(len(sheets))) + '</Types>')
    wb = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
          + ''.join(f'<sheet name="{escape(s[0])}" sheetId="{i+1}" r:id="rId{i+1}"/>' for i, s in enumerate(sheets)) + '</sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ''.join(f'<Relationship Id="rId{i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{i+1}.xml"/>' for i in range(len(sheets)))
            + f'<Relationship Id="rId{len(sheets)+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    with zipfile.ZipFile(os.path.join(here, 'prospects.xlsx'), 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', ct)
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', wb); z.writestr('xl/_rels/workbook.xml.rels', rels); z.writestr('xl/styles.xml', STYLES)
        for i, (name, header, body, widths, pri) in enumerate(sheets): z.writestr(f'xl/worksheets/sheet{i+1}.xml', sheet_xml(header, body, widths, pri))

def write_route():
    L = ['# Field routes: first 60 Kassel prospects', '',
         f'Retrieved {D.RETRIEVED} from public sources. **Nothing was contacted.** Hours and shop status can change, so look at the door before you go in. Full data: [prospects.xlsx](prospects.xlsx) / [prospects.csv](prospects.csv).', '',
         '**Reading the route:** the order is by walking sequence within a day, not by priority. Priority (A/B/C) is in each row. Data confidence C means "confirm on the door".', '']
    for key, title in (('FIRST', 'FIRST 20: highest-priority route'), ('NEXT', 'NEXT 20'), ('FINAL', 'FINAL 20')):
        L += [f'## {title}', '']
        days = []
        for r in rows:
            if r['route'] == key and r['day'] not in days: days.append(r['day'])
        for d in days:
            sub = [r for r in rows if r['route'] == key and r['day'] == d]
            L += [f'### Day {d}', '', '| # | Shop | Type | Address | Opening hours (verify) | Best time | Angle | Prio |', '|---|---|---|---|---|---|---|---|']
            for r in sub:
                L.append(f"| {r['order']} | **{r['name']}** | {r['category']} | {r['street']}, {r['plz']} | {r['hours']} | {r['best_walkin']} | {r['angle']} | {r['pri']}{r['conf']} |")
            L.append('')
    L += ['## Why 22 barbers and 38 pizzerias/Imbiss, not 30 and 30', '',
          'Kassel has about 22 independent barber-focused shops that could be confirmed in at least one public source. Many other "barbers" in directories are unisex or women\'s salons, or have no usable public data. Pizzerias and Imbiss are far more numerous, so the list takes the 8 extra from there. The brief allowed this redistribution; the vertical order is unchanged (barbers first, pizzeria/Imbiss second).', '',
          'Excluded on purpose: chains (Domino\'s, Pizza Hut, L\'Osteria), delivery-only "Pizzaservice" listings, shops whose status looked unclear (one listed as permanently closed, one as "opening soon"), and listings with conflicting addresses that could not be reconciled.', '',
          '## Verification limits', '',
          '- **Paper stamp cards cannot be seen online.** "None found online" does not mean none exists. Look at the counter.',
          '- **Hours** come from directories and, for 7 shops, from their own site. Several shops show conflicting hours across sources (marked in the note).',
          '- **Instagram handles** are included only where the shop\'s own site links them or a search result names the shop.',
          '- **Phones:** landline or business-published numbers only.', '']
    open(os.path.join(here, 'route.md'), 'w', encoding='utf-8').write('\n'.join(L))

if __name__ == '__main__':
    write_csv(); write_xlsx(); write_route()
    print(len(rows), 'rows ·', sum(r['kind'] == 'barber' for r in rows), 'barbers ·', sum(r['kind'] != 'barber' for r in rows), 'pizzeria/Imbiss')
