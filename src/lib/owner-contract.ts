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
 */
export const AVV_FILL_INS = {
  devices: "[[DS-08: Festplattenverschlüsselung und Bildschirmsperre der Arbeitsgeräte bestätigen]]",
  twoFactor: "[[DS-09: Zwei-Faktor-Anmeldung bei Railway, Cloudflare, Mailgun, Apple (Entwicklerkonto), Google und GitHub bestätigen]]",
  restoreTest: "[[DS-10: Datum des letzten erfolgreichen Wiederherstellungstests]]",
  railway: "[[UV-01: Firma und Anschrift (aus Railway-DPA)]]",
  railwayBasis: "[[UV-02: DPF oder SCC (Railway)]]",
  cloudflare: "[[UV-03: Firma und Anschrift (aus Cloudflare-DPA)]]",
  cloudflareBasis: "[[UV-04: DPF oder SCC (Cloudflare)]]",
  mailgun: "[[UV-05: Firma und Anschrift (aus Mailgun-DPA)]]",
  mailgunBasis: "[[UV-06: DPF oder SCC (Mailgun)]]",
  google: "[[UV-10: Firma und Anschrift (Google Wallet)]]",
  googlePlace: "[[UV-11: Verarbeitungsort Google Wallet]]",
  googleBasis: "[[UV-12: Grundlage Google]]",
  uptime: "[[UV-13: UptimeRobot oder Healthchecks.io]]",
} as const;
export const hasOpenMarks = (fillIns: Record<string, string> = AVV_FILL_INS) => Object.values(fillIns).some(text => text.includes("[["));
