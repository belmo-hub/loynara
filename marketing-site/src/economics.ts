const MAX_CENTS=100_000_000;
export function parseMoney(raw:string):number|null {
 let v=raw.trim(); if(!v) return null;
 if(v.includes(',')) { if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(v)) throw new Error('Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.'); v=v.replaceAll('.','').replace(',','.'); }
 else if(!/^-?\d+(?:\.\d{1,2})?$/.test(v)) throw new Error('Bitte einen Betrag eingeben, zum Beispiel 8,50.');
 const cents=Math.round(Number(v)*100); if(!Number.isSafeInteger(cents)||Math.abs(cents)>MAX_CENTS) throw new Error('Bitte höchstens 1.000.000 € eingeben.'); return cents;
}
export function calculate(f:number,m:number|null,b:number|null,h:number|null,n:number|null,r:number|null) {
 for(const cost of [f,b,h,r]) if(cost!==null&&(!Number.isSafeInteger(cost)||cost<0||cost>MAX_CENTS)) throw new Error('Kosten und Umsatz dürfen nicht negativ sein.');
 if(m!==null&&(!Number.isSafeInteger(m)||Math.abs(m)>MAX_CENTS)) throw new Error('Ungültiger Besuchsbeitrag.');
 if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>100000)) throw new Error('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.');
 const complete=b!==null&&h!==null, cost=f+(b??0)+(h??0);
 return {complete,cost,required:m!==null&&m>0?Math.ceil(cost/m):null,change:complete&&m!==null&&n!==null?n*m-cost:null,revenue:n!==null&&r!==null?n*r:null};
}
export function trafficScenario(customersPerDay:number,basketCents:number,openDays:number,assumedUpliftPercent:number,monthlyFeeCents:number){
 if(!Number.isInteger(customersPerDay)||customersPerDay<0||customersPerDay>500||!Number.isSafeInteger(basketCents)||basketCents<0||basketCents>50_000||!Number.isInteger(openDays)||openDays<1||openDays>31||!Number.isInteger(assumedUpliftPercent)||assumedUpliftPercent<0||assumedUpliftPercent>100||!Number.isSafeInteger(monthlyFeeCents)||monthlyFeeCents<=0)throw new Error('Bitte gültige Werte für Kunden, Bon, Öffnungstage und Annahme eingeben.');
 const monthlyRevenue=Math.round(customersPerDay*basketCents*openDays*assumedUpliftPercent/100);
 const revenueLessFee=monthlyRevenue-monthlyFeeCents;
 return {monthlyRevenue,revenueLessFee,revenueToFee:Math.round(monthlyRevenue/monthlyFeeCents),annualRevenueLessFees:revenueLessFee*12};
}
