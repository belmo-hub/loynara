import { text, type Locale } from './src/i18n.js';

// Selected while each static page is rendered; no translation service or browser rewrite.
const copy: Record<string, readonly [string, string]> = {
  "BEISPIELRECHNUNG · KEINE PROGNOSE": [
    "ILLUSTRATIVE CALCULATION · NOT A FORECAST",
    "حساب توضيحي · ليس توقعًا"
  ],
  "Deine Zahlen": [
    "Your numbers",
    "أرقام عملك"
  ],
  "Verschiebe die Regler oder tippe genaue Werte ein. Das Beispiel zeigt eine Rechenmethode, keinen erwarteten Loynara-Effekt.": [
    "Move the sliders or enter exact values. This example shows a calculation method, not an expected effect of Loynara.",
    "حرّك أشرطة التمرير أو أدخل قيمًا دقيقة. يوضّح المثال طريقة الحساب، ولا يتنبأ بأثر استخدام Loynara."
  ],
  "Ohne JavaScript bleiben die angezeigten Beispielwerte statisch.": [
    "Without JavaScript, the displayed example values remain static.",
    "بدون JavaScript، تبقى قيم المثال المعروضة ثابتة."
  ],
  "Kunden pro Tag anpassen": [
    "Adjust customers per day",
    "تعديل عدد العملاء يوميًا"
  ],
  "Kunden pro Tag": [
    "Customers per day",
    "العملاء يوميًا"
  ],
  "Durchschnittlichen Bon anpassen": [
    "Adjust average purchase",
    "تعديل متوسط قيمة الشراء"
  ],
  "Durchschnittlicher Bon": [
    "Average purchase",
    "متوسط قيمة الشراء"
  ],
  "Öffnungstage pro Monat": [
    "Open days per month",
    "أيام العمل شهريًا"
  ],
  "Öffnungstage anpassen": [
    "Adjust open days",
    "تعديل عدد أيام العمل"
  ],
  "Angenommene zusätzliche Besuche": [
    "Assumed additional visits",
    "الزيارات الإضافية المفترضة"
  ],
  "Angenommenen Mehrbesuch anpassen": [
    "Adjust assumed additional visits",
    "تعديل نسبة الزيارات الإضافية المفترضة"
  ],
  "Beispielrechnung: 50 Kunden/Tag, 70 € Bon, 26 Tage, 10 % angenommene zusätzliche Besuche. Frei gewählte Zahlen, keine gemessene Wirkung.": [
    "Example calculation: 50 customers/day, €70 per purchase, 26 days, 10% assumed additional visits. Freely chosen figures, not a measured effect.",
    "حساب توضيحي: 50 عميلًا يوميًا، و70 يورو لكل عملية شراء، و26 يومًا، و10٪ زيارات إضافية مفترضة. أرقام مختارة للتوضيح، وليست أثرًا مقاسًا."
  ],
  "Beispielwerte wiederherstellen": [
    "Restore example values",
    "استعادة قيم المثال"
  ],
  "Werte leeren": [
    "Clear values",
    "مسح القيم"
  ],
  "RECHENBEISPIEL": [
    "WORKED EXAMPLE",
    "مثال حسابي"
  ],
  "Zusätzlicher Monatsumsatz": [
    "Additional monthly revenue",
    "الإيرادات الشهرية الإضافية"
  ],
  "Monatliche Softwaregebühr": [
    "Monthly software fee",
    "رسوم البرنامج الشهرية"
  ],
  "Umsatz nach Abzug nur dieser Gebühr": [
    "Revenue after deducting this fee only",
    "الإيرادات بعد خصم هذه الرسوم فقط"
  ],
  "Zusätzlicher Umsatz / Softwaregebühr": [
    "Additional revenue / software fee",
    "الإيرادات الإضافية ÷ رسوم البرنامج"
  ],
  "Auf 12 gleiche Monate hochgerechnet, nach Softwaregebühren": [
    "Projected over 12 identical months, after software fees",
    "محسوبة على 12 شهرًا متماثلًا، بعد رسوم البرنامج"
  ],
  "Monatlichen Preisvorschlag wählen": [
    "Choose a proposed monthly price",
    "اختيار السعر الشهري المقترح"
  ],
  "Preisvorschlag pro Standort": [
    "Proposed price per location",
    "السعر المقترح لكل فرع"
  ],
  "Kein Gewinn und kein ROI: Material, Personal, Zahlung, Prämien und zusätzlicher Aufwand fehlen noch. Ein bestehender Kauf ist kein Zusatzumsatz. Einrichtungskosten sind hier nicht enthalten; die Kostenrechnung unten kann sie berücksichtigen.": [
    "This is neither profit nor ROI: materials, staff, payment costs, rewards and additional work are still excluded. An existing purchase is not additional revenue. Setup costs are excluded here; the cost calculator below can include them.",
    "هذا ليس ربحًا ولا عائدًا على الاستثمار: لم تُحتسب بعد تكاليف المواد والموظفين والمدفوعات والمكافآت والجهد الإضافي. عملية الشراء التي كانت ستحدث أصلًا ليست إيرادًا إضافيًا. تكاليف الإعداد غير مشمولة هنا، ويمكن احتسابها في حاسبة التكاليف أدناه."
  ],
  "Digitale Kundenbindung für dein Geschäft: Kundenkarte, klarer Kassenablauf und transparente Kosten. Interaktive Produktdemo mit Beispieldaten – ohne Anmeldung.": [
    "Digital customer loyalty for your business: loyalty cards, a clear checkout workflow and transparent costs. Interactive product demo with sample data, no sign-up needed.",
    "ولاء رقمي لعملاء نشاطك: بطاقة ولاء وخطوات واضحة عند الدفع وتكاليف شفافة. عرض تفاعلي للمنتج ببيانات تجريبية، دون تسجيل."
  ],
  "Einfach für deine Kunden. Nachvollziehbar für dein Geschäft.": [
    "Simple for your customers. Clear for your business.",
    "سهل لعملائك. واضح لنشاطك."
  ],
  "Zum Inhalt springen": [
    "Skip to content",
    "الانتقال إلى المحتوى"
  ],
  "Loynara Startseite": [
    "Loynara home",
    "الصفحة الرئيسية لـ Loynara"
  ],
  "Menü": [
    "Menu",
    "القائمة"
  ],
  "Hauptnavigation": [
    "Main navigation",
    "التنقل الرئيسي"
  ],
  "So funktioniert’s": [
    "How it works",
    "كيف يعمل"
  ],
  "Für dein Geschäft": [
    "For your business",
    "لنشاطك"
  ],
  "Lohnt es sich?": [
    "Does it add up?",
    "هل يناسبك ماليًا؟"
  ],
  "Was es kostet": [
    "What it costs",
    "التكلفة"
  ],
  "Demo ansehen": [
    "Explore the demo",
    "استكشف العرض التجريبي"
  ],
  "DEIN SYSTEM FÜR KUNDENBINDUNG": [
    "YOUR CUSTOMER LOYALTY SYSTEM",
    "نظامك لتعزيز ولاء العملاء"
  ],
  "Mach aus Kunden": [
    "Turn customers",
    "حوّل عملاءك إلى"
  ],
  "Stammkunden.": [
    "into regulars.",
    "عملاء دائمين."
  ],
  "Ein guter Besuch ist der Anfang.": [
    "A good visit is the beginning.",
    "الزيارة الجيدة هي البداية."
  ],
  "Loynara verbindet Prämien, Kundenaktivität und Empfehlungen – damit du den nächsten vorbereiten kannst.": [
    "Loynara connects rewards, customer activity and referrals, helping you prepare for the next visit.",
    "يجمع Loynara بين المكافآت ونشاط العملاء والإحالات، لتستعد للزيارة التالية."
  ],
  "Für mein Geschäft ansehen": [
    "See it for my business",
    "شاهد ما يناسب نشاطي"
  ],
  "Was müsste sich für dich rechnen? →": [
    "What would need to add up for you? →",
    "ما الذي يجعل الأرقام مجدية لك؟ ←"
  ],
  "Produkt im Aufbau · geschützter Pilot · noch kein Verkauf": [
    "Product in development · protected pilot · not yet for sale",
    "المنتج قيد التطوير · تجربة محدودة الوصول · غير مطروح للبيع بعد"
  ],
  "Interaktive Produktvorschau mit Beispieldaten": [
    "Interactive product preview with sample data",
    "معاينة تفاعلية للمنتج ببيانات تجريبية"
  ],
  "PRODUKTVORSCHAU · BEISPIELDATEN": [
    "PRODUCT PREVIEW · SAMPLE DATA",
    "معاينة المنتج · بيانات تجريبية"
  ],
  "INHABERANSICHT": [
    "OWNER VIEW",
    "واجهة المالك"
  ],
  "Ein Besuch wird sichtbar.": [
    "A visit becomes visible.",
    "تظهر الزيارة في سجلاتك."
  ],
  "Beispielkarte 001": [
    "Sample card 001",
    "بطاقة تجريبية 001"
  ],
  "Noch keine bestätigte Aktivität": [
    "No confirmed activity yet",
    "لا يوجد نشاط مؤكّد بعد"
  ],
  "Erfasste Aktivität · keine Umsatzprognose": [
    "Recorded activity · not a revenue forecast",
    "نشاط مسجّل · ليس توقعًا للإيرادات"
  ],
  "DEINE TREUEKARTE": [
    "YOUR LOYALTY CARD",
    "بطاقة الولاء الخاصة بك"
  ],
  "Illustrativer Demo-Code, keine echte Kundenkarte": [
    "Illustrative demo code, not a real customer card",
    "رمز توضيحي للعرض، وليس بطاقة عميل حقيقية"
  ],
  "Deine Karte.": [
    "Your card.",
    "بطاقتك."
  ],
  "Dein nächster Besuch.": [
    "Your next visit.",
    "زيارتك التالية."
  ],
  "Browserkarte · Demo-Code": [
    "Browser card · demo code",
    "بطاقة عبر المتصفح · رمز تجريبي"
  ],
  "KASSENSICHT": [
    "CHECKOUT VIEW",
    "واجهة فريق الدفع"
  ],
  "Du bestätigst den Besuch.": [
    "You confirm the visit.",
    "أنت تؤكّد الزيارة."
  ],
  "Bezahlen läuft über deine Kasse.": [
    "Payments go through your till.",
    "تتم المدفوعات عبر نظام الدفع لديك."
  ],
  "Vorschauschnitt": [
    "Preview stage",
    "مرحلة المعاينة"
  ],
  "Besuch bestätigen": [
    "Confirm visit",
    "تأكيد الزيارة"
  ],
  "Besuch": [
    "Visit",
    "زيارة"
  ],
  "Prämie": [
    "Reward",
    "مكافأة"
  ],
  "Aktivität": [
    "Activity",
    "نشاط"
  ],
  "Wiederkehr": [
    "Return visit",
    "زيارة متكررة"
  ],
  "Keine eigene Kunden-App": [
    "No separate customer app",
    "لا يحتاج العميل إلى تطبيق خاص"
  ],
  "Neben deiner bestehenden Kasse": [
    "Alongside your existing till",
    "يعمل إلى جانب نظام الدفع الحالي"
  ],
  "Dein Programm. Deine Marke.": [
    "Your programme. Your brand.",
    "برنامجك. علامتك التجارية."
  ],
  "DER NÄCHSTE BESUCH BEGINNT HEUTE": [
    "THE NEXT VISIT STARTS TODAY",
    "الزيارة التالية تبدأ اليوم"
  ],
  "Du hast bereits Kunden.": [
    "You already have customers.",
    "لديك عملاء بالفعل."
  ],
  "Gib dem Wiederkommen ein System.": [
    "Give return visits a system.",
    "امنح عودتهم نظامًا يدعمها."
  ],
  "Guter Service bleibt deine Stärke. Loynara verbindet die kleinen Schritte dazwischen: einen Besuch erkennen, Fortschritt zeigen, einen passenden Anlass vorbereiten.": [
    "Great service remains your strength. Loynara connects the steps in between: record a visit, show progress and prepare a relevant reason to return.",
    "تبقى الخدمة الجيدة نقطة قوتك. يربط Loynara الخطوات التي تليها: تسجيل الزيارة وإظهار التقدم وإعداد سبب مناسب للعودة."
  ],
  "IM ALLTAG OHNE SYSTEM": [
    "EVERYDAY BUSINESS WITHOUT A SYSTEM",
    "العمل اليومي دون نظام"
  ],
  "MIT LOYNARA IM PILOT": [
    "WITH LOYNARA IN THE PILOT",
    "مع Loynara في المرحلة التجريبية"
  ],
  "Der Stempel landet auf Papier.": [
    "The stamp goes on paper.",
    "يُضاف الختم إلى بطاقة ورقية."
  ],
  "Der Besuch wird in deiner Übersicht sichtbar.": [
    "The visit appears in your overview.",
    "تظهر الزيارة في لوحة المتابعة لديك."
  ],
  "Wer länger fehlt, bleibt oft unklar.": [
    "It is often unclear who has been away.",
    "قد لا تعرف من غاب عن الزيارة طويلًا."
  ],
  "Zielgruppen zeigen erfasste Besuchspausen.": [
    "Customer groups highlight gaps in recorded visits.",
    "تُظهر شرائح العملاء فترات الانقطاع بين الزيارات المسجّلة."
  ],
  "Dieselbe Aktion für alle.": [
    "The same promotion for everyone.",
    "العرض نفسه للجميع."
  ],
  "Du bereitest Angebote für passende Kunden vor.": [
    "You prepare offers for relevant customers.",
    "تُعدّ عروضًا للعملاء المناسبين."
  ],
  "Eine Empfehlung bleibt eine nette Geste.": [
    "A referral remains a kind gesture.",
    "تبقى التوصية مجرد لفتة طيبة."
  ],
  "Ein bestätigter Erstbesuch kann den Bonus auslösen.": [
    "A confirmed first visit can trigger a bonus.",
    "قد تؤدي أول زيارة مؤكّدة إلى منح المكافأة الإضافية."
  ],
  "Beispielabläufe. Angebote und Empfehlungen sind lokal geprüft; externer Versand ist in Vorbereitung.": [
    "Example workflows. Offers and referrals have been tested locally; external delivery is in preparation.",
    "خطوات توضيحية. اختُبرت العروض والإحالات محليًا؛ والإرسال الخارجي قيد الإعداد."
  ],
  "DEIN ALLTAG. DEIN BEISPIEL.": [
    "YOUR BUSINESS DAY. YOUR EXAMPLE.",
    "يوم عملك. مثالك الخاص."
  ],
  "Dein Geschäft.": [
    "Your business.",
    "نشاطك."
  ],
  "Dein Grund zum Wiederkommen.": [
    "Your reason to return.",
    "سببك للعودة."
  ],
  "Wähle deinen Bereich. Das Beispiel passt sich an – deine Rechenwerte bleiben unverändert.": [
    "Choose your sector. The example adapts while your calculator values stay the same.",
    "اختر مجال عملك. يتغير المثال بما يناسبه، وتبقى قيم الحاسبة كما هي."
  ],
  "Geschäftsart wählen": [
    "Choose business type",
    "اختيار نوع النشاط"
  ],
  "Genauer auswählen": [
    "Choose a specific example",
    "اختيار مثال أكثر تحديدًا"
  ],
  "Unverbindliches Beispiel. Regel, Prämienkosten und Besuchsintervalle legst du fest.": [
    "Non-binding example. You decide the rule, reward costs and visit intervals.",
    "مثال غير ملزم. أنت تحدد القاعدة وتكلفة المكافآت والفترات بين الزيارات."
  ],
  "DEIN PROGRAMM · UNVERBINDLICHE VORSCHAU": [
    "YOUR PROGRAMME · NON-BINDING PREVIEW",
    "برنامجك · معاينة غير ملزمة"
  ],
  "bestätigte Besuche": [
    "confirmed visits",
    "زيارات مؤكّدة"
  ],
  "Dieses Beispiel ausprobieren →": [
    "Try this example →",
    "جرّب هذا المثال ←"
  ],
  "Dein Geschäftsname": [
    "Your business name",
    "اسم نشاطك"
  ],
  "optional": [
    "optional",
    "اختياري"
  ],
  "Nur hier auf dieser Seite. Kein Konto, kein Upload, keine Speicherung.": [
    "Only here on this page. No account, upload or storage.",
    "على هذه الصفحة فقط. دون حساب أو رفع بيانات أو تخزينها."
  ],
  "AUSPROBIEREN STATT VORSTELLEN": [
    "EXPERIENCE THE WORKFLOW",
    "جرّب الخطوات بنفسك"
  ],
  "Vom ersten Besuch": [
    "From the first visit",
    "من الزيارة الأولى"
  ],
  "zum nächsten guten Grund.": [
    "to the next good reason.",
    "إلى سبب جديد للعودة."
  ],
  "Gehe einmal durch den Besuch. Du bestätigst die Buchung selbst.": [
    "Walk through a visit. You confirm the transaction yourself.",
    "جرّب خطوات زيارة واحدة. أنت تؤكّد تسجيل العملية بنفسك."
  ],
  "Produktablauf": [
    "Product workflow",
    "خطوات استخدام المنتج"
  ],
  "Programm": [
    "Programme",
    "البرنامج"
  ],
  "Kundenkarte": [
    "Customer card",
    "بطاقة العميل"
  ],
  "Bestätigung": [
    "Confirmation",
    "التأكيد"
  ],
  "Wiederkommen": [
    "Return visit",
    "العودة"
  ],
  "Empfehlung": [
    "Referral",
    "الإحالة"
  ],
  "Interaktive Produktdemo · Beispieldaten": [
    "Interactive product demo · sample data",
    "عرض تفاعلي للمنتج · بيانات تجريبية"
  ],
  "Neu starten ↺": [
    "Restart ↺",
    "البدء من جديد ↺"
  ],
  "Ablauf": [
    "Workflow",
    "الخطوات"
  ],
  "Karte": [
    "Card",
    "البطاقة"
  ],
  "Bezahlen": [
    "Pay",
    "الدفع"
  ],
  "Bestätigen": [
    "Confirm",
    "التأكيد"
  ],
  "Überblick": [
    "Overview",
    "نظرة عامة"
  ],
  "SCHRITT 1 VON 5": [
    "STEP 1 OF 5",
    "الخطوة 1 من 5"
  ],
  "Dein Geschäft legt die Prämie fest.": [
    "Your business sets the reward.",
    "نشاطك يحدد المكافأة."
  ],
  "Demoansicht": [
    "Demo view",
    "واجهة العرض التجريبي"
  ],
  "Kundensicht": [
    "Customer view",
    "واجهة العميل"
  ],
  "Kassensicht": [
    "Checkout view",
    "واجهة فريق الدفع"
  ],
  "Inhaberansicht": [
    "Owner view",
    "واجهة المالك"
  ],
  "← Zurück": [
    "← Back",
    "رجوع →"
  ],
  "Du entscheidest, wann es weitergeht.": [
    "You decide when to continue.",
    "أنت تقرر متى تتابع."
  ],
  "Start →": [
    "Start →",
    "ابدأ ←"
  ],
  "Für die interaktive Demo bitte JavaScript aktivieren. Der Ablauf: Prämie festlegen → Browserkarte öffnen → separat bezahlen → Team scannt und bestätigt → Stand und Aktivität aktualisieren sich. Die echte Aufzeichnung findest du weiter unten.": [
    "Enable JavaScript for the interactive demo. The workflow: set a reward → open a browser card → pay separately → the team scans and confirms → the balance and activity update. The real recording is further down.",
    "فعّل JavaScript لاستخدام العرض التفاعلي. الخطوات: تحديد المكافأة ← فتح البطاقة في المتصفح ← الدفع بشكل منفصل ← مسح البطاقة وتأكيدها من الفريق ← تحديث الرصيد والنشاط. تجد التسجيل الفعلي أدناه."
  ],
  "Und wenn Kunden länger nicht wiederkommen?": [
    "What if customers have not returned for a while?",
    "ماذا لو لم يعد العملاء منذ فترة؟"
  ],
  "01 / ERFASSTE AKTIVITÄT": [
    "01 / RECORDED ACTIVITY",
    "01 / النشاط المسجّل"
  ],
  "Ein Anlass, genauer hinzusehen.": [
    "A reason to take a closer look.",
    "سبب لإلقاء نظرة أقرب."
  ],
  "Zurücksetzen": [
    "Reset",
    "إعادة الضبط"
  ],
  "Zurück": [
    "Back",
    "رجوع"
  ],
  "Zielgruppe ansehen →": [
    "View customer group →",
    "عرض شريحة العملاء ←"
  ],
  "Versand in dieser Demo simuliert. Externer Versand ist in Vorbereitung. Ein späterer Besuch belegt keine Wirkung der Nachricht.": [
    "Delivery is simulated in this demo. External delivery is in preparation. A later visit does not prove that the message had an effect.",
    "الإرسال في هذا العرض مُحاكى. الإرسال الخارجي قيد الإعداد. لا تُثبت الزيارة اللاحقة أن الرسالة أحدثت أثرًا."
  ],
  "Was passiert bei einer Empfehlung?": [
    "What happens with a referral?",
    "ماذا يحدث عند الإحالة؟"
  ],
  "01 / EINLADUNG": [
    "01 / INVITATION",
    "01 / الدعوة"
  ],
  "Eine persönliche Empfehlung.": [
    "A personal referral.",
    "توصية شخصية."
  ],
  "Beispielregel: 1 Bonusstempel für den Empfehlenden nach dem ersten bestätigten Einkauf der neuen Karte.": [
    "Example rule: 1 bonus stamp for the referrer after the new card's first confirmed purchase.",
    "قاعدة توضيحية: ختم إضافي واحد لصاحب الإحالة بعد أول عملية شراء مؤكّدة للبطاقة الجديدة."
  ],
  "Einladung öffnen →": [
    "Open invitation →",
    "فتح الدعوة ←"
  ],
  "Eigenständiges Beispiel mit Karten R-01 und R-02. Öffnen allein belohnt niemanden. Bekannte Selbstempfehlungen werden abgewiesen; anonyme Identitäten sind nicht perfekt unterscheidbar.": [
    "Separate example using cards R-01 and R-02. Opening alone rewards nobody. Known self-referrals are rejected; anonymous identities cannot always be distinguished.",
    "مثال مستقل بالبطاقتين R-01 وR-02. لا يمنح مجرد الفتح مكافأة لأحد. تُرفض الإحالات الذاتية المعروفة؛ ولا يمكن دائمًا التمييز بدقة بين الهويات المجهولة."
  ],
  "DEINE ZAHLEN. KEINE ERFOLGSVERSPRECHEN.": [
    "YOUR NUMBERS. NO PROMISES OF SUCCESS.",
    "أرقامك. دون وعود بالنجاح."
  ],
  "Rechne mit deinen Zahlen.": [
    "Calculate with your numbers.",
    "احسب باستخدام أرقامك."
  ],
  "Sieh, was dahintersteckt.": [
    "See what is behind them.",
    "واعرف ما وراءها."
  ],
  "Starte mit einem frei gewählten Besuchsszenario. Prüfe danach, wie viele Besuche deine tatsächlichen Kosten decken müssten.": [
    "Start with a freely chosen visit scenario. Then check how many visits would need to cover your actual costs.",
    "ابدأ بسيناريو زيارات تختاره بنفسك. ثم تحقّق من عدد الزيارات اللازم لتغطية تكاليفك الفعلية."
  ],
  "KOSTEN PRÜFEN": [
    "CHECK YOUR COSTS",
    "تحقّق من التكاليف"
  ],
  "Wie viele zusätzliche Besuche müssten sich für dich rechnen?": [
    "How many additional visits would need to cover your costs?",
    "كم زيارة إضافية تحتاج لتغطية تكاليفك؟"
  ],
  "Der Umsatz allein zeigt keine Wirtschaftlichkeit. Rechne hier mit deinem Beitrag je Besuch, Prämienkosten und Aufwand.": [
    "Revenue alone does not show profitability. Use your contribution per visit, reward costs and operating costs here.",
    "الإيرادات وحدها لا تبيّن الجدوى المالية. احسب هنا المساهمة المتبقية من كل زيارة وتكاليف المكافآت والتشغيل."
  ],
  "Für den interaktiven Rechner bitte JavaScript aktivieren. Manuell: (Softwaregebühr + zusätzliche Prämienkosten + Betriebsaufwand) durch den Beitrag je zusätzlichem Besuch teilen und auf ganze Besuche aufrunden. Ein Beitrag von 0 oder weniger deckt die Kosten nicht.": [
    "Enable JavaScript for the interactive calculator. To calculate manually: divide (software fee + additional reward costs + operating costs) by the contribution per additional visit and round up to whole visits. A contribution of 0 or less cannot cover the costs.",
    "فعّل JavaScript لاستخدام الحاسبة التفاعلية. للحساب يدويًا: اقسم (رسوم البرنامج + تكاليف المكافآت الإضافية + تكاليف التشغيل) على المساهمة المتبقية من كل زيارة إضافية، وقرّب الناتج إلى عدد صحيح أعلى من الزيارات. مساهمة تساوي صفرًا أو أقل لا تغطي التكاليف."
  ],
  "Preisvorschlag": [
    "Proposed price",
    "السعر المقترح"
  ],
  "Zeitraum": [
    "Period",
    "الفترة"
  ],
  "Laufender Monat": [
    "Recurring month",
    "شهر اعتيادي"
  ],
  "Erster Monat inklusive Einrichtung": [
    "First month including setup",
    "الشهر الأول شاملًا الإعداد"
  ],
  "Was bleibt je zusätzlichem Besuch übrig?": [
    "What remains from each additional visit?",
    "ما الذي يتبقى من كل زيارة إضافية؟"
  ],
  "z. B. 8,00": [
    "e.g. 8.00",
    "مثلًا ٨٫٠٠"
  ],
  "Nach zusätzlichen Produkt-/Material-, Arbeits-, Zahlungs- und Prämienkosten dieses Besuchs. Diese Prämienkosten unten nicht nochmals zählen.": [
    "After the additional product/material, labour, payment and reward costs of that visit. Do not count these reward costs again below.",
    "بعد خصم التكاليف الإضافية للمنتجات أو المواد والعمل والمدفوعات والمكافآت الخاصة بهذه الزيارة. لا تحتسب تكاليف المكافآت هذه مرة أخرى أدناه."
  ],
  "Weitere Kosten und ein eigenes Szenario": [
    "Other costs and your own scenario",
    "تكاليف أخرى وسيناريو خاص بك"
  ],
  "Zusätzliche Prämienkosten auf ohnehin stattfindende Käufe / Monat": [
    "Additional reward costs on purchases that would happen anyway / month",
    "تكاليف المكافآت الإضافية لمشتريات كانت ستحدث أصلًا / شهريًا"
  ],
  "Nicht geschätzt": [
    "Not estimated",
    "لم تُقدّر"
  ],
  "Zusätzlicher monatlicher Betriebsaufwand": [
    "Additional monthly operating costs",
    "تكاليف التشغيل الشهرية الإضافية"
  ],
  "Leer heißt unbekannt. Gib ausdrücklich 0 ein, wenn du keine zusätzlichen Kosten annimmst.": [
    "Blank means unknown. Enter 0 explicitly if you assume no additional costs.",
    "الحقل الفارغ يعني أن القيمة غير معروفة. أدخل 0 صراحةً إذا كنت تفترض عدم وجود تكاليف إضافية."
  ],
  "Dein Szenario: zusätzliche Besuche / Monat": [
    "Your scenario: additional visits / month",
    "سيناريوك: زيارات إضافية / شهريًا"
  ],
  "Auch 0 ist möglich": [
    "0 is also valid",
    "يمكن إدخال 0 أيضًا"
  ],
  "Umsatz je zusätzlichem Besuch": [
    "Revenue per additional visit",
    "الإيراد من كل زيارة إضافية"
  ],
  "Nur für die Umsatzanzeige": [
    "For the revenue display only",
    "لعرض الإيرادات فقط"
  ],
  "Beispielwerte laden ↗": [
    "Load example values ↗",
    "تحميل قيم المثال ↖"
  ],
  "Deine Eingaben bleiben auf dieser Seite und werden nicht übertragen.": [
    "Your inputs stay on this page and are not transmitted.",
    "تبقى مدخلاتك على هذه الصفحة ولا تُرسل إلى أي جهة."
  ],
  "DEIN RECHENERGEBNIS": [
    "YOUR CALCULATION RESULT",
    "نتيجة حسابك"
  ],
  "zusätzliche Besuche": [
    "additional visits",
    "زيارات إضافية"
  ],
  "Trage deinen geschätzten Beitrag je zusätzlichem Besuch ein.": [
    "Enter your estimated contribution per additional visit.",
    "أدخل تقديرك للمساهمة المتبقية من كل زيارة إضافية."
  ],
  "Deckt zunächst nur die monatliche Softwaregebühr. Weitere Programm- und Betriebskosten sind noch nicht berücksichtigt.": [
    "Initially covers only the monthly software fee. Other programme and operating costs are not yet included.",
    "يغطي مبدئيًا رسوم البرنامج الشهرية فقط. لم تُحتسب بعد تكاليف برنامج الولاء والتشغيل الأخرى."
  ],
  "Zusätzlicher Umsatz": [
    "Additional revenue",
    "إيرادات إضافية"
  ],
  "Geschätzte Beitragsänderung": [
    "Estimated change in contribution",
    "التغيّر المقدّر في المساهمة"
  ],
  "Nach den angegebenen Kosten. Kein Nettogewinn und keine Umsatzprognose.": [
    "After the stated costs. Neither net profit nor a revenue forecast.",
    "بعد التكاليف المذكورة. ليست ربحًا صافيًا ولا توقعًا للإيرادات."
  ],
  "Belohnte bestehende Käufe sind nicht automatisch neuer Umsatz. Ob zusätzliche Besuche möglich sind, hängt auch von Nachfrage und deiner freien Kapazität ab.": [
    "Rewarding existing purchases does not automatically create new revenue. Whether additional visits are possible also depends on demand and your available capacity.",
    "منح مكافآت على المشتريات القائمة لا يعني تلقائيًا تحقيق إيرادات جديدة. وتعتمد إمكانية الزيارات الإضافية أيضًا على الطلب وطاقتك الاستيعابية المتاحة."
  ],
  "VORN EINFACH. DAHINTER DURCHDACHT.": [
    "SIMPLE TO USE. THOUGHTFULLY BUILT.",
    "سهل في الاستخدام. مدروس في التفاصيل."
  ],
  "Ein gutes Kundenerlebnis.": [
    "A good customer experience.",
    "تجربة جيدة للعملاء."
  ],
  "Ein ganzes System dahinter.": [
    "A complete system behind it.",
    "يدعمها نظام متكامل."
  ],
  "Echte Ansichten aus der bestehenden Anwendung, mit synthetischen Beispieldaten.": [
    "Real views from the existing application, using synthetic sample data.",
    "واجهات فعلية من التطبيق الحالي، باستخدام بيانات تجريبية اصطناعية."
  ],
  "Produktansicht": [
    "Product view",
    "واجهة المنتج"
  ],
  "Belohnen.": [
    "Reward.",
    "كافئ."
  ],
  "Stempel oder Punkte, mehrere Prämien, deine Regeln.": [
    "Stamps or points, multiple rewards, your rules.",
    "أختام أو نقاط، ومكافآت متعددة، وفق قواعدك."
  ],
  "Verstehen.": [
    "Understand.",
    "افهم."
  ],
  "Erfasste Besuche und Buchungen nachvollziehen.": [
    "Review recorded visits and transactions.",
    "تابع الزيارات والعمليات المسجّلة."
  ],
  "Zurückholen.": [
    "Invite back.",
    "شجّع العودة."
  ],
  "Zielgruppen auswählen und Empfehlungen begleiten.": [
    "Choose customer groups and follow referrals.",
    "اختر شرائح العملاء وتابع الإحالات."
  ],
  "Wachsen.": [
    "Grow.",
    "توسّع."
  ],
  "Empfehlungen, Team und klar getrennte Standorte.": [
    "Referrals, team and clearly separated locations.",
    "إحالات وفريق وفروع منفصلة بوضوح."
  ],
  "Echte Prämienverwaltung mit zwei synthetischen Prämienstufen": [
    "Real rewards management with two synthetic reward tiers",
    "إدارة فعلية للمكافآت بمستويين تجريبيين اصطناعيين"
  ],
  "Prämienverwaltung · separates 5-/10-Stempel-Beispiel aus der Anwendung": [
    "Rewards management · separate 5/10-stamp example from the application",
    "إدارة المكافآت · مثال مستقل من التطبيق يعتمد 5 و10 أختام"
  ],
  "Im geschützten Pilot": [
    "In the protected pilot",
    "ضمن التجربة محدودة الوصول"
  ],
  "Regeln, Markenauftritt und eine geordnete Auswahl an Prämien werden gespeichert. Guthaben bleibt im definierten Programm und Standort.": [
    "Rules, branding and an organised selection of rewards are saved. Balances stay within the defined programme and location.",
    "تُحفظ القواعد والهوية البصرية ومجموعة مرتّبة من المكافآت. يبقى الرصيد ضمن البرنامج والفرع المحددين."
  ],
  "Die echte Anwendung in 117 Sekunden ansehen": [
    "Watch the real application in 117 seconds",
    "شاهد التطبيق الفعلي في 117 ثانية"
  ],
  "Lokale Aufzeichnung mit synthetischen Daten. Kamera simuliert, Nachrichten lokal aufgefangen. Kein Wallet-Nachweis.": [
    "Local recording with synthetic data. The camera is simulated and messages are captured locally. This does not demonstrate Wallet support.",
    "تسجيل محلي ببيانات اصطناعية. الكاميرا مُحاكاة والرسائل مستقبَلة محليًا. لا يثبت هذا التسجيل دعم المحافظ الرقمية."
  ],
  "Loynara synthetische Produktvorführung ohne Ton": [
    "Silent Loynara product demonstration with synthetic data",
    "عرض Loynara ببيانات اصطناعية دون صوت"
  ],
  "Textfassung der Aufzeichnung lesen →": [
    "Read the recording transcript →",
    "اقرأ النص المكتوب للتسجيل ←"
  ],
  "GEMEINSAM EINRICHTEN": [
    "SET UP TOGETHER",
    "نُعدّه معًا"
  ],
  "Dein Programm.": [
    "Your programme.",
    "برنامجك."
  ],
  "Ein guter Anfang.": [
    "A good beginning.",
    "بداية جيدة."
  ],
  "Wir richten dein Programm ein und zeigen deinem Team den Ablauf. Ohne eine neue Zahlungsroutine zu erfinden.": [
    "We set up your programme and show your team the workflow. Your payment routine stays familiar.",
    "نُعدّ برنامجك ونشرح الخطوات لفريقك، مع الإبقاء على طريقة الدفع المعتادة."
  ],
  "Dauer und konkreten Umfang stimmen wir vorab ab.": [
    "We agree on the timing and exact scope beforehand.",
    "نتفق مسبقًا على المدة والنطاق المحدد."
  ],
  "Du bringst deine Regel mit.": [
    "You bring your rule.",
    "تقدّم لنا قاعدتك."
  ],
  "Geschäftsname, Standort, vorhandene Stempelregel, Prämie und Bedingungen. Papierstände werden nur nach vereinbarter Prüfung durch dein Team übertragen.": [
    "Business name, location, existing stamp rule, reward and terms. Paper balances are transferred only after the agreed checks by your team.",
    "اسم النشاط والفرع وقاعدة الأختام الحالية والمكافأة والشروط. لا تُنقل أرصدة البطاقات الورقية إلا بعد التحقق المتفق عليه من فريقك."
  ],
  "Wir richten die Grundlagen ein.": [
    "We set up the essentials.",
    "نُعدّ الأساسيات."
  ],
  "Markenauftritt, Prämien, Anmeldeschild und passende Mitarbeiterzugänge.": [
    "Branding, rewards, a sign-up display and suitable staff access.",
    "الهوية البصرية والمكافآت ولافتة التسجيل وصلاحيات مناسبة للموظفين."
  ],
  "Dein Team übt einen Besuch.": [
    "Your team practises a visit.",
    "يتدرّب فريقك على زيارة."
  ],
  "Auf einem geeigneten Gerät: Karte finden, Einkauf prüfen, Vergabe bestätigen, Prämie einlösen. Danach kennt jeder seinen Schritt.": [
    "On a suitable device: find the card, check the purchase, confirm the award and redeem a reward. Then everyone knows their step.",
    "على جهاز مناسب: العثور على البطاقة، والتحقق من الشراء، وتأكيد منح الرصيد، واستبدال المكافأة. بعدها يعرف كل فرد دوره."
  ],
  "KLARER PREIS. KLARER NÄCHSTER SCHRITT.": [
    "CLEAR PRICE. CLEAR NEXT STEP.",
    "سعر واضح. خطوة تالية واضحة."
  ],
  "Klar rechnen.": [
    "Calculate clearly.",
    "احسب بوضوح."
  ],
  "In Ruhe entscheiden.": [
    "Decide in your own time.",
    "واتخذ قرارك بهدوء."
  ],
  "Preisvorschläge pro Standort. Kein Live-Checkout. Zuzüglich Umsatzsteuer, soweit anwendbar.": [
    "Proposed prices per location. No live checkout. VAT is extra where applicable.",
    "أسعار مقترحة لكل فرع. لا توجد إمكانية للشراء الفعلي. تُضاف ضريبة القيمة المضافة حيثما تنطبق."
  ],
  "Preisvergleich": [
    "Price comparison",
    "مقارنة الأسعار"
  ],
  "49 € · Gründungspartner": [
    "€49 · Founding partner",
    "49 يورو · شريك التأسيس"
  ],
  "69 € · Standard": [
    "€69 · Standard",
    "69 يورو · الباقة الأساسية"
  ],
  "Einrichtung + erster Monat": [
    "Setup + first month",
    "الإعداد + الشهر الأول"
  ],
  "Vertragsdauer, Kündigungsbedingungen und genaue Leistungen sind noch nicht vereinbart.": [
    "Contract length, cancellation terms and exact services have not yet been agreed.",
    "لم يُتفق بعد على مدة العقد وشروط الإلغاء والخدمات المحددة."
  ],
  "Weiterer, nicht freigegebener Entwurf: 99 € inklusive Monat 1": [
    "Another unapproved draft: €99 including month 1",
    "مسودة أخرى غير معتمدة: 99 يورو تشمل الشهر الأول"
  ],
  "Nicht freigegeben, kein bestellbares Angebot.": [
    "Not approved and not available to order.",
    "غير معتمد وغير متاح للطلب."
  ],
  "Diesen Entwurf im Rechner prüfen →": [
    "Check this draft in the calculator →",
    "تحقّق من هذه المسودة في الحاسبة ←"
  ],
  "Originaler Loynara Aufstellerentwurf, nicht erhältlich": [
    "Original Loynara counter display concept, not available",
    "تصميم أصلي مقترح لحامل Loynara، غير متاح"
  ],
  "Ein guter Grund,": [
    "A good reason",
    "سبب وجيه"
  ],
  "wiederzukommen.": [
    "to come back.",
    "للعودة."
  ],
  "Dein nächster Besuch zählt.": [
    "Your next visit counts.",
    "زيارتك التالية لها قيمة."
  ],
  "GESTALTUNGSENTWURF": [
    "DESIGN CONCEPT",
    "تصوّر تصميمي"
  ],
  "Entwurf für deinen Tresen · kein Produktfoto": [
    "Concept for your counter · not a product photo",
    "تصوّر لمنضدة خدمتك · ليست صورة لمنتج فعلي"
  ],
  "DER NÄCHSTE SCHRITT AM TRESEN": [
    "THE NEXT STEP AT YOUR COUNTER",
    "الخطوة التالية عند منضدة الخدمة"
  ],
  "In Vorbereitung": [
    "In preparation",
    "قيد الإعداد"
  ],
  "Ein kleiner Tap.": [
    "A small tap.",
    "لمسة صغيرة."
  ],
  "Ein klarer nächster Schritt.": [
    "A clear next step.",
    "خطوة تالية واضحة."
  ],
  "Die Idee: ein sicherer NFC-Tag für freigegebene Stempelprogramme. Ein Handy öffnet einen geprüften Link; der Server prüft Tag und Vergaberegel.": [
    "The idea: a secure NFC tag for approved stamp programmes. A phone opens a verified link; the server checks the tag and award rule.",
    "الفكرة: وسم NFC آمن لبرامج الأختام المعتمدة. يفتح الهاتف رابطًا متحققًا منه؛ ويتحقق الخادم من الوسم وقاعدة منح الأختام."
  ],
  "Die Software ist lokal getestet. Echte Tags und iPhone-/Android-Taps sind noch nicht geprüft. Kein verfügbares Kaufprodukt, kein Bezahlen per NFC.": [
    "The software has been tested locally. Real tags and taps on iPhone/Android have not yet been tested. This is not available to buy and does not take NFC payments.",
    "اختُبر البرنامج محليًا. لم تُختبر بعد الوسوم الفعلية واللمس بهواتف iPhone وAndroid. المنتج غير متاح للشراء ولا يُستخدم للدفع عبر NFC."
  ],
  "Den heutigen QR-Ablauf ausprobieren →": [
    "Try today's QR workflow →",
    "جرّب الخطوات الحالية باستخدام QR ←"
  ],
  "GUT ZU WISSEN": [
    "GOOD TO KNOW",
    "معلومات مفيدة"
  ],
  "Die Fragen": [
    "The questions",
    "الأسئلة"
  ],
  "vor dem Start.": [
    "before you start.",
    "قبل البدء."
  ],
  "MACH ES ZU DEINEM BEISPIEL": [
    "MAKE THIS YOUR EXAMPLE",
    "اجعله مثالك الخاص"
  ],
  "Dein nächster Stammkunde": [
    "Your next regular",
    "عميلك الدائم القادم"
  ],
  "war vielleicht schon da.": [
    "may have visited already.",
    "ربما زارك من قبل."
  ],
  "Wähle deine Geschäftsart, probiere den Ablauf und bring deine Fragen mit in eine persönliche Vorführung.": [
    "Choose your business type, try the workflow and bring your questions to a personal demonstration.",
    "اختر نوع نشاطك وجرّب الخطوات، وجهّز أسئلتك لعرض شخصي."
  ],
  "Demo für mein Geschäft starten": [
    "Start a demo for my business",
    "ابدأ عرضًا تجريبيًا لنشاطي"
  ],
  "Deine Gesprächsnotiz": [
    "Your meeting note",
    "مذكرتك للمحادثة"
  ],
  "Der Kontaktweg ist noch nicht freigeschaltet. Du kannst eine Notiz für dein Gespräch lokal herunterladen. Es wird nichts gesendet.": [
    "The contact channel is not open yet. You can download a note for your conversation locally. Nothing is sent.",
    "قناة التواصل غير مفعّلة بعد. يمكنك تنزيل مذكرة للمحادثة على جهازك. لا يُرسل أي شيء."
  ],
  "Geschäft": [
    "Business",
    "النشاط"
  ],
  "Kontakt-E-Mail": [
    "Contact email",
    "البريد الإلكتروني للتواصل"
  ],
  "Was möchtest du zeigen oder klären?": [
    "What would you like to show or clarify?",
    "ما الذي ترغب في عرضه أو توضيحه؟"
  ],
  "Gesprächsnotiz herunterladen ↓": [
    "Download meeting note ↓",
    "تنزيل مذكرة المحادثة ↓"
  ],
  "Anfrage senden · noch nicht freigeschaltet": [
    "Send enquiry · not available yet",
    "إرسال استفسار · غير مفعّل بعد"
  ],
  "Lokale Formularvorschau. Kontaktziel und Betreiberinformationen fehlen noch.": [
    "Local form preview. Contact destination and operator information are still missing.",
    "معاينة محلية للنموذج. لم تُضف بعد جهة التواصل ومعلومات المشغّل."
  ],
  "Digitale Kundenbindung.": [
    "Digital customer loyalty.",
    "ولاء رقمي للعملاء."
  ],
  "Einfach für Kunden. Klar für dein Team.": [
    "Simple for customers. Clear for your team.",
    "سهل للعملاء. واضح لفريقك."
  ],
  "Zurück nach oben ↑": [
    "Back to top ↑",
    "العودة إلى الأعلى ↑"
  ],
  "Branchenbeispiele": [
    "Industry examples",
    "أمثلة حسب المجال"
  ],
  "Audit-Vorschau · kein kommerzielles Angebot. Betreiberangaben und Rechtstexte vor Marktstart ergänzen.": [
    "Audit preview · not a commercial offer. Operator details and legal texts must be added before market launch.",
    "معاينة للتدقيق · ليست عرضًا تجاريًا. يجب إضافة بيانات المشغّل والنصوص القانونية قبل الإطلاق في السوق."
  ],
  "Wallet und externer Versand: in Vorbereitung.": [
    "Wallet and external delivery: in preparation.",
    "المحفظة الرقمية والإرسال الخارجي: قيد الإعداد."
  ],
  "Brauchen meine Kunden eine eigene App?": [
    "Do my customers need a separate app?",
    "هل يحتاج عملائي إلى تطبيق خاص؟"
  ],
  "Nein. Die Karte öffnet sich im Browser. Kunden speichern ihren privaten Kartenlink als Lesezeichen.": [
    "No. The card opens in the browser. Customers save their private card link as a bookmark.",
    "لا. تُفتح البطاقة في المتصفح. يحفظ العملاء رابط بطاقتهم الخاص في الإشارات المرجعية."
  ],
  "Welches Gerät braucht mein Team?": [
    "What device does my team need?",
    "ما الجهاز الذي يحتاج إليه فريقي؟"
  ],
  "Ein geeignetes Handy, Tablet oder ein Computer mit Kamera und Internet. Eine iPhone-Kamera mit QR auf einem Mac und eine Mac-Kamera mit QR auf einem iPhone wurden vom Betreiber getestet. Zwei-Handy-Checkout und Android sind noch nicht geprüft.": [
    "A suitable phone, tablet or computer with a camera and internet access. The operator tested an iPhone camera scanning a QR code on a Mac, and a Mac camera scanning a QR code on an iPhone. Checkout with two phones and Android have not yet been tested.",
    "هاتف أو جهاز لوحي أو حاسوب مناسب مزوّد بكاميرا واتصال بالإنترنت. اختبر المشغّل كاميرا iPhone لمسح رمز QR معروض على Mac، وكاميرا Mac لمسح رمز على iPhone. لم تُختبر بعد عملية الدفع باستخدام هاتفين ولا أجهزة Android."
  ],
  "Ist mein Kassensystem angebunden?": [
    "Is my till system integrated?",
    "هل نظام الدفع لديّ متصل؟"
  ],
  "Nein. Bezahlt wird wie bisher. Das Team prüft den Einkauf und bestätigt die Vergabe in Loynara ausdrücklich. Die Software kennt ohne Anbindung keinen Zahlungseingang.": [
    "No. Payments work as before. Your team checks the purchase and explicitly confirms the award in Loynara. Without an integration, the software does not know whether payment has been received.",
    "لا. تتم المدفوعات كالمعتاد. يتحقق الفريق من الشراء ويؤكّد منح الرصيد صراحةً في Loynara. دون ربط بالأنظمة، لا يستطيع البرنامج معرفة وصول الدفعة."
  ],
  "Was passiert bei schlechtem Internet?": [
    "What happens with a poor internet connection?",
    "ماذا يحدث عند ضعف الإنترنت؟"
  ],
  "Vergaben können in einem berechtigten Browser vorgemerkt werden. Sie zählen erst nach Prüfung und Annahme durch den Server. Ablehnungen müssen geprüft werden. Browserdaten zu löschen kann ungesicherte Vorgänge verlieren. Einlösen bleibt online; der Offline-Ablauf ist bisher lokal geprüft.": [
    "Awards can be queued in an authorised browser. They count only after the server checks and accepts them. Rejections must be reviewed. Clearing browser data can lose unsaved transactions. Redemption still requires an internet connection; the offline workflow has so far been tested locally.",
    "يمكن وضع عمليات منح الرصيد في قائمة انتظار داخل متصفح مصرح له. ولا تُحتسب إلا بعد تحقق الخادم منها وقبولها. يجب مراجعة العمليات المرفوضة. قد يؤدي مسح بيانات المتصفح إلى فقدان العمليات غير المحفوظة. يظل استبدال المكافآت بحاجة إلى الإنترنت؛ وقد اختُبر العمل دون اتصال محليًا حتى الآن."
  ],
  "Wie öffnet der Kunde die Karte wieder?": [
    "How does a customer reopen their card?",
    "كيف يفتح العميل بطاقته مجددًا؟"
  ],
  "Über den gespeicherten privaten Kartenlink. Wer diesen Link hat, kann die Karte öffnen. Ohne den Link gibt es derzeit keine unabhängig geprüfte Wiederherstellung für echte Kunden. Apple und Google Wallet sind in Vorbereitung.": [
    "Through their saved private card link. Anyone with this link can open the card. Without it, there is currently no independently verified recovery method for real customers. Apple and Google Wallet support is in preparation.",
    "عبر رابط البطاقة الخاص المحفوظ. يستطيع أي شخص يملك هذا الرابط فتح البطاقة. وبدونه، لا توجد حاليًا طريقة استعادة خضعت لتحقق مستقل للعملاء الحقيقيين. دعم Apple Wallet وGoogle Wallet قيد الإعداد."
  ],
  "Was ist heute verfügbar?": [
    "What is available today?",
    "ما المتاح اليوم؟"
  ],
  "Im geschützten Pilot mit Beispieldaten: Browserkarten, Stempel und Punkte, mehrere Prämien, Aktivität, Zielgruppen sowie Team- und Standortverwaltung. Empfehlungen und Kampagnenabläufe sind lokal geprüft. Externer Nachrichtenversand und Wallet sind noch nicht für einen echten Betrieb freigegeben.": [
    "In the protected pilot with sample data: browser cards, stamps and points, multiple rewards, activity, customer groups, and team and location management. Referrals and campaign workflows have been tested locally. External messaging and Wallet have not yet been approved for real operations.",
    "في التجربة محدودة الوصول ببيانات تجريبية: بطاقات المتصفح والأختام والنقاط والمكافآت المتعددة والنشاط وشرائح العملاء وإدارة الفريق والفروع. اختُبرت الإحالات وخطوات الحملات محليًا. لم يُعتمد بعد إرسال الرسائل خارجيًا ودعم المحافظ الرقمية للتشغيل الفعلي."
  ],
  "Wie funktioniert die Einrichtung?": [
    "How does setup work?",
    "كيف تتم عملية الإعداد؟"
  ],
  "Wir übertragen mit dir deine vorhandene Regel, gestalten die Karte und richten Teamzugänge ein. Du lieferst Prämie, Bedingungen, Geschäftsname und gewünschte Standorte. Danach übt dein Team Scannen, Bestätigen und Einlösen. Eine feste Dauer ist noch nicht zugesagt.": [
    "We work with you to transfer your existing rule, design the card and set up team access. You provide the reward, terms, business name and desired locations. Your team then practises scanning, confirming and redeeming. No fixed duration has been promised yet.",
    "ننقل معك قاعدتك الحالية ونصمم البطاقة ونُعدّ صلاحيات الفريق. وتقدّم أنت المكافأة والشروط واسم النشاط والفروع المطلوبة. ثم يتدرّب فريقك على المسح والتأكيد والاستبدال. لم نلتزم بعد بمدة محددة."
  ],
  "Wie werden Marketingwünsche berücksichtigt?": [
    "How are marketing preferences handled?",
    "كيف تُراعى تفضيلات التسويق؟"
  ],
  "Eine Karte kann ohne E-Mail entstehen. Marketing erfordert separat verifizierten Kontakt und eine passende Einwilligung; ein Widerruf wird vor Versand erneut geprüft. Dieser Ablauf ist bislang nur mit synthetischen Kontakten und lokalem Versand getestet.": [
    "A card can be created without an email address. Marketing requires separately verified contact details and appropriate consent; withdrawal of consent is checked again before sending. This workflow has so far been tested only with synthetic contacts and local delivery.",
    "يمكن إنشاء بطاقة دون بريد إلكتروني. يتطلب التسويق بيانات اتصال جرى التحقق منها بشكل منفصل وموافقة مناسبة؛ ويُعاد التحقق من سحب الموافقة قبل الإرسال. اختُبرت هذه الخطوات حتى الآن باستخدام جهات اتصال اصطناعية وإرسال محلي فقط."
  ],
  "Was zahle ich genau?": [
    "What exactly would I pay?",
    "ما المبلغ الذي سأدفعه تحديدًا؟"
  ],
  "Die angezeigten Beträge sind Preisvorschläge pro Standort, zuzüglich Umsatzsteuer soweit anwendbar. Beim bisherigen Gründungspartner-Vorschlag kommen 99 € Einrichtung zu 49 € im ersten Monat hinzu; danach sind 49 € monatlich vorgesehen. Es gibt keinen Live-Checkout. Vertragsdauer, Kündigung und konkrete Leistungsbedingungen werden vor einer Bestellung vereinbart.": [
    "The displayed amounts are proposed prices per location, plus VAT where applicable. Under the current founding-partner proposal, a €99 setup fee is added to €49 for the first month; €49 per month is proposed thereafter. There is no live checkout. Contract length, cancellation and specific service terms will be agreed before an order.",
    "المبالغ المعروضة أسعار مقترحة لكل فرع، وتُضاف ضريبة القيمة المضافة حيثما تنطبق. وفق اقتراح الشريك المؤسس الحالي، تُضاف 99 يورو للإعداد إلى 49 يورو للشهر الأول؛ ثم يُقترح 49 يورو شهريًا. لا توجد إمكانية للشراء الفعلي. ويُتفق على مدة العقد والإلغاء وشروط الخدمة المحددة قبل أي طلب."
  ],
  "Kann meine Papierkarte bleiben?": [
    "Can I keep my paper card?",
    "هل يمكنني الإبقاء على البطاقة الورقية؟"
  ],
  "Ja, ein schrittweiser Übergang ist möglich. Dein Team prüft vorhandene Papierkarten und bestätigt eine vereinbarte Übertragung. Kunden geben ihre Stände nicht selbst frei; es gibt keine automatische Bilderkennung.": [
    "Yes, a gradual transition is possible. Your team checks existing paper cards and confirms an agreed transfer. Customers cannot approve their own balances; there is no automatic image recognition.",
    "نعم، يمكن الانتقال تدريجيًا. يتحقق فريقك من البطاقات الورقية الموجودة ويؤكّد النقل المتفق عليه. لا يعتمد العملاء أرصدتهم بأنفسهم؛ ولا توجد آلية تلقائية للتعرف على الصور."
  ],
  "Loynara – Mach aus Kunden Stammkunden": [
    "Loynara – Turn customers into regulars",
    "Loynara – حوّل عملاءك إلى عملاء دائمين"
  ],
  "STANDARD": [
    "STANDARD",
    "الباقة الأساسية"
  ],
  "GRÜNDUNGSPARTNER": [
    "FOUNDING PARTNER",
    "شريك التأسيس"
  ],
  "Die regulär vorgeschlagene Monatsrate.": [
    "The proposed regular monthly rate.",
    "السعر الشهري الاعتيادي المقترح."
  ],
  "Der vorgeschlagene Einstieg für erste Partner.": [
    "The proposed starting rate for early partners.",
    "السعر المبدئي المقترح للشركاء الأوائل."
  ]
};

export function templateText(de:string,locale:Locale):string {
 const translated=copy[de];
 if(!translated) throw new Error(`Missing static page translation: ${de}`);
 return text(de,translated[0],translated[1],locale);
}
