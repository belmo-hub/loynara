// ENG-277: the documents an owner accepts at open sign-up (Legal, 20 Nov 2026). A new text gets a new version and „Stand“;
// the repo history keeps the old one. The sentence on /register has its own version, like JOIN_CONSENT_TEXT_VERSION.
export const OWNER_TERMS = { version: "2026-11-20", stand: "20. November 2026", href: "/vertragsbedingungen" } as const;
export const OWNER_AVV = { version: "2026-11-20", stand: "20. November 2026", href: "/avv" } as const;
export const SIGNUP_ACCEPTANCE_TEXT_VERSION = "2026-11-20";
/** Sent by /register with the sentence's version; staff coming from an invitation see no sentence and send none. */
export const SIGNUP_ACCEPTANCE_HEADER = "x-loynara-acceptance";
