/**
 * Release-gated copy. Every sentence that must change when a product gate passes lives here, in both versions,
 * so the release state is explicit and both versions stay tested (tests/claims.test.ts). See gtm/15-copy-switches.md.
 *
 * nfcAccepted: flip to true only after the merchant-completion RC is deployed AND the physical NFC tag acceptance
 *              test has passed in production. Until then QR is the entry claim and NFC is "Ausblick".
 * rcDeployed:  flip to true only after the merchant-completion RC is deployed and its targeted production
 *              verification passed (card locator, owner/manager reissue keeping membership/balance/history/locator, corrections).
 * bookingLive: flip to true only after Loynara Termin (online booking, reminders, no-show handling) is deployed to production.
 *              While false, the Termin + Treue plan, the "Für Salons" link and the /fuer-salons/ page do not exist in the build.
 */
export interface Gates { nfcAccepted: boolean; rcDeployed: boolean; bookingLive: boolean }
export const RELEASED_GATES: Gates = { nfcAccepted: true, rcDeployed: true, bookingLive: false };

/** Test-only override ("nfcAccepted,rcDeployed,bookingLive"). build.mts refuses to run while it is set. */
const testOverride: string | undefined = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.LOYNARA_TEST_GATES;
export const GATES: Gates = testOverride === undefined ? RELEASED_GATES
  : { nfcAccepted: testOverride.split(',').includes('nfcAccepted'), rcDeployed: testOverride.split(',').includes('rcDeployed'), bookingLive: testOverride.split(',').includes('bookingLive') };

const ENTRY = {
  qr: {
    social: 'Per QR-Code, ohne App',
    fact: 'Per QR-Code',
    appAnswer: 'Nein. Die Karte öffnet sich im Browser, sobald dein Kunde den QR-Code am Tresen scannt.',
    nfcFaq: ['Und NFC zum Antippen?', 'Das Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick. Gestartet wird mit dem QR-Code. Er öffnet dieselbe Karte und bleibt auch später immer als Alternative.'] as [string, string],
    pilotEntry: 'QR-Einstieg',
    pilotOutlook: 'NFC-Antippen, Logo-Darstellung sowie Kampagnen und Nachrichten',
    included: 'QR-Einstieg am Tresen',
    priceOutlook: 'NFC-Antippen, Logo-Darstellung, Kampagnen und Nachrichten',
    roleCustomer: 'Scannt den Code, sammelt bis zur Prämie.',
    visitCaption: 'Dein Kunde scannt den QR-Code am Tresen.',
    sheetStart: ['QR-Code am Tresen scannen', 'Die Karte öffnet sich im Browser.'] as [string, string],
    standText: 'Scannen und sammeln',
    standAria: 'Aufsteller am Tresen mit QR-Code, Gestaltungsbeispiel',
    pageSignup: 'Der Kunde scannt den QR-Code an deinem Tresen. Die Karte öffnet sich im Browser.',
    pageSignupShort: 'QR-Code am Tresen scannen. Die Karte öffnet sich im Browser.',
    pageAppAnswer: 'Nein. Die Karte läuft im Browser. Einmal den QR-Code scannen, danach öffnet der gespeicherte Link die Karte.',
    pageWalletFaq: ['Was ist mit Apple Wallet oder NFC?', 'Das Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick. Gestartet wird mit dem QR-Code im Browser – das funktioniert mit jedem Handy, das QR-Codes scannen kann. Apple Wallet schalten wir für deinen Laden auf Wunsch dazu.'] as [string, string],
  },
  nfc: {
    social: 'Antippen oder QR-Code, ohne App',
    fact: 'Antippen oder QR-Code',
    appAnswer: 'Nein. Dein Kunde hält sein Handy an den NFC-Tag am Tresen oder scannt den QR-Code – die Karte öffnet sich im Browser.',
    nfcFaq: ['Und wenn ein Handy kein NFC kann?', 'Dann scannt dein Kunde den QR-Code. Er öffnet dieselbe Karte und bleibt immer als Alternative.'] as [string, string],
    pilotEntry: 'NFC- und QR-Einstieg',
    pilotOutlook: 'Logo-Darstellung sowie Kampagnen und Nachrichten',
    included: 'NFC-Antippen und QR-Einstieg am Tresen',
    priceOutlook: 'Logo-Darstellung, Kampagnen und Nachrichten',
    roleCustomer: 'Tippt an oder scannt, sammelt bis zur Prämie.',
    visitCaption: 'Dein Kunde hält sein Handy an den Tresen oder scannt den QR-Code.',
    sheetStart: ['Handy an den Tresen halten', 'Oder QR-Code scannen. Die Karte öffnet sich im Browser.'] as [string, string],
    standText: 'Antippen oder scannen',
    standAria: 'Aufsteller am Tresen mit NFC und QR-Code, Gestaltungsbeispiel',
    pageSignup: 'Der Kunde hält sein Handy an den NFC-Tag an deinem Tresen oder scannt den QR-Code. Die Karte öffnet sich im Browser.',
    pageSignupShort: 'Handy an den Tresen halten oder QR-Code scannen. Die Karte öffnet sich im Browser.',
    pageAppAnswer: 'Nein. Die Karte läuft im Browser. Einmal antippen oder den QR-Code scannen, danach öffnet der gespeicherte Link die Karte.',
    pageWalletFaq: ['Was ist mit Apple Wallet oder NFC?', 'Antippen per NFC funktioniert, der QR-Code bleibt immer als Alternative. Apple Wallet schalten wir für deinen Laden auf Wunsch dazu.'] as [string, string],
  },
};

