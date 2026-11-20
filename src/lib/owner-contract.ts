// ENG-277: the documents an owner accepts at open sign-up (Legal, 20 Nov 2026). A new text gets a new version and „Stand“;
// the repo history keeps the old one. The sentence on /register has its own version, like JOIN_CONSENT_TEXT_VERSION.
export const OWNER_TERMS = { version: "2026-11-20", stand: "20. November 2026", href: "/vertragsbedingungen" } as const;
export const OWNER_AVV = { version: "2026-11-20", stand: "20. November 2026", href: "/avv" } as const;
export const SIGNUP_ACCEPTANCE_TEXT_VERSION = "2026-11-20";
/** Sent by /register with the sentence's version; staff coming from an invitation see no sentence and send none. */
export const SIGNUP_ACCEPTANCE_HEADER = "x-loynara-acceptance";

/**
 * The AVV's fill-ins still open (Legal, 20 Nov). /avv renders them from here, and the configuration gate refuses open
 * sign-up while any is left (Reviewer F-1): an AVV with open brackets is no AVV. Fill one by replacing its text.
 * Provider values: CTO, company/cto/2026-11-20-avv-provider-fill-ins.md (public sources and the DPF list, 20 Nov).
 */
export const AVV_FILL_INS = {
  devices: "[[DS-08: Festplattenverschlüsselung und Bildschirmsperre der Arbeitsgeräte bestätigen]]",
  twoFactor: "[[DS-09: Zwei-Faktor-Anmeldung bei Railway, Cloudflare, Mailgun, Apple (Entwicklerkonto), Google und GitHub bestätigen]]",
  restoreTest: "[[DS-10: Datum des letzten erfolgreichen Wiederherstellungstests]]",
  railway: "Railway Corporation, 548 Market St PMB 68956, San Francisco, CA 94104, USA",
  railwayBasis: "EU-US Data Privacy Framework (Zertifizierung der Railway Corporation); zusätzlich Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3), Bestandteil des Railway-DPA",
  cloudflare: "Cloudflare, Inc., 101 Townsend Street, San Francisco, CA 94107, USA",
  cloudflareBasis: "EU-US Data Privacy Framework (Zertifizierung der Cloudflare, Inc.); bei Wegfall Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3)",
  mailgun: "[[UV-05: Firma und Anschrift (aus Mailgun-DPA)]]",
  mailgunBasis: "EU-US Data Privacy Framework (Zertifizierung der Mailgun Technologies, Inc.) und Standardvertragsklauseln der EU (Durchführungsbeschluss (EU) 2021/914, Modul 2 bzw. 3); Daten der EU-Region liegen in Rechenzentren in Belgien",
  google: "[[UV-10: Firma und Anschrift (Google Wallet)]]",
  googlePlace: "[[UV-11: Verarbeitungsort Google Wallet]]",
  googleBasis: "[[UV-12: Grundlage Google]]",
} as const;
export const hasOpenMarks = (fillIns: Record<string, string> = AVV_FILL_INS) => Object.values(fillIns).some(text => text.includes("[["));
