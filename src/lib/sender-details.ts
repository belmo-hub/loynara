// The sender of marketing mail (ENG-164; Legal 19 Oct, Design 1 Nov): its parts, the rules for each, and Legal's footer.
// No database here, so the owner's screens check and preview with exactly what the server checks and the mail prints.

export type SenderDetails = {
  shopName: string; street: string | null; postalCode: string | null; city: string; representative: string | null;
  contactEmail: string | null; contactPhone: string | null; legalForm: string | null; registerCourt: string | null; registerNumber: string | null; vatId: string | null;
};

/** The required parts: address and contact belong to each location, the representative to the business (Legal). */
export type SenderPart = "address" | "contact" | "representative";
export const LOCATION_PARTS: readonly SenderPart[] = ["address", "contact"];
const PART_NAME: Record<SenderPart, string> = { address: "Anschrift", contact: "Kontakt", representative: "„Vertreten durch“" };

export function missingParts(sender: SenderDetails): SenderPart[] {
  const parts: SenderPart[] = [];
  if (!sender.street?.trim() || !sender.postalCode?.trim() || !sender.city.trim()) parts.push("address");
  if (!sender.contactEmail?.trim() && !sender.contactPhone?.trim()) parts.push("contact");
  if (!sender.representative?.trim()) parts.push("representative");
  return parts;
}

