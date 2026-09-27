import {industries,offers,periodCost,euro,type IndustryKey,type OfferKey} from './config.js';
import {initialDemo,transition,balance,canAdvance,type DemoAction} from './demo.js';
import {demoScreens,escapeText} from './views.js';
import {parseMoney,calculate} from './economics.js';
const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const input=(id:string)=>$(id) as HTMLInputElement;
let industry=(document.body.dataset.industry||'cafe') as IndustryKey;
let state=initialDemo();
const storyState={return:0,referral:0};
const say=(message:string)=>{$('demo-announcement').textContent=message;};
function changeView(next:string){$('demo-screens').dataset.view=next;document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===next)));}
function renderDemo(){
 const x=industries[industry],n=balance(state);
 const titles=['Dein Geschäft legt die Prämie fest.','Der Kunde öffnet seine Karte.','Bezahlt wird wie bisher.','Dein Team bestätigt den Einkauf.','Fortschritt und Aktivität sind sichtbar.'];
 const descriptions=[`Die Prämie: ${x.reward}. Dafür braucht es 8 Stempel. Dein Team kennt die Regel; deine Kunden sehen ihren Fortschritt.`, 'Im Geschäft öffnet der Anmelde-QR die Teilnahme. Nach dem Beitritt startet die Browserkarte bei null.', 'Der Kunde bezahlt an deiner bestehenden Kasse. Loynara erhält keine automatische Zahlungsbestätigung.', 'Das Team scannt den Kunden-QR, prüft den Einkauf und bestätigt ausdrücklich einen Stempel.', 'Karte und Inhaberansicht beziehen sich auf dieselben Bestätigungen. Schau dir beide Perspektiven an.'];
 $('step-counter').textContent=`SCHRITT ${state.step+1} VON 5`;$('step-title').textContent=titles[state.step];$('step-description').textContent=descriptions[state.step];
 document.querySelectorAll('.step-track li').forEach((li,i)=>{if(i===state.step)li.setAttribute('aria-current','step');else li.removeAttribute('aria-current');});
 $('demo-screens').innerHTML=demoScreens(state,industry,input('business-name').value.trim());
 $('demo-screens').classList.remove('changed');requestAnimationFrame(()=>$('demo-screens').classList.add('changed'));
 const next=$<HTMLButtonElement>('demo-next');next.disabled=!canAdvance(state);next.textContent=state.step===0?'Start →':state.step===4?'Rundgang abgeschlossen':'Weiter →';$<HTMLButtonElement>('demo-back').disabled=state.step===0;
 $('step-hint').textContent=state.step===1&&!state.enrolled?'Öffne zuerst die Beispielkarte in der Kundensicht.':state.step===3&&!state.confirmed?'Identifiziere die Karte und bestätige +1 in der Kassensicht.':state.step===4?'Du kannst die Perspektive wechseln oder spätere Besuche ansehen.':'Du entscheidest, wann es weitergeht.';
 const later=$('later-visits');later.hidden=state.step!==4;
 later.innerHTML=state.redeemed?'<p><strong>Prämie bestätigt eingelöst.</strong> 8 bestätigte Besuche, 1 Einlösung, 0 Stempel übrig. Die Inhaberansicht zeigt dieselbe Geschichte.</p>':state.later===7?'<p><strong>8 von 8 Stempeln.</strong> Nach dem achten bestätigten Besuch ist die Prämie verfügbar. Eine Einlösung braucht wieder die Bestätigung des Teams.</p><button class="button ink" data-action="redeem">Prämie einlösen bestätigen</button>':state.later===6?'<p><strong>Zeitsprung: sechs weitere, jeweils bestätigte Besuche.</strong> Der Stand ist jetzt 7/8. Jetzt kommt der achte Besuch – bestätige ihn selbst.</p><button class="button ink" data-action="last">Besuch 8: +1 Stempel bestätigen</button>':'<p><strong>Was passiert beim nächsten Besuch?</strong> Springe ausdrücklich zu sechs weiteren bestätigten Besuchen. Das ist ein Zeitraffer, kein zusätzlicher Effekt dieses einen Einkaufs.</p><button class="button secondary" data-action="jump">Zeitsprung: 6 weitere Besuche →</button>';
 say(`Schritt ${state.step+1}: ${titles[state.step]} Kartenstand ${n} von 8 Stempeln.`);
}
function resetDemo(){state=initialDemo();changeView('customer');renderDemo();storyState.return=0;storyState.referral=0;renderStories();}
$('demo-next').addEventListener('click',()=>{state=transition(state,'next');changeView(state.step===2||state.step===3?'cashier':'customer');renderDemo();});
$('demo-back').addEventListener('click',()=>{state=transition(state,'back');changeView(state.step===2||state.step===3?'cashier':'customer');renderDemo();});
$('reset-demo').addEventListener('click',()=>{resetDemo();$('demo-next').focus();});
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(b=>b.addEventListener('click',()=>changeView(b.dataset.view!)));
document.querySelector('.demo-shell')!.addEventListener('click',e=>{
 const button=(e.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');if(!button)return;
 const action=button.dataset.action as DemoAction;state=transition(state,action);renderDemo();
 const target=action==='identify'?'[data-action="award"]':action==='jump'?'[data-action="last"]':action==='last'?'[data-action="redeem"]':action==='redeem'?'#reset-demo':'#demo-next';
 document.querySelector<HTMLElement>(target)?.focus({preventScroll:true});
});
function updateIndustry(){
 const x=industries[industry];
 $('industry-intro').textContent=x.introduction;$('industry-visit').textContent=x.visit;$('industry-reward').textContent=x.reward;
 input('business-name').placeholder=x.name;
 document.querySelectorAll('[data-business]').forEach(el=>el.textContent=input('business-name').value.trim()||x.name);
 document.querySelectorAll('[data-reward]').forEach(el=>el.textContent=`${x.reward} · nach 8 Stempeln`);
 document.querySelectorAll<HTMLButtonElement>('[data-industry-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.industryChoice===industry||(b.dataset.industryChoice==='barber'&&industry==='friseur')||(b.dataset.industryChoice==='fitness'&&industry==='wellness'))));
 const variants:IndustryKey[]=industry==='barber'||industry==='friseur'?['barber','friseur']:industry==='fitness'||industry==='wellness'?['fitness','wellness']:[];
 $('industry-variant').classList.toggle('visible',variants.length>0);
 $('variant').innerHTML=(variants.length?variants:[industry]).map(k=>`<option value="${k}" ${k===industry?'selected':''}>${industries[k].label}</option>`).join('');
 $('return-industry').textContent=x.offer;$('referral-industry').textContent=x.referral;
 document.querySelector('.hero-card')!.classList.remove('changed');requestAnimationFrame(()=>document.querySelector('.hero-card')!.classList.add('changed'));
 resetDemo();say(`${x.label} ausgewählt. Demo neu gestartet. Deine Rechenwerte bleiben unverändert.`);
}
document.querySelectorAll<HTMLButtonElement>('[data-industry-choice]').forEach(b=>b.addEventListener('click',()=>{industry=b.dataset.industryChoice as IndustryKey;updateIndustry();}));
$('variant').addEventListener('change',()=>{industry=($('variant') as HTMLSelectElement).value as IndustryKey;updateIndustry();});
input('business-name').addEventListener('input',()=>{document.querySelectorAll('[data-business]').forEach(el=>el.textContent=input('business-name').value.trim()||industries[industry].name);renderDemo();});
function renderStories(){
 const x=industries[industry];
 const stories={
 return:[['01 / ERFASSTE AKTIVITÄT','Ein Anlass, genauer hinzusehen.',`${x.interval}. Eine ruhige Karte allein sagt nichts über die Gründe aus.`,'Zielgruppe ansehen →'],['02 / PASSENDE ZIELGRUPPE','Eine Karte passt zur Auswahl.','Beispielkarte A-01 passt zum selbst gewählten Zeitraum. Versandberechtigt nur mit verifiziertem Kontakt und passender, nicht widerrufener Einwilligung.','Angebot vorbereiten →'],['03 / ENTWURF DES GESCHÄFTS','Du bestimmst Anlass und Inhalt.',`${x.offer} Das Geschäft prüft Zielgruppe, Kosten und Konditionen vor einer Freigabe.`,'Nachrichtenvorschau →'],['04 / NACHRICHTENVORSCHAU','Eine Einladung, kein Automatismus.',`„Wir freuen uns auf deinen nächsten Besuch bei ${input('business-name').value.trim()||x.name}. Frage uns nach unserem aktuellen Angebot.“ Versand in dieser Demo simuliert. Kein Empfänger wird kontaktiert.`,'Illustratives Wiederkommen →'],['05 / REINES BEISPIEL','Beispiel: Kunde kommt später zurück.','Das Team bestätigt einen neuen Besuch. Ob die Nachricht dafür ursächlich war, wissen wir nicht. Das ist kein gemessener Kampagnenerfolg.','Beispiel abgeschlossen']],
 referral:[['01 / EINLADUNG','Eine persönliche Empfehlung.','Beispielregel: Karte R-01 erhält 1 Bonusstempel, sobald die neue Karte R-02 ihren ersten qualifizierenden Einkauf bestätigt bekommt.','Einladung öffnen →'],['02 / LINK GEÖFFNET','Noch keine Belohnung.','Eine Einladung wurde geöffnet. Karte R-01: 0 Bonusstempel. Ein Linkaufruf ist kein Einkauf.','Empfohlene Karte anmelden →'],['03 / NEUE KARTE','Zuordnung gespeichert, Bonus wartet.','Beispielkarte R-02 ist R-01 zugeordnet. R-02: 0 Stempel. R-01: 0 Bonusstempel. Erst ein qualifizierender Einkauf zählt.','Qualifizierenden Einkauf bestätigen →'],['04 / EINKAUF BESTÄTIGT','Jetzt zählt die Empfehlung.','Das Team hat den ersten qualifizierenden Einkauf von R-02 bestätigt: +1 regulärer Stempel für R-02, einmalig +1 Bonusstempel für R-01. Erneutes Öffnen gibt keinen weiteren Bonus.','Beispiel abgeschlossen']],
 };
 for(const key of ['return','referral'] as const){const idx=storyState[key],s=stories[key][idx];$(`${key}-flow`).innerHTML=`<span>${s[0]}</span><h3>${s[1]}</h3><p>${escapeText(s[2])}</p>`;const next=document.querySelector<HTMLButtonElement>(`[data-story-next="${key}"]`)!;next.textContent=s[3];next.disabled=idx===stories[key].length-1;document.querySelector<HTMLButtonElement>(`[data-story-back="${key}"]`)!.disabled=idx===0;}
}
for(const direction of ['next','back','reset'] as const) document.querySelectorAll<HTMLButtonElement>(`[data-story-${direction}]`).forEach(b=>b.addEventListener('click',()=>{const key=b.dataset[`story${direction[0].toUpperCase()+direction.slice(1)}`] as 'return'|'referral';storyState[key]=direction==='reset'?0:Math.max(0,Math.min(key==='return'?4:3,storyState[key]+(direction==='next'?1:-1)));renderStories();if(b.disabled)document.querySelector<HTMLButtonElement>(`[data-story-reset="${key}"]`)!.focus({preventScroll:true});}));
let examples=false;
function recalculate(){
 const offer=($('offer') as HTMLSelectElement).value as OfferKey,period=($('period') as HTMLSelectElement).value as 'first'|'recurring';const fee=periodCost(offer,period);
 $('fee').textContent=euro(fee);$('period-label').textContent=period==='first'?'Erster Monat inklusive Einrichtung':'Monatliche Softwaregebühr';
 $('assumption-label').textContent=examples?'Beispielannahmen geladen. Änderungen sind deine Annahmen, keine Prognose. Alle Werte bleiben auf dieser Seite.':'Deine Eingaben bleiben auf dieser Seite und werden nicht übertragen.';
 $('calc-error').textContent='';for(const id of ['contribution','rewards','effort','revenue','visits'])input(id).removeAttribute('aria-invalid');
 try{
  const read=(id:string)=>{try{return parseMoney(input(id).value);}catch(e){input(id).setAttribute('aria-invalid','true');throw e;}};
  const m=read('contribution'),b=read('rewards'),h=read('effort'),r=read('revenue'),rawN=input('visits').value.trim();
  for(const [id,v] of [['rewards',b],['effort',h],['revenue',r]] as const)if(v!==null&&v<0){input(id).setAttribute('aria-invalid','true');throw new Error('Prämienkosten, Betriebsaufwand und Umsatz dürfen nicht negativ sein.');}
  let n:number|null=null;if(rawN){if(!/^\d+$/.test(rawN)||Number(rawN)>100000){input('visits').setAttribute('aria-invalid','true');throw new Error('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.');}n=Number(rawN);}
  const result=calculate(fee,m,b,h,n,r);
  $('required').textContent=result.required===null?'–':new Intl.NumberFormat('de-DE').format(result.required);
  $('required').classList.toggle('compact-number',String(result.required??'').length>5);
  $('required-label').textContent=result.required===1?'zusätzlicher Besuch':'zusätzliche Besuche';
  $('result-explanation').textContent=m===null?'Trage deinen geschätzten Beitrag je zusätzlichem Besuch ein.':m<=0?'Kein endlicher Kostenausgleich: Wenn je zusätzlichem Besuch nichts oder weniger als null übrig bleibt, decken weitere Besuche die Fixkosten nicht.':`${result.complete?'Mit allen angegebenen Kosten':'Untergrenze mit den bisher angegebenen Kosten'}: ${euro(result.cost)} ÷ ${euro(m)}, auf ganze Besuche aufgerundet.`;
  let caveat=result.complete?'Berücksichtigt die gewählten Software-/Einrichtungskosten und die von dir angegebenen zusätzlichen Prämien- und Betriebskosten.':b===null&&h===null?(period==='first'?'Deckt zunächst nur Einrichtung und ersten Monat. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.':'Deckt zunächst nur die monatliche Softwaregebühr. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.'):'Unvollständige Kostenannahme: Ein leeres Kostenfeld ist unbekannt, nicht bestätigte 0 €. Das Ergebnis ist eine Untergrenze.';
  if(offers[offer].draft)caveat='Privater Paketentwurf, nicht freigegeben. '+caveat;
  $('cost-caveat').textContent=caveat;
  $('scenario').hidden=n===null;
  $('scenario-revenue').textContent=result.revenue===null?'Umsatz fehlt':euro(result.revenue);
  $('scenario-change').textContent=result.change===null?'Angaben fehlen':euro(result.change);
  $('scenario-change').classList.toggle('negative',result.change!==null&&result.change<0);
 }catch(e){$('calc-error').textContent=e instanceof Error?e.message:'Bitte die Eingaben prüfen.';$('required').textContent='–';$('result-explanation').textContent='Bitte die markierten Eingaben prüfen.';$('scenario').hidden=true;$('cost-caveat').textContent='Es wird kein Ergebnis aus ungültigen Eingaben angezeigt.';}
}
$('calculator').addEventListener('submit',e=>e.preventDefault());
$('calculator').addEventListener('input',recalculate);$('calculator').addEventListener('change',recalculate);
$('calculator').addEventListener('reset',()=>{examples=false;requestAnimationFrame(recalculate);});
$('load-example').addEventListener('click',()=>{examples=true;for(const [id,v] of Object.entries({contribution:'8',rewards:'20',effort:'10',revenue:'18',visits:'10'}))input(id).value=v;$<HTMLDetailsElement>('calc-details').open=true;recalculate();});
$('use-draft').addEventListener('click',()=>{($('offer') as HTMLSelectElement).value='introDraft';($('period') as HTMLSelectElement).value='first';recalculate();$('rechner').scrollIntoView();$('offer').focus({preventScroll:true});});
const features={
 programme:{src:'programme.webp',alt:'Echte Programmverwaltung mit synthetischen Prämien',caption:'Programmverwaltung · echte Anwendung mit Beispieldaten',status:'Im geschützten Pilot',detail:'Regeln, Markenauftritt und eine geordnete Auswahl an Prämien werden gespeichert. Guthaben bleibt im definierten Programm und Standort.'},
 activity:{src:'merchant-dashboard.webp',alt:'Echte Inhaberübersicht mit synthetischen Buchungen',caption:'Aktivitätsübersicht · echte Anwendung mit Beispieldaten',status:'Im geschützten Pilot',detail:'Pseudonyme Karten und Buchungen machen erfasste Aktivität sichtbar. Berichte zeigen Datenfenster und Zählregeln. Erfasste Käufe allein beweisen keinen zusätzlichen Umsatz.'},
 offers:{src:'campaign.webp',alt:'Echter Kampagnenentwurf mit synthetischer Zielgruppe',caption:'Kampagnenentwurf · echte Anwendung mit Beispieldaten',status:'Vorbereitung lokal geprüft · externer Versand in Vorbereitung',detail:'Zielgruppen, Entwürfe, Planung und Einwilligungsprüfung sind lokal getestet. Nachrichten wurden nur lokal aufgefangen. Empfehlungen belohnen erst ein konfiguriertes, bestätigtes Ereignis.'},
};
document.querySelectorAll<HTMLButtonElement>('[data-feature]').forEach(b=>b.addEventListener('click',()=>{const f=features[b.dataset.feature as keyof typeof features];document.querySelectorAll<HTMLButtonElement>('[data-feature]').forEach(v=>v.setAttribute('aria-pressed',String(v===b)));const img=$<HTMLImageElement>('feature-image');img.src=`/assets/${f.src}`;img.alt=f.alt;$('feature-caption').textContent=f.caption;$('feature-detail').innerHTML=`<strong>${f.status}</strong><p>${f.detail}</p>`;}));
$('contact-draft').addEventListener('submit',e=>e.preventDefault());
$('download-brief').addEventListener('click',()=>{const business=input('contact-business').value.trim()||input('business-name').value.trim()||industries[industry].name;const content=`Loynara – Gesprächsnotiz (lokal erstellt, nicht gesendet)\n\nGeschäft: ${business}\nBereich: ${industries[industry].label}\nKontakt (optional): ${input('contact-email').value.trim()}\n\nMeine Fragen:\n${($('contact-question') as HTMLTextAreaElement).value}\n\nPreisvorschläge und Vertragsbedingungen vor einer Bestellung abstimmen.\n`;const url=URL.createObjectURL(new Blob([content],{type:'text/plain;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='loynara-gespraechsnotiz.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('brief-status').textContent='Notiz lokal heruntergeladen. Keine Anfrage versendet.';});
// No cookies, persistence, analytics or outbound requests. All interactive state is page-local.
document.querySelectorAll<HTMLButtonElement>('button:disabled').forEach(b=>{if(!b.matches('[type=submit]'))b.disabled=false;});
updateIndustry();recalculate();