// Production truth confirmed by owner: canonical application c822d2381dc67544a0ba0c898bf2ddcf98035943.
// TAG-01 preview acceptance does not enable the independent production NFC gate.
const RECOVERY = {
  live: {
    counterAnswer: 'Dein Team sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Erst dann gibt es einen Stempel, genau einmal. Bezahlt wird wie bisher; Loynara ist keine Kassenanbindung und kein Bezahlsystem.',
    correctionAnswer: 'Bei einem falsch gebuchten Stempel wendest du dich an die Leitung.',
    lostAnswer: 'Die Karte gehört zu einem privaten Link. Wer ihn gespeichert hat oder das Schild beziehungsweise den QR-Code erneut nutzt, kommt wieder zu seiner Karte. Eine pauschale Wiederherstellungsgarantie geben wir nicht.',
  },
  rc: {
    correctionAnswer: 'Als Inhaber oder Leitung korrigierst du eine falsche Buchung mit Begründung. Die ursprüngliche Buchung und die Korrektur bleiben im Verlauf nachvollziehbar.',
    counterAnswer: 'Dein Team sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Klappt der Scan nicht, findet dein Team die Karte über ihre kurze Kartennummer im Format K-XXXXXX. Erst dann gibt es einen Stempel, genau einmal. Bezahlt wird wie bisher; Loynara ist keine Kassenanbindung und kein Bezahlsystem.',
    // Both ways back now replace the private link, the QR code and a saved Apple Wallet pass (PR #242;
    // src/lib/card-recovery.ts, card-reissue.ts), so one closing sentence covers both.
    lostAnswer: 'Die Karte gehört zu einem privaten Link. Wer ihn gespeichert hat, kommt jederzeit wieder zu seiner Karte. Ist er verloren, holt sich dein Kunde die Karte mit bestätigter E-Mail-Adresse über „Karte wiederfinden“ selbst zurück. Sonst stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer und gleiche Mitgliedschaft. In beiden Fällen funktionieren der alte Link, der alte QR-Code und eine auf Wunsch gespeicherte Apple-Wallet-Karte danach nicht mehr.',
  },
};

export const COPY_VARIANTS = { ENTRY, RECOVERY };
export const ENTRY_COPY = GATES.nfcAccepted ? ENTRY.nfc : ENTRY.qr;
export const RECOVERY_COPY = GATES.rcDeployed ? RECOVERY.rc : RECOVERY.live;

/** Termin + Treue claims (docs/booking-design.md). Only what the booking slice does; out-of-scope items are listed as not included. */
export const TERMIN_COPY = {
  /** Termin + Treue: the 49 € plan plus online booking. Same founding-price rule as SITE.price. */
  amount: 69,
  /** Founder wording 24 Oct 2026. Legal must confirm the agreement carries the identical condition before this is published. */
  guarantee: 'Und wenn deine Loynara-Kunden im ersten Monat weniger als 70 € bei dir ausgeben, bekommst du dein Geld zurück. Kündigen kannst du jeden Monat. Voraussetzung: Das Schild stand am Tresen und Einkäufe wurden normal erfasst.',
  planNote: 'Termin + Treue: alles aus dem 49-€-Paket, dazu Online-Buchung.',
  included: ['Alles aus dem Treue-Paket für 49 €', 'Online-Termine direkt von der Kundenkarte', 'Erinnerung 24 Stunden und 2 Stunden vorher per Push', 'Umgang mit Nichterscheinen', 'Erinnerung zum nächsten Termin, je Leistung', 'Keine Provision, nie', 'Deine Kundenliste gehört dir: CSV-Export'],
  fine: 'Push-Erinnerungen kommen an, wenn dein Kunde Mitteilungen erlaubt. Zahlung oder Anzahlung online gehören nicht dazu.',
  notIncluded: 'Keine Online-Zahlung und keine Anzahlung · keine Warteliste · keine Gruppenkurse · kein Abgleich mit Google Kalender, Treatwell oder Fresha · keine SMS und kein WhatsApp · keine Serientermine · kein Kundenkonto.',
} as const;
