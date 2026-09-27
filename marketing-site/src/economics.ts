import { text, type Locale } from './i18n.js';

const MAX_CENTS=100_000_000;

export function normalizeDigits(raw:string):string {
 return raw.replace(/[٠-٩۰-۹]/g,digit=>{
  const code=digit.charCodeAt(0);
  return String(code-(code>=0x06f0?0x06f0:0x0660));
 });
}

export function parseMoney(raw:string,locale:Locale='de'):number|null {
 let v=normalizeDigits(raw).trim(); if(!v) return null;
 const precisionError=()=>new Error(text('Bitte einen Betrag mit höchstens zwei Nachkommastellen eingeben.','Enter an amount with no more than two decimal places.','أدخل مبلغًا لا يزيد عن منزلتين عشريتين.',locale));
 if(/[٫٬]/.test(v)) {
  if(!/^-?(?:\d+|\d{1,3}(?:٬\d{3})+)(?:٫\d{1,2})?$/.test(v)) throw precisionError();
  v=v.replaceAll('٬','').replace('٫','.');
 } else if(locale==='de'&&v.includes(',')) {
  if(!/^-?(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d{1,2})?$/.test(v)) throw precisionError();
  v=v.replaceAll('.','').replace(',','.');
 } else if(locale!=='de'&&v.includes(',')) {
  if(!/^-?\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(v)) throw precisionError();
  v=v.replaceAll(',','');
 } else if(!/^-?\d+(?:\.\d{1,2})?$/.test(v)) {
  throw new Error(text('Bitte einen Betrag eingeben, zum Beispiel 8,50.','Enter an amount, for example 8.50.','أدخل مبلغًا، مثل 8.50.',locale));
 }
 const cents=Math.round(Number(v)*100);
 if(!Number.isSafeInteger(cents)||Math.abs(cents)>MAX_CENTS) throw new Error(text('Bitte höchstens 1.000.000 € eingeben.','Enter no more than €1,000,000.','أدخل مبلغًا لا يتجاوز 1,000,000 يورو.',locale));
 return cents;
}
export function calculate(f:number,m:number|null,b:number|null,h:number|null,n:number|null,r:number|null,locale:Locale='de') {
 for(const cost of [f,b,h,r]) if(cost!==null&&(!Number.isSafeInteger(cost)||cost<0||cost>MAX_CENTS)) throw new Error(text('Kosten und Umsatz dürfen nicht negativ sein.','Costs and revenue must not be negative.','يجب ألا تكون التكاليف والإيرادات سالبة.',locale));
 if(m!==null&&(!Number.isSafeInteger(m)||Math.abs(m)>MAX_CENTS)) throw new Error(text('Ungültiger Besuchsbeitrag.','Enter a valid contribution per visit.','أدخل مساهمة صالحة لكل زيارة.',locale));
 if(n!==null&&(!Number.isSafeInteger(n)||n<0||n>100000)) throw new Error(text('Bitte 0 bis 100.000 ganze zusätzliche Besuche eingeben.','Enter a whole number of additional visits between 0 and 100,000.','أدخل عددًا صحيحًا للزيارات الإضافية بين 0 و100,000.',locale));
 const complete=b!==null&&h!==null, cost=f+(b??0)+(h??0);
 return {complete,cost,required:m!==null&&m>0?Math.ceil(cost/m):null,change:complete&&m!==null&&n!==null?n*m-cost:null,revenue:n!==null&&r!==null?n*r:null};
}
export function trafficScenario(customersPerDay:number,basketCents:number,openDays:number,assumedUpliftPercent:number,monthlyFeeCents:number,locale:Locale='de'){
 if(!Number.isInteger(customersPerDay)||customersPerDay<0||customersPerDay>500||!Number.isSafeInteger(basketCents)||basketCents<0||basketCents>50_000||!Number.isInteger(openDays)||openDays<1||openDays>31||!Number.isInteger(assumedUpliftPercent)||assumedUpliftPercent<0||assumedUpliftPercent>100||!Number.isSafeInteger(monthlyFeeCents)||monthlyFeeCents<=0)throw new Error(text('Bitte gültige Werte für Kunden, Bon, Öffnungstage und Annahme eingeben.','Enter valid values for customers, average spend, opening days and assumed increase.','أدخل قيمًا صالحة لعدد العملاء ومتوسط الإنفاق وأيام العمل والزيادة المفترضة.',locale));
 const monthlyRevenue=Math.round(customersPerDay*basketCents*openDays*assumedUpliftPercent/100);
 const revenueLessFee=monthlyRevenue-monthlyFeeCents;
 return {monthlyRevenue,revenueLessFee,revenueToFee:Math.round(monthlyRevenue/monthlyFeeCents),annualRevenueLessFees:revenueLessFee*12};
}
