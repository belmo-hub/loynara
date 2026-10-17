/**
 * Release-gated copy. Every sentence that must change when a product gate passes lives here, in both versions,
 * so the release state is explicit and both versions stay tested (tests/claims.test.ts). See gtm/15-copy-switches.md.
 *
 * nfcAccepted: flip to true only after the merchant-completion RC is deployed AND the physical NFC tag acceptance
 *              test has passed in production. Until then QR is the entry claim and NFC is "Ausblick".
 * rcDeployed:  flip to true only after the merchant-completion RC is deployed and its targeted production
 *              verification passed (card locator, owner/manager reissue keeping membership/balance/history/locator, corrections).
 */
export interface Gates { nfcAccepted: boolean; rcDeployed: boolean }
export const RELEASED_GATES: Gates = { nfcAccepted: true, rcDeployed: true };

/** Test-only override ("nfcAccepted,rcDeployed"). build.mts refuses to run while it is set. */
const testOverride: string | undefined = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.LOYNARA_TEST_GATES;
export const GATES: Gates = testOverride === undefined ? RELEASED_GATES
  : { nfcAccepted: testOverride.split(',').includes('nfcAccepted'), rcDeployed: testOverride.split(',').includes('rcDeployed') };

const ENTRY = {
  qr: {
    social: 'Per QR-Code, ohne App',
    fact: 'Per QR-Code',
    appAnswer: 'Nein. Die Karte öffnet sich im Browser, sobald dein Kunde den QR-Code am Tresen scannt.',
    nfcFaq: ['Und NFC zum Antippen?', 'Das Antippen per NFC ist vorbereitet; wir zeigen es als Ausblick. Gestartet wird mit dem QR-Code. Er öffnet dieselbe Karte und bleibt auch später immer als Alternative.'] as [string, string],
    pilotEntry: 'QR-Einstieg',
    pilotOutlook: 'Aufsteller, NFC-Antippen, Wallet-Karte, Logo-Darstellung sowie Kampagnen und Nachrichten',
    included: 'QR-Einstieg am Tresen',
    priceOutlook: 'Aufsteller, NFC-Antippen, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten',
    roleCustomer: 'Scannt den Code, sammelt bis zur Prämie.',
    visitCaption: 'Dein Kunde scannt den QR-Code am Tresen.',
    sheetStart: ['QR-Code am Tresen scannen', 'Die Karte öffnet sich im Browser.'] as [string, string],
    standText: 'Scannen und sammeln',
    standAria: 'Aufsteller am Tresen mit QR-Code, Gestaltungsbeispiel',
    pageSignup: 'Der Kunde scannt den QR-Code an deinem Tresen. Die Karte öffnet sich im Browser.',
    pageSignupShort: 'QR-Code am Tresen scannen. Die Karte öffnet sich im Browser.',
    pageAppAnswer: 'Nein. Die Karte läuft im Browser. Einmal den QR-Code scannen, danach öffnet der gespeicherte Link die Karte.',
    pageWalletFaq: ['Was ist mit Apple Wallet oder NFC?', 'Beides zeigen wir als Ausblick; das Antippen per NFC ist vorbereitet. Gestartet wird mit dem QR-Code im Browser – das funktioniert mit jedem Handy, das QR-Codes scannen kann.'] as [string, string],
  },
  nfc: {
    social: 'Antippen oder QR-Code, ohne App',
    fact: 'Antippen oder QR-Code',
    appAnswer: 'Nein. Dein Kunde hält sein Handy an den NFC-Tag am Tresen oder scannt den QR-Code – die Karte öffnet sich im Browser.',
    nfcFaq: ['Und wenn ein Handy kein NFC kann?', 'Dann scannt dein Kunde den QR-Code. Er öffnet dieselbe Karte und bleibt immer als Alternative.'] as [string, string],
    pilotEntry: 'NFC- und QR-Einstieg',
    pilotOutlook: 'Aufsteller, Wallet-Karte, Logo-Darstellung sowie Kampagnen und Nachrichten',
    included: 'NFC-Antippen und QR-Einstieg am Tresen',
    priceOutlook: 'Aufsteller, Wallet-Karte, Logo-Darstellung, Kampagnen und Nachrichten',
    roleCustomer: 'Tippt an oder scannt, sammelt bis zur Prämie.',
    visitCaption: 'Dein Kunde hält sein Handy an den Tresen oder scannt den QR-Code.',
    sheetStart: ['Handy an den Tresen halten', 'Oder QR-Code scannen. Die Karte öffnet sich im Browser.'] as [string, string],
    standText: 'Antippen oder scannen',
    standAria: 'Aufsteller am Tresen mit NFC und QR-Code, Gestaltungsbeispiel',
    pageSignup: 'Der Kunde hält sein Handy an den NFC-Tag an deinem Tresen oder scannt den QR-Code. Die Karte öffnet sich im Browser.',
    pageSignupShort: 'Handy an den Tresen halten oder QR-Code scannen. Die Karte öffnet sich im Browser.',
    pageAppAnswer: 'Nein. Die Karte läuft im Browser. Einmal antippen oder den QR-Code scannen, danach öffnet der gespeicherte Link die Karte.',
    pageWalletFaq: ['Was ist mit Apple Wallet oder NFC?', 'Antippen per NFC funktioniert, der QR-Code bleibt immer als Alternative. Die Wallet-Karte zeigen wir als Ausblick.'] as [string, string],
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
    lostAnswer: 'Die Karte gehört zu einem privaten Link. Wer ihn gespeichert hat, kommt jederzeit wieder zu seiner Karte. Ist er verloren, stellst du oder deine Leitung die Karte neu aus: gleicher Stand, gleicher Verlauf, gleiche Kartennummer und gleiche Mitgliedschaft. Der alte Link und der alte QR-Code der Karte funktionieren danach nicht mehr.',
  },
};

export const COPY_VARIANTS = { ENTRY, RECOVERY };
export const ENTRY_COPY = GATES.nfcAccepted ? ENTRY.nfc : ENTRY.qr;
export const RECOVERY_COPY = GATES.rcDeployed ? RECOVERY.rc : RECOVERY.live;
