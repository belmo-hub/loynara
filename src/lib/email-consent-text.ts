// ENG-165: Legal's e-mail consent box text, by version. No database, so the card may import it. A changed text gets a new
// version here (never edit a published one): the consent event records which text the guest ticked.
export const EMAIL_CONSENT_TEXT_VERSION = "email-consent-2026-11-01-v1";

export const EMAIL_CONSENT_TEXTS: Record<string, (shop: string, location: string) => string> = {
  "email-consent-2026-11-01-v1": (shop, location) => `Ja, ${shop}${location && location !== shop ? `, ${location}` : ""}, darf mir Angebote, Neuigkeiten und Erinnerungen per E-Mail schicken. Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit widerrufen, auf meiner Karte oder mit einem Klick in jeder E-Mail. `,
};

/** The text shown with the box today; the link „Mehr in den Datenschutzhinweisen.“ follows it inside the label. */
export const emailConsentText = (shop: string, location: string) => EMAIL_CONSENT_TEXTS[EMAIL_CONSENT_TEXT_VERSION](shop, location);
