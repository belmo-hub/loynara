// ENG-277: the documents an owner accepts at open sign-up (Legal, 20 Nov 2026). A new text gets a new version and „Stand“;
// the repo history keeps the old one. The sentence on /register has its own version, like JOIN_CONSENT_TEXT_VERSION.
// Placeholder until the booking ship date (Legal, 23 Nov): the Fassung with „Termin + Treue“ in § 1 (6), § 3 (1) and § 3 (5).
export const OWNER_TERMS = { version: "2026-11-29", stand: "29. November 2026", href: "/vertragsbedingungen" } as const;
// Placeholder until the ship date (Legal, 22 Nov): the Fassung with Terminbuchung in Anlage 1 and 3; the founder still approves the text.
export const OWNER_AVV = { version: "2026-11-29", stand: "29. November 2026", href: "/avv" } as const;
/** The first AVV Fassung that covers Terminbuchung: the operator's booking switch needs a shop acceptance of it or a later one (B-1). */
export const BOOKING_AVV_VERSION = "2026-11-29";
/** The first terms Fassung with „Termin + Treue“; the booking acceptance and the operator's switch need it too (Legal § 5). */
export const BOOKING_TERMS_VERSION = "2026-11-29";
/**
 * Termin + Treue per location and month (founder Q-115; Legal § 7). Founder, 24 Nov: 69 € for every shop, the founding one too, so
 * § 3 (1) reads „ebenfalls 69 €“ and a founding shop's dialog „69 € statt 39 €“.
 */
export const TERMIN_PRICE: Record<"list" | "founding", { base: number; termin: number }> = { list: { base: 49, termin: 69 }, founding: { base: 39, termin: 69 } };
/** § 3 (1)'s founding sentence, from the constant above. */
export const foundingTerminPrice = () => TERMIN_PRICE.founding.termin === TERMIN_PRICE.list.termin ? `ebenfalls ${TERMIN_PRICE.list.termin} €` : `${TERMIN_PRICE.founding.termin} €`;
export const SIGNUP_ACCEPTANCE_TEXT_VERSION = "2026-11-20";
/** Sent by /register with the sentence's version; staff coming from an invitation see no sentence and send none. */
export const SIGNUP_ACCEPTANCE_HEADER = "x-loynara-acceptance";

/**
 * The AVV's fill-ins still open (Legal, 20 Nov). /avv renders them from here, and the configuration gate refuses open
 * sign-up while any is left (Reviewer F-1): an AVV with open brackets is no AVV. Fill one by replacing its text.
 * Provider values: CTO, company/cto/2026-11-20-avv-provider-fill-ins.md (public sources and the DPF list, 20 Nov); Mailgun's
 * address from its DPF profile. DS-08 and DS-09: the founder (20 Nov).
 */
export const AVV_FILL_INS = {
  devices: "Die Festplatten der Arbeitsgeräte sind verschlüsselt (FileVault); der Bildschirm sperrt sich nach 5 Minuten.",
  twoFactor: "Zwei-Faktor-Anmeldung ist bei Railway, Cloudflare, Mailgun, dem Apple-Entwicklerkonto und GitHub eingeschaltet, ebenso beim Google-Konto, über das sich der Anbieter bei Dienstleistern anmeldet.",
  railway: "Railway Corporation, 548 Market St PMB 68956, San Francisco, CA 94104, USA",
  railwayBasis: "EU-US Data Privacy Framework (Zertifizierung der Railway Corporation); zusätzlich Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3), Bestandteil des Railway-DPA",
  cloudflare: "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, USA",
  cloudflareBasis: "EU-US Data Privacy Framework (Zertifizierung der Cloudflare, Inc.); bei Wegfall Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3)",
  mailgun: "Mailgun Technologies, Inc., 112 E Pecan Street #1135, San Antonio, TX 78205, USA",
  mailgunBasis: "EU-US Data Privacy Framework (Zertifizierung der Mailgun Technologies, Inc.) und Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3); Daten der EU-Region liegen in Rechenzentren in Belgien",
} as const;
export const hasOpenMarks = (fillIns: Record<string, string> = AVV_FILL_INS) => Object.values(fillIns).some(text => text.includes("[["));
