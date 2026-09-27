import { currentLocale, localeTag, type Locale } from './i18n.js';

export type IndustryKey = 'cafe' | 'barber' | 'friseur' | 'nagelstudio' | 'gastro' | 'autopflege' | 'fitness' | 'wellness';
export type Industry = { label: string; name: string; reward: string; visit: string; introduction: string; offer: string; referral: string; interval: string; threshold: number };
export const industries: Record<IndustryKey, Industry> = {
  cafe: { threshold: 8, label: 'Café', name: 'Café Morgenlicht', reward: 'ein Kaffee aufs Haus', visit: 'ein bestätigter Café-Besuch', introduction: 'Der Kaffee bleibt wie gewohnt. Die Vorfreude auf den nächsten kommt dazu.', offer: 'Ein Angebot für deinen ruhigeren Nachmittag vorbereiten.', referral: 'Ein Gast lädt eine Freundin auf ihren ersten Besuch ein.', interval: 'Beispiel: seit 30 Tagen kein erfasster Besuch' },
  barber: { threshold: 5, label: 'Barber', name: 'Studio Schnittwerk', reward: 'eine Bartpflege als Extra', visit: 'ein bestätigter Termin', introduction: 'Vom ersten Schnitt zum nächsten Termin. Mit einer Prämie, die zu deinem Service passt.', offer: 'Einen Hinweis auf freie Termine für länger inaktive Kunden vorbereiten.', referral: 'Ein Stammkunde empfiehlt deinen Barber weiter.', interval: 'Beispiel: seit 35 Tagen kein erfasster Termin' },
  friseur: { threshold: 6, label: 'Friseur', name: 'Salon Lichtblick', reward: 'eine Pflegebehandlung als Extra', visit: 'ein bestätigter Salontermin', introduction: 'Eine sichtbare Einladung zum Wiederkommen – auch zwischen zwei Haarschnitten.', offer: 'Eine Erinnerung für ein von dir gewähltes Terminintervall vorbereiten.', referral: 'Eine Kundin empfiehlt deinen Salon weiter.', interval: 'Beispiel: seit 60 Tagen kein erfasster Termin' },
  nagelstudio: { threshold: 5, label: 'Nägel / Beauty', name: 'Studio Feinsinn', reward: 'ein Pflege-Extra zur Behandlung', visit: 'eine bestätigte Behandlung', introduction: 'Deine Behandlung, dein Wiederbuchungsrhythmus. Die Karte zeigt den Fortschritt.', offer: 'Eine Einladung zur nächsten Behandlung im selbst gewählten Intervall vorbereiten.', referral: 'Eine Kundin lädt jemanden zum ersten Studiobesuch ein.', interval: 'Beispiel: seit 6 Wochen keine erfasste Behandlung' },
  gastro: { threshold: 8, label: 'Gastro / Takeaway', name: 'Küche um die Ecke', reward: 'eine Beilage zur Bestellung', visit: 'eine bestätigte Bestellung', introduction: 'Auch die nächste Mittagspause kann wieder bei dir stattfinden.', offer: 'Ein Angebot für einen von dir gewählten ruhigeren Wochentag vorbereiten.', referral: 'Ein Gast empfiehlt deinen Takeaway im Freundeskreis.', interval: 'Beispiel: seit 30 Tagen keine erfasste Bestellung' },
  autopflege: { threshold: 4, label: 'Autopflege', name: 'Glanzwerk', reward: 'eine zusätzliche Felgenpflege', visit: 'ein bestätigter Pflegeservice', introduction: 'Gute Pflege bleibt in Erinnerung. Deine Karte erinnert an den nächsten Fortschritt.', offer: 'Ein saisonales Pflegeangebot für passende Kunden vorbereiten.', referral: 'Ein Kunde empfiehlt deinen Betrieb für den ersten Pflegetermin.', interval: 'Beispiel: seit 90 Tagen kein erfasster Service' },
  fitness: { threshold: 5, label: 'Fitness', name: 'Studio Freiraum', reward: 'eine zusätzliche Technik-Einheit', visit: 'eine bestätigte Zusatzleistung', introduction: 'Empfehlungen und passende Zusatzangebote – ergänzend zu deiner bestehenden Mitgliedschaft.', offer: 'Ein freiwilliges Zusatzangebot für interessierte Mitglieder vorbereiten.', referral: 'Ein Mitglied empfiehlt das Studio; erst eine qualifizierende Buchung zählt.', interval: 'Beispiel: seit 60 Tagen keine erfasste Zusatzleistung' },
  wellness: { threshold: 5, label: 'Wellness', name: 'Raum für Ruhe', reward: 'ein zusätzliches Entspannungs-Extra', visit: 'eine bestätigte Buchung', introduction: 'Die nächste kleine Auszeit beginnt mit einer verständlichen Prämie.', offer: 'Eine Einladung zu einer erneuten Buchung vorbereiten, ohne medizinische Angaben zu erfassen.', referral: 'Ein Gast empfiehlt dein Angebot für eine erste Buchung.', interval: 'Beispiel: seit 60 Tagen keine erfasste Buchung' },
};
const industryTranslations: Record<'en' | 'ar', Record<IndustryKey, Omit<Industry, 'threshold'>>> = {
  en: {
    cafe: { label: 'Café', name: 'Morning Light Café', reward: 'a coffee on the house', visit: 'a confirmed café visit', introduction: 'The coffee stays just as you like it. Now there is another reason to look forward to your next visit.', offer: 'Prepare an offer for a quieter afternoon.', referral: 'A guest invites a friend for their first visit.', interval: 'Example: no recorded visit for 30 days' },
    barber: { label: 'Barber', name: 'Cutcraft Studio', reward: 'a complimentary beard treatment', visit: 'a confirmed appointment', introduction: 'From the first haircut to the next appointment, with a reward that suits your service.', offer: 'Prepare a message about available appointments for customers who have not visited in a while.', referral: 'A regular customer recommends your barbershop.', interval: 'Example: no recorded appointment for 35 days' },
    friseur: { label: 'Hair salon', name: 'Brightside Salon', reward: 'a complimentary hair treatment', visit: 'a confirmed salon appointment', introduction: 'A visible invitation to return, even between haircuts.', offer: 'Prepare a reminder for an appointment interval you choose.', referral: 'A customer recommends your salon.', interval: 'Example: no recorded appointment for 60 days' },
    nagelstudio: { label: 'Nails / Beauty', name: 'Fineline Studio', reward: 'a complimentary care extra with a treatment', visit: 'a confirmed treatment', introduction: 'Your treatments, your rebooking rhythm. The card shows each customer their progress.', offer: 'Prepare an invitation to the next treatment at an interval you choose.', referral: 'A customer invites someone for their first studio visit.', interval: 'Example: no recorded treatment for 6 weeks' },
    gastro: { label: 'Food / Takeaway', name: 'Kitchen Around the Corner', reward: 'a side dish with an order', visit: 'a confirmed order', introduction: 'Give guests a reason to spend their next lunch break with you too.', offer: 'Prepare an offer for a quieter weekday you choose.', referral: 'A guest recommends your takeaway to friends.', interval: 'Example: no recorded order for 30 days' },
    autopflege: { label: 'Car care', name: 'Shineworks', reward: 'an extra wheel care service', visit: 'a confirmed car care service', introduction: 'Good care leaves an impression. Your card shows customers the next step towards their reward.', offer: 'Prepare a seasonal car care offer for relevant customers.', referral: 'A customer recommends your business for a first car care appointment.', interval: 'Example: no recorded service for 90 days' },
    fitness: { label: 'Fitness', name: 'Open Space Studio', reward: 'an extra technique session', visit: 'a confirmed additional service', introduction: 'Referrals and relevant extras that complement your existing memberships.', offer: 'Prepare an optional extra for interested members.', referral: 'A member recommends the studio; only a qualifying booking counts.', interval: 'Example: no recorded additional service for 60 days' },
    wellness: { label: 'Wellness', name: 'Room for Calm', reward: 'an extra relaxation add-on', visit: 'a confirmed booking', introduction: 'The next little break starts with a reward that is easy to understand.', offer: 'Prepare an invitation to book again, without collecting medical information.', referral: 'A guest recommends your service for a first booking.', interval: 'Example: no recorded booking for 60 days' },
  },
  ar: {
    cafe: { label: 'مقهى', name: 'مقهى نور الصباح', reward: 'قهوة مجانية', visit: 'زيارة مؤكدة إلى المقهى', introduction: 'قهوتك كما تحبها، ومعها سبب إضافي لتترقب زيارتك القادمة.', offer: 'حضّر عرضًا لفترة بعد الظهر الأقل ازدحامًا.', referral: 'يدعو أحد الضيوف صديقًا لزيارته الأولى.', interval: 'مثال: لم تُسجّل زيارة منذ 30 يومًا' },
    barber: { label: 'حلاقة رجالية', name: 'صالون فن الحلاقة', reward: 'جلسة إضافية للعناية باللحية', visit: 'موعد مؤكد', introduction: 'من قصة الشعر الأولى إلى الموعد التالي، مع مكافأة تناسب خدمتك.', offer: 'حضّر رسالة بالمواعيد المتاحة للعملاء الذين لم يزوروا الصالون منذ فترة.', referral: 'يوصي أحد عملائك الدائمين بصالون الحلاقة لديك.', interval: 'مثال: لم يُسجّل موعد منذ 35 يومًا' },
    friseur: { label: 'صالون شعر', name: 'صالون إشراقة', reward: 'جلسة إضافية للعناية بالشعر', visit: 'موعد مؤكد في الصالون', introduction: 'دعوة واضحة للعودة، حتى بين موعدين لقص الشعر.', offer: 'حضّر تذكيرًا بموعد وفق الفترة التي تحددها.', referral: 'يوصي أحد العملاء بصالونك.', interval: 'مثال: لم يُسجّل موعد منذ 60 يومًا' },
    nagelstudio: { label: 'أظافر / تجميل', name: 'استوديو لمسة جمال', reward: 'خدمة عناية إضافية مع الجلسة', visit: 'جلسة عناية مؤكدة', introduction: 'خدماتك ومواعيد العودة التي تناسبها. تُظهر البطاقة لكل عميل مدى تقدّمه.', offer: 'حضّر دعوة إلى جلسة العناية التالية وفق الفترة التي تختارها.', referral: 'يدعو أحد العملاء شخصًا إلى زيارته الأولى للاستوديو.', interval: 'مثال: لم تُسجّل جلسة عناية منذ 6 أسابيع' },
    gastro: { label: 'مطاعم / وجبات خارجية', name: 'مطبخ الحي', reward: 'طبق جانبي مع الطلب', visit: 'طلب مؤكد', introduction: 'امنح ضيوفك سببًا لقضاء استراحة الغداء القادمة لديك أيضًا.', offer: 'حضّر عرضًا ليوم أقل ازدحامًا من أيام الأسبوع تختاره بنفسك.', referral: 'يوصي أحد الضيوف أصدقاءه بوجباتك الخارجية.', interval: 'مثال: لم يُسجّل طلب منذ 30 يومًا' },
    autopflege: { label: 'العناية بالسيارات', name: 'مركز البريق', reward: 'خدمة إضافية للعناية بالجنوط', visit: 'خدمة عناية مؤكدة بالسيارة', introduction: 'العناية الجيدة تترك أثرًا. وتُظهر بطاقتك للعملاء الخطوة التالية نحو مكافأتهم.', offer: 'حضّر عرضًا موسميًا للعناية بالسيارات للعملاء المناسبين.', referral: 'يوصي أحد العملاء بمركزك لحجز أول موعد للعناية بالسيارة.', interval: 'مثال: لم تُسجّل خدمة منذ 90 يومًا' },
    fitness: { label: 'لياقة بدنية', name: 'نادي انطلاقة', reward: 'جلسة إضافية لتحسين أداء التمارين', visit: 'خدمة إضافية مؤكدة', introduction: 'توصيات وعروض إضافية مناسبة تُكمل عضويات النادي الحالية.', offer: 'حضّر عرضًا إضافيًا اختياريًا للأعضاء المهتمين.', referral: 'يوصي أحد الأعضاء بالنادي، ولا تُحتسب التوصية إلا بعد حجز مستوفٍ للشروط.', interval: 'مثال: لم تُسجّل خدمة إضافية منذ 60 يومًا' },
    wellness: { label: 'استرخاء وعناية', name: 'واحة السكينة', reward: 'خدمة استرخاء إضافية', visit: 'حجز مؤكد', introduction: 'تبدأ استراحة الاسترخاء القادمة بمكافأة واضحة وسهلة الفهم.', offer: 'حضّر دعوة لحجز جديد دون جمع معلومات طبية.', referral: 'يوصي أحد الضيوف بخدماتك لإجراء حجز أول.', interval: 'مثال: لم يُسجّل حجز منذ 60 يومًا' },
  },
};

