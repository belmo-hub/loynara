/** Single source for everything the public site states about the business, product and offer. */
export const SITE = {
    origin: 'https://getloynara.com',
    appOrigin: 'https://app.getloynara.com',
    loginUrl: 'https://app.getloynara.com/login',
    termsUrl: 'https://app.getloynara.com/teilnahmebedingungen',
    supportEmail: 'support@getloynara.com',
    /** Provisional introductory offer. Shown with "details in a personal conversation"; no setup fee, discount or VAT statement is made. */
    price: { amount: 39, unit: 'Monat / Standort', note: 'Pilotangebot – Details im persönlichen Gespräch' },
};
/** Every variant is complete: each changes the demo card, reward rule, the confirmed event and the referral example. */
export const industries = {
    cafe: { label: 'Café', name: 'Café Morgenlicht', reward: 'ein Kaffee aufs Haus', visit: 'ein bestätigter Café-Besuch', threshold: 8, intro: 'Der Kaffee bleibt wie gewohnt. Die Vorfreude auf den nächsten kommt dazu.', referral: 'Ein Gast lädt eine Freundin zu ihrem ersten Besuch ein.' },
    barber: { label: 'Barber', name: 'Studio Schnittwerk', reward: 'eine Bartpflege als Extra', visit: 'ein bestätigter Termin', threshold: 5, intro: 'Vom ersten Schnitt zum nächsten Termin – mit einer Prämie, die zu deinem Service passt.', referral: 'Ein Stammkunde empfiehlt deinen Barber weiter.' },
    friseur: { label: 'Friseur', name: 'Salon Lichtblick', reward: 'eine Pflegebehandlung als Extra', visit: 'ein bestätigter Salontermin', threshold: 6, intro: 'Eine sichtbare Einladung zum Wiederkommen – auch zwischen zwei Haarschnitten.', referral: 'Eine Kundin empfiehlt deinen Salon weiter.' },
    nagelstudio: { label: 'Nägel / Beauty', name: 'Studio Feinsinn', reward: 'ein Pflege-Extra zur Behandlung', visit: 'eine bestätigte Behandlung', threshold: 5, intro: 'Deine Behandlung, dein Wiederbuchungsrhythmus. Die Karte zeigt den Fortschritt.', referral: 'Eine Kundin lädt jemanden zum ersten Studiobesuch ein.' },
    gastro: { label: 'Gastro / Takeaway', name: 'Küche um die Ecke', reward: 'eine Beilage zur Bestellung', visit: 'eine bestätigte Bestellung', threshold: 8, intro: 'Auch die nächste Mittagspause kann wieder bei dir stattfinden.', referral: 'Ein Gast empfiehlt deinen Takeaway im Freundeskreis.' },
    autopflege: { label: 'Autopflege', name: 'Glanzwerk', reward: 'eine zusätzliche Felgenpflege', visit: 'ein bestätigter Pflegeservice', threshold: 4, intro: 'Gute Pflege bleibt in Erinnerung. Deine Karte zeigt den Weg zur nächsten Prämie.', referral: 'Ein Kunde empfiehlt deinen Betrieb für den ersten Pflegetermin.' },
    fitness: { label: 'Fitness', name: 'Studio Freiraum', reward: 'eine zusätzliche Technik-Einheit', visit: 'eine bestätigte Zusatzleistung', threshold: 5, intro: 'Treue belohnen, ergänzend zu deiner bestehenden Mitgliedschaft.', referral: 'Ein Mitglied empfiehlt das Studio; erst eine bestätigte Buchung zählt.' },
    wellness: { label: 'Wellness', name: 'Raum für Ruhe', reward: 'ein zusätzliches Entspannungs-Extra', visit: 'eine bestätigte Buchung', threshold: 5, intro: 'Die nächste kleine Auszeit beginnt mit einer verständlichen Prämie.', referral: 'Ein Gast empfiehlt dein Angebot für eine erste Buchung.' },
};
export const industryKeys = Object.keys(industries);
export const isIndustryKey = (value) => !!value && value in industries;
