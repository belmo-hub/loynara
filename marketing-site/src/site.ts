/** Single source for everything the public site states about the business, product and offer. */
export const SITE = {
  origin: 'https://getloynara.com',
  appOrigin: 'https://app.getloynara.com',
  loginUrl: 'https://app.getloynara.com/login',
  supportEmail: 'support@getloynara.com',
  /** Provisional introductory offer. Shown with "details in a personal conversation"; no setup fee, discount or VAT statement is made. */
  price: { amount: 39, unit: 'Monat / Standort', note: 'Pilotangebot – Details im persönlichen Gespräch' },
} as const;

export type IndustryKey = 'cafe' | 'barber' | 'friseur' | 'nagelstudio' | 'gastro' | 'autopflege' | 'fitness' | 'wellness';
export type Industry = {
  label: string;
  /** Example business name on the demonstration card. */
  name: string;
  /** Reward as a nominative noun phrase with article ("ein Kaffee aufs Haus"): it must read correctly in "dann wartet … auf dich". */
  reward: string;
  /** What one confirmed stamp stands for in this trade. */
  visit: string;
  intro: string;
  referral: string;
  /** "Quiet afternoon" scene. `message` is the hypothetical offer text, `outcome` a clearly fictional example. */
  quiet: { when: string; message: string; outcome: string };
  /** "Regular is missing" scene: `story` states the usual rhythm and a pause that is clearly longer than it. */
  regular: { who: string; story: string; pause: string };
};

/** The demonstration card always has ten stamps; the industry changes reward, nouns and scene copy. */
export const DEMO = { threshold: 10, startBalance: 8, example: 'Beispielkarte 4217' } as const;

