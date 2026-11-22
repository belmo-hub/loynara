// Legal's rebook consent box (legal-ops/2026-11-22-eng-201-termin-booking.md, B-2). No database, so the card may import it.
// A changed text gets a new version (never edit a published one): the consent event records which text the guest ticked.
export const REBOOK_CONSENT = {
  version: "booking-rebook-v2",
  label: "Das Geschäft darf mir eine Mitteilung schicken, wenn es Zeit für den nächsten Termin wäre.",
  description: "Höchstens einmal nach jedem Termin, nie nachts. Freiwillig, jederzeit hier abschaltbar.",
} as const;