export function getIndustries(locale: Locale = currentLocale()): Record<IndustryKey, Industry> {
  if (locale === 'de') return industries;
  return Object.fromEntries(Object.entries(industries).map(([key, industry]) => [
    key, { ...industry, ...industryTranslations[locale][key as IndustryKey] },
  ])) as Record<IndustryKey, Industry>;
}

export const industryGroups = Object.entries(industries).map(([key, value]) => [key as IndustryKey, value.label] as const);
export const threshold = 8;
export type OfferKey = 'founding' | 'standard' | 'introDraft';
export const offers: Record<OfferKey, {label:string; monthly:number; initial:number; includedFirstMonth:boolean; draft:boolean}> = {
  founding: { label:'Gründungspartner · Preisvorschlag', monthly:4900, initial:14800, includedFirstMonth:false, draft:false },
  standard: { label:'Standard · Preisvorschlag', monthly:6900, initial:16800, includedFirstMonth:false, draft:false },
  introDraft: { label:'Privater Paketentwurf · nicht freigegeben', monthly:4900, initial:9900, includedFirstMonth:true, draft:true },
};
export function getOffers(locale: Locale = currentLocale()): typeof offers {
  if (locale === 'de') return offers;
  const labels: Record<'en' | 'ar', Record<OfferKey, string>> = {
    en: { founding: 'Founding partner · proposed price', standard: 'Standard · proposed price', introDraft: 'Private package draft · not approved' },
    ar: { founding: 'شريك التأسيس · سعر مقترح', standard: 'الباقة الأساسية · سعر مقترح', introDraft: 'مسودة باقة خاصة · غير معتمدة' },
  };
  return Object.fromEntries(Object.entries(offers).map(([key, offer]) => [
    key, { ...offer, label: labels[locale][key as OfferKey] },
  ])) as typeof offers;
}
export const setupCents = 9900;
export const euro = (cents:number, locale:Locale = currentLocale()) => new Intl.NumberFormat(localeTag(locale),{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(cents/100);
export function periodCost(key:OfferKey,period:'first'|'recurring') { return period==='first' ? offers[key].initial : offers[key].monthly; }
