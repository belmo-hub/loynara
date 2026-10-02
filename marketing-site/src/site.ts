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
  reward: string;
  /** What one confirmed stamp stands for in this trade. */
  visit: string;
  intro: string;
  referral: string;
  /** Wording of the "quiet period" scene. */
  quiet: { when: string; slot: string; message: string };
  /** Wording of the "regular is missing" scene. */
  regular: { who: string; rhythm: string };
};

/** The demonstration card always has ten stamps; the industry changes reward, nouns and scene copy. */
export const DEMO = { threshold: 10, startBalance: 8, example: 'Beispielkarte 4217' } as const;

export const industries: Record<IndustryKey, Industry> = {
  cafe: { label: 'Café', name: 'Café Morgenlicht', reward: 'ein Kaffee aufs Haus', visit: 'ein bestätigter Café-Besuch', intro: 'Der Kaffee bleibt wie gewohnt. Die Vorfreude auf den nächsten kommt dazu.', referral: 'Ein Gast lädt eine Freundin zu ihrem ersten Besuch ein.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Dienstag ab 14 Uhr ist bei uns ruhig – zum Kuchen gibt es den zweiten Kaffee auf uns.' }, regular: { who: 'Eine Stammgästin', rhythm: 'sonst alle 10 bis 14 Tage da' } },
  barber: { label: 'Barber', name: 'Studio Schnittwerk', reward: 'eine Bartpflege als Extra', visit: 'ein bestätigter Termin', intro: 'Vom ersten Schnitt zum nächsten Termin – mit einer Prämie, die zu deinem Service passt.', referral: 'Ein Stammkunde empfiehlt deinen Barber weiter.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Am Dienstagnachmittag haben wir noch Termine frei – Bartpflege gibt es dazu.' }, regular: { who: 'Ein Stammkunde', rhythm: 'sonst alle 3 bis 4 Wochen da' } },
  friseur: { label: 'Friseur', name: 'Salon Lichtblick', reward: 'eine Pflegebehandlung als Extra', visit: 'ein bestätigter Salontermin', intro: 'Eine sichtbare Einladung zum Wiederkommen – auch zwischen zwei Haarschnitten.', referral: 'Eine Kundin empfiehlt deinen Salon weiter.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Dienstagnachmittag ist bei uns Ruhezeit – für Termine dann gibt es eine Pflegebehandlung dazu.' }, regular: { who: 'Eine Stammkundin', rhythm: 'sonst alle 6 bis 8 Wochen da' } },
  nagelstudio: { label: 'Nägel / Beauty', name: 'Studio Feinsinn', reward: 'ein Pflege-Extra zur Behandlung', visit: 'eine bestätigte Behandlung', intro: 'Deine Behandlung, dein Wiederbuchungsrhythmus. Die Karte zeigt den Fortschritt.', referral: 'Eine Kundin lädt jemanden zum ersten Studiobesuch ein.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Für Dienstagnachmittag sind noch Termine frei – ein Pflege-Extra gibt es dazu.' }, regular: { who: 'Eine Stammkundin', rhythm: 'sonst alle 3 bis 4 Wochen da' } },
  gastro: { label: 'Gastro / Takeaway', name: 'Küche um die Ecke', reward: 'eine Beilage zur Bestellung', visit: 'eine bestätigte Bestellung', intro: 'Auch die nächste Mittagspause kann wieder bei dir stattfinden.', referral: 'Ein Gast empfiehlt deinen Takeaway im Freundeskreis.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Dienstags ab 14 Uhr ist die Küche ruhig – zur Bestellung gibt es eine Beilage dazu.' }, regular: { who: 'Ein Stammgast', rhythm: 'bestellt sonst jede Woche' } },
  autopflege: { label: 'Autopflege', name: 'Glanzwerk', reward: 'eine zusätzliche Felgenpflege', visit: 'ein bestätigter Pflegeservice', intro: 'Gute Pflege bleibt in Erinnerung. Deine Karte zeigt den Weg zur nächsten Prämie.', referral: 'Ein Kunde empfiehlt deinen Betrieb für den ersten Pflegetermin.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Dienstagnachmittag ist bei uns wenig los – Felgenpflege gibt es zur Innenreinigung dazu.' }, regular: { who: 'Ein Stammkunde', rhythm: 'sonst alle 8 bis 10 Wochen da' } },
  fitness: { label: 'Fitness', name: 'Studio Freiraum', reward: 'eine zusätzliche Technik-Einheit', visit: 'eine bestätigte Zusatzleistung', intro: 'Treue belohnen, ergänzend zu deiner bestehenden Mitgliedschaft.', referral: 'Ein Mitglied empfiehlt das Studio; erst eine bestätigte Buchung zählt.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Am Dienstagnachmittag ist noch Platz bei der Technik-Einheit – schau gern vorbei.' }, regular: { who: 'Ein Mitglied', rhythm: 'bucht sonst alle 3 bis 4 Wochen eine Zusatzleistung' } },
  wellness: { label: 'Wellness', name: 'Raum für Ruhe', reward: 'ein zusätzliches Entspannungs-Extra', visit: 'eine bestätigte Buchung', intro: 'Die nächste kleine Auszeit beginnt mit einer verständlichen Prämie.', referral: 'Ein Gast empfiehlt dein Angebot für eine erste Buchung.',
    quiet: { when: 'Dienstag, 15:30', slot: 'Dienstagnachmittag', message: 'Für Dienstagnachmittag haben wir noch Zeit für dich – ein Entspannungs-Extra gibt es dazu.' }, regular: { who: 'Ein Gast', rhythm: 'bucht sonst alle 4 bis 6 Wochen' } },
};
export const industryKeys = Object.keys(industries) as IndustryKey[];
export const isIndustryKey = (value: string | undefined): value is IndustryKey => !!value && value in industries;