/** „Anschrift und „Vertreten durch““; a location's parts name it when `location` is given („Anschrift für Kassel Nord“). */
export function partList(parts: readonly SenderPart[], location?: string) {
  const names = parts.map(part => location && LOCATION_PARTS.includes(part) ? `${PART_NAME[part]} für ${location}` : PART_NAME[part]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : names[0] ?? "";
}

/** The refusal and the box name the missing parts the same way (Legal, 1 Nov). */
export const missingSentence = (parts: readonly SenderPart[], location?: string) =>
  `${partList(parts, location)}. Sie stehen unter jeder E-Mail an deine Kundschaft; bis dahin geht keine E-Mail raus.`;
export const MISSING_TITLE = "Es fehlen noch Angaben für den Absender";

// ---- Normalising and checking: the owner types freely, and what is stored, previewed and printed is the normal form ----

const HAS_CONTROL = /\p{Cc}/u;
const REGISTERS = ["HRA", "HRB", "GnR", "GsR", "PR", "VR"];
export const normalizeText = (value: string) => value.trim();
/** „hrb12345“ → „HRB 12345“; anything that is no register number comes back trimmed, for the check to name. */
export function normalizeRegisterNumber(value: string) {
  const match = /^(hra|hrb|gnr|gsr|pr|vr) ?(\d{1,6})(?: ?([a-z]{1,2}))?$/i.exec(value.trim());
  if (!match) return value.trim();
  const register = REGISTERS.find(name => name.toLowerCase() === match[1].toLowerCase())!;
  return `${register} ${match[2]}${match[3] ? ` ${match[3].toUpperCase()}` : ""}`;
}
/** „de 298 417 365“ → „DE298417365“. */
export const normalizeVatId = (value: string) => value.replace(/\s/g, "").toUpperCase();

const line = (value: string, max: number, missing: string) => {
  const text = value.trim();
  if (!text) return missing;
  if (text.length < 2 || text.length > max || HAS_CONTROL.test(text)) return "Bitte prüfe diese Eingabe.";
  return "";
};
const optionalLine = (value: string, max: number) => value.trim() ? line(value, max, "") : "";

export type AddressDraft = { street: string; postalCode: string; city: string };
export const addressProblems = (draft: AddressDraft) => ({
  street: line(draft.street, 180, "Bitte gib Straße und Hausnummer ein."),
  postalCode: /^\d{5}$/.test(draft.postalCode.trim()) ? "" : "Die PLZ hat fünf Ziffern, z. B. 34117.",
  city: line(draft.city, 120, "Bitte gib die Stadt ein."),
});

export type ContactDraft = { contactEmail: string; contactPhone: string };
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function contactProblems(draft: ContactDraft) {
  const email = draft.contactEmail.trim(), phone = draft.contactPhone.trim();
  return {
    contact: email || phone ? "" : "Gib eine E-Mail-Adresse oder eine Telefonnummer ein.",
    contactEmail: !email || (EMAIL.test(email) && email.length <= 320) ? "" : "Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.",
    contactPhone: !phone || /^\+?\d[\d ()/-]{4,23}\d$/.test(phone) ? ""
      : phone.replace(/\D/g, "").length < 6 ? "Die Telefonnummer ist zu kurz, z. B. 0561 739 2214." : "Bitte prüfe die Telefonnummer, z. B. 0561 739 2214.",
  };
}

export const representativeProblems = (draft: { representative: string }) => ({
  representative: line(draft.representative, 120, "Bitte gib an, wer dein Geschäft vertritt."),
});

export type RegisterDraft = { legalForm: string; registerCourt: string; registerNumber: string; vatId: string };
export function registerProblems(draft: RegisterDraft) {
  const court = draft.registerCourt.trim(), number = normalizeRegisterNumber(draft.registerNumber), vat = normalizeVatId(draft.vatId);
  return {
    legalForm: optionalLine(draft.legalForm, 40),
    registerCourt: !court && number ? "Zur Registernummer gehört das Registergericht, z. B. Amtsgericht Kassel." : optionalLine(court, 120),
    registerNumber: court && !number ? "Zum Registergericht gehört die Nummer, z. B. HRB 12345."
      : number && !/^(HRA|HRB|GnR|GsR|PR|VR) \d{1,6}( [A-Z]{1,2})?$/.test(number) ? "Bitte gib die Nummer mit dem Register an, z. B. HRB 12345." : "",
    // German IDs are DE and 9 digits (Design, 1 Nov); other EU prefixes keep the general form.
    vatId: !vat ? "" : vat.startsWith("DE") ? (/^DE\d{9}$/.test(vat) ? "" : "Eine deutsche USt-IdNr. ist DE und 9 Ziffern, z. B. DE123456789.")
      : /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(vat) ? "" : "Bitte prüfe die USt-IdNr.",
  };
}

export const firstProblem = (problems: Record<string, string>) => Object.values(problems).find(Boolean) ?? "";

// ---- Legal's footer ----

/**
 * The footer's parts, Legal's text verbatim: the identity sentence, the register and VAT lines only when filled, then the
 * consent line. Null while a required part is missing: such a shop sends nothing promotional. Never a card link.
 */
export function senderFooter(sender: SenderDetails) {
  if (missingParts(sender).length) return null;
  const legalForm = sender.legalForm ? `, ${sender.legalForm}` : "";
  const contact = [sender.contactEmail, sender.contactPhone].filter(Boolean).join(", ");
  return {
    fromName: `${sender.shopName} via Loynara`,
    identity: `Diese E-Mail kommt von ${sender.shopName}${legalForm}, vertreten durch ${sender.representative}, ${sender.street}, ${sender.postalCode} ${sender.city}. Kontakt: ${contact}.`,
    register: sender.registerCourt && sender.registerNumber ? `Registergericht: ${sender.registerCourt}, ${sender.registerNumber}.` : null,
    vat: sender.vatId ? `USt-IdNr.: ${sender.vatId}` : null,
    consent: `Du bekommst diese E-Mail, weil du auf deiner Karte E-Mails von ${sender.shopName} bestellt hast.`,
  };
}

/** The footer as the mail prints it. */
export function footerText(footer: NonNullable<ReturnType<typeof senderFooter>>, unsubscribeLink: string, privacyUrl: string) {
  return `${[footer.identity, footer.register, footer.vat].filter(Boolean).join(" ")}\n${footer.consent} Abmelden: ${unsubscribeLink} · Datenschutz: ${privacyUrl}`;
}