export const industries: Record<IndustryKey, Industry> = {
  cafe: { label: 'Café', name: 'Café Morgenlicht', reward: 'ein Kaffee aufs Haus', visit: 'ein bestätigter Café-Besuch', intro: 'Der Kaffee bleibt wie gewohnt. Die Vorfreude auf den nächsten kommt dazu.', referral: 'Ein Gast lädt eine Freundin zu ihrem ersten Besuch ein.',
    quiet: { when: 'Dienstag, 15:30', message: 'Dienstag ab 14 Uhr ist bei uns ruhig – zum Kuchen gibt es den zweiten Kaffee auf uns.', outcome: 'Fiktives Beispiel: Zwei Gäste kommen am Dienstagnachmittag auf einen Kaffee vorbei.' },
    regular: { who: 'Eine Stammgästin', story: 'Sie kam sonst alle 10 bis 14 Tage – jetzt sind es 5 Wochen ohne bestätigten Besuch.', pause: '5 Wochen' } },
  barber: { label: 'Barber', name: 'Studio Schnittwerk', reward: 'eine Bartpflege als Extra', visit: 'ein bestätigter Termin', intro: 'Vom ersten Schnitt zum nächsten Termin – mit einer Prämie, die zu deinem Service passt.', referral: 'Ein Stammkunde empfiehlt deinen Barber weiter.',
    quiet: { when: 'Dienstag, 15:30', message: 'Am Dienstagnachmittag haben wir noch Termine frei – eine Bartpflege gibt es dazu.', outcome: 'Fiktives Beispiel: Zwei Kunden buchen einen freien Termin am Dienstagnachmittag.' },
    regular: { who: 'Ein Stammkunde', story: 'Er kam sonst alle 3 bis 4 Wochen – jetzt sind es 8 Wochen ohne bestätigten Termin.', pause: '8 Wochen' } },
  friseur: { label: 'Friseur', name: 'Salon Lichtblick', reward: 'eine Pflegebehandlung als Extra', visit: 'ein bestätigter Salontermin', intro: 'Eine sichtbare Einladung zum Wiederkommen – auch zwischen zwei Haarschnitten.', referral: 'Eine Kundin empfiehlt deinen Salon weiter.',
    quiet: { when: 'Dienstag, 15:30', message: 'Dienstagnachmittag ist bei uns Ruhezeit – zu deinem Termin gibt es eine Pflegebehandlung dazu.', outcome: 'Fiktives Beispiel: Zwei Kundinnen buchen einen Termin am Dienstagnachmittag.' },
    regular: { who: 'Eine Stammkundin', story: 'Sie kam sonst alle 6 bis 8 Wochen – jetzt sind es 14 Wochen ohne bestätigten Salontermin.', pause: '14 Wochen' } },
  nagelstudio: { label: 'Nägel / Beauty', name: 'Studio Feinsinn', reward: 'ein Pflege-Extra zur Behandlung', visit: 'eine bestätigte Behandlung', intro: 'Deine Behandlung, dein Wiederbuchungsrhythmus. Die Karte zeigt den Fortschritt.', referral: 'Eine Kundin lädt jemanden zum ersten Studiobesuch ein.',
    quiet: { when: 'Dienstag, 15:30', message: 'Für Dienstagnachmittag sind noch Termine frei – ein Pflege-Extra gibt es zur Behandlung dazu.', outcome: 'Fiktives Beispiel: Zwei Kundinnen buchen eine Behandlung am Dienstagnachmittag.' },
    regular: { who: 'Eine Stammkundin', story: 'Sie kam sonst alle 3 bis 4 Wochen – jetzt sind es 9 Wochen ohne bestätigte Behandlung.', pause: '9 Wochen' } },
  gastro: { label: 'Gastro / Takeaway', name: 'Küche um die Ecke', reward: 'eine Beilage zur Bestellung', visit: 'eine bestätigte Bestellung', intro: 'Auch die nächste Mittagspause kann wieder bei dir stattfinden.', referral: 'Ein Gast empfiehlt deinen Takeaway im Freundeskreis.',
    quiet: { when: 'Dienstag, 15:30', message: 'Dienstags ab 14 Uhr ist die Küche ruhig – zu deiner Bestellung gibt es eine Beilage dazu.', outcome: 'Fiktives Beispiel: Zwei Gäste bestellen am Dienstagnachmittag.' },
    regular: { who: 'Ein Stammgast', story: 'Er bestellte sonst jede Woche – jetzt sind es 5 Wochen ohne bestätigte Bestellung.', pause: '5 Wochen' } },
  autopflege: { label: 'Autopflege', name: 'Glanzwerk', reward: 'eine zusätzliche Felgenpflege', visit: 'ein bestätigter Pflegeservice', intro: 'Gute Pflege bleibt in Erinnerung. Deine Karte zeigt den Weg zur nächsten Prämie.', referral: 'Ein Kunde empfiehlt deinen Betrieb für den ersten Pflegetermin.',
    quiet: { when: 'Dienstag, 15:30', message: 'Dienstagnachmittag ist bei uns wenig los – zur Innenreinigung gibt es eine Felgenpflege dazu.', outcome: 'Fiktives Beispiel: Zwei Kunden buchen einen Pflegetermin am Dienstagnachmittag.' },
    regular: { who: 'Ein Stammkunde', story: 'Er kam sonst alle 8 bis 10 Wochen – jetzt sind es 5 Monate ohne bestätigten Pflegeservice.', pause: '5 Monate' } },
  fitness: { label: 'Fitness', name: 'Studio Freiraum', reward: 'eine zusätzliche Technik-Einheit', visit: 'eine bestätigte Zusatzleistung', intro: 'Treue belohnen, ergänzend zu deiner bestehenden Mitgliedschaft.', referral: 'Ein Mitglied empfiehlt das Studio; erst eine bestätigte Buchung zählt.',
    quiet: { when: 'Dienstag, 15:30', message: 'Am Dienstagnachmittag ist noch Platz für eine Technik-Einheit – schau gern vorbei.', outcome: 'Fiktives Beispiel: Zwei Mitglieder buchen eine Einheit am Dienstagnachmittag.' },
    regular: { who: 'Ein Mitglied', story: 'Das Mitglied buchte sonst alle 3 bis 4 Wochen eine Zusatzleistung – jetzt sind es 8 Wochen ohne bestätigte Buchung.', pause: '8 Wochen' } },
  wellness: { label: 'Wellness', name: 'Raum für Ruhe', reward: 'ein zusätzliches Entspannungs-Extra', visit: 'eine bestätigte Buchung', intro: 'Die nächste kleine Auszeit beginnt mit einer verständlichen Prämie.', referral: 'Ein Gast empfiehlt dein Angebot für eine erste Buchung.',
    quiet: { when: 'Dienstag, 15:30', message: 'Für Dienstagnachmittag haben wir noch Zeit für dich – ein Entspannungs-Extra gibt es dazu.', outcome: 'Fiktives Beispiel: Zwei Gäste buchen eine Auszeit am Dienstagnachmittag.' },
    regular: { who: 'Ein Gast', story: 'Er buchte sonst alle 4 bis 6 Wochen – jetzt sind es 12 Wochen ohne bestätigte Buchung.', pause: '12 Wochen' } },
};
export const industryKeys = Object.keys(industries) as IndustryKey[];
export const isIndustryKey = (value: string | undefined): value is IndustryKey => !!value && value in industries;
