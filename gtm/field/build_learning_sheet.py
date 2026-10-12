"""Builds learning-sheet-template.csv and learning-sheet.xlsx (Gespräche + Codes, with dropdowns). Stdlib only."""
import csv, os, zipfile
from xml.sax.saxutils import escape
here = os.path.dirname(os.path.abspath(__file__))
COLS = [('date','Datum',12,None),('merchant_id','Merchant-ID (K-…)',11,None),('led_angle','Geführter Winkel (Canonical-ID)',16,'angles'),('real_conversation','Echtes Gespräch (>1 Min)?',12,'yn'),
        ('demo','Demo gezeigt?',10,'yn'),('strongest_reaction','Stärkste Reaktion (wörtlich)',34,None),('top_objection','Top-Einwand (Code)',16,'objections'),('current_loyalty_method','Aktuelle Kundenbindung',18,'methods'),
        ('price_reaction','Reaktion auf 49 €',24,'price'),('feature_requested','Gewünschte Funktion (wörtlich)',28,None),('outcome','Ergebnis',10,'outcome'),('reason','Grund',30,None),
        ('follow_up_permission','Erlaubnis Rückmeldung',16,'perm'),('next_action','Nächste Aktion',28,None),('next_action_date','Wann',11,None)]
LISTS = {
 'yn': ['ja','nein'],
 'outcome': ['ja','vielleicht','nein'],
 'price': ['ok','zu teuer','will rechnen','keine Reaktion','nicht besprochen'],
 'methods': ['Papierkarte','digitale Karte','mündlich/Rabatt','nichts','unbekannt'],
 'perm': ['Besuch','WhatsApp','E-Mail','Anruf','er meldet sich','keine'],
 'objections': ['PAPER','APP','STAFF','TIME-COUNTER','REGULARS','INSTAGRAM','PRICE','MISTAKE','LOST','NFC','THINK','LIEFERANDO','POS','MESSAGES','WALLET-NFC','LOGO','DATA','LOCKIN','COMPETITOR','CHAIN','PAY-NOW','keiner'],
 'angles': ['CORE-01','CORE-02','CORE-03','CORE-04','CORE-05','CORE-06','CORE-07','CORE-08','CORE-09','CORE-10','CORE-11','ACQ-05','OPS-05','RET-03','VER-01','VER-02','VER-04'],
}
def write_csv():
    with open(os.path.join(here,'learning-sheet-template.csv'),'w',newline='',encoding='utf-8') as f:
        csv.writer(f).writerow([k for k,_,_,_ in COLS])
def colname(i): return chr(65+i)
def write_xlsx():
    cell=lambda ref,v,s=0:f'<c r="{ref}" t="inlineStr" s="{s}"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'
    n_rows=200
    head='<row r="1" ht="34" customHeight="1">'+''.join(cell(f'{colname(i)}1',h,1) for i,(_,h,_,_) in enumerate(COLS))+'</row>'
    cols=''.join(f'<col min="{i+1}" max="{i+1}" width="{w}" customWidth="1"/>' for i,(_,_,w,_) in enumerate(COLS))
    # lists live on sheet 2 (Codes), one column per list
    names=list(LISTS)
    dv=''.join(f'<dataValidation type="list" allowBlank="1" showErrorMessage="0" sqref="{colname(i)}2:{colname(i)}{n_rows}"><formula1>Codes!${colname(names.index(l))}$2:${colname(names.index(l))}${len(LISTS[l])+1}</formula1></dataValidation>' for i,(_,_,_,l) in enumerate(COLS) if l)
    cnt=sum(1 for c in COLS if c[3])
    s1=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        f'<cols>{cols}</cols><sheetData>{head}</sheetData><autoFilter ref="A1:{colname(len(COLS)-1)}{n_rows}"/><dataValidations count="{cnt}">{dv}</dataValidations></worksheet>')
    rows=['<row r="1">'+''.join(cell(f'{colname(i)}1',n,1) for i,n in enumerate(names))+'</row>']
    for r in range(max(len(v) for v in LISTS.values())):
        rows.append(f'<row r="{r+2}">'+''.join(cell(f'{colname(i)}{r+2}',LISTS[n][r]) for i,n in enumerate(names) if r<len(LISTS[n]))+'</row>')
    s2=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<cols><col min="1" max="{len(names)}" width="18" customWidth="1"/></cols><sheetData>{"".join(rows)}</sheetData></worksheet>')
    styles=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="10"/><name val="Calibri"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>'
     '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF245D47"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
     '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf xfId="0" fontId="0" fillId="0" borderId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>'
     '<xf xfId="0" fontId="1" fillId="2" borderId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs></styleSheet>')
    ct=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
    wb=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Gespräche" sheetId="1" r:id="rId1"/><sheet name="Codes" sheetId="2" r:id="rId2"/></sheets></workbook>')
    rels=('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    with zipfile.ZipFile(os.path.join(here,'learning-sheet.xlsx'),'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml',ct); z.writestr('_rels/.rels','<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/workbook.xml',wb); z.writestr('xl/_rels/workbook.xml.rels',rels); z.writestr('xl/styles.xml',styles); z.writestr('xl/worksheets/sheet1.xml',s1); z.writestr('xl/worksheets/sheet2.xml',s2)
if __name__=='__main__': write_csv(); write_xlsx(); print('learning sheet built')
