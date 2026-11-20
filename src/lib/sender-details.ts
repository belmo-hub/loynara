// The sender of marketing mail (ENG-164; Legal 19 Oct, Design 1 Nov): its parts, the rules for each, and Legal's footer.
// No database here, so the owner's screens check and preview with exactly what the server checks and the mail prints.

export type SenderDetails = {
  shopName: string; street: string | null; postalCode: string | null; city: string; representative: string | null;
  contactEmail: string | null; contactPhone: string | null; legalForm: string | null; registerCourt: string | null; registerNumber: string | null; vatId: string | null;
};

/**
 * The required parts: address and contact email belong to each location, the representative to the business, and the
 * register entry too when the legal form is a registered one (Legal, 1 Nov: § 5 DDG).
 */
export type SenderPart = "address" | "contact" | "representative" | "registerCourt" | "registerNumber";
export const LOCATION_PARTS: readonly SenderPart[] = ["address", "contact"];
export const REGISTER_PARTS: readonly SenderPart[] = ["registerCourt", "registerNumber"];
const PART_NAME: Record<SenderPart, string> = { address: "Anschrift", contact: "Kontakt", representative: "„Vertreten durch“", registerCourt: "Registergericht", registerNumber: "Registernummer" };

/**
 * GmbH, UG, AG, KG, OHG, e.K., eG, PartG, matched loosely („UG (haftungsbeschränkt)“, „GmbH & Co. KG“, „e. K.“, „e.Kfm.“,
 * „eingetragener Kaufmann“, „PartG mbB“), and KGaA and eGbR (registered since MoPeG); a plain GbR is not (Legal, 1 Nov).
 */
/**
 * The Rechtsform choices (Design and Marketing, 1 Nov; eGbR and KGaA per Legal). The stored value is the form itself, so the
 * Pflicht rule below holds for a choice and for „Andere …“'s free text alike; "" is „Keine Angabe“ and stores nothing.
 */
export const LEGAL_FORMS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "", label: "Keine Angabe" }, { value: "Einzelunternehmen", label: "Einzelunternehmen (ohne Handelsregister)" },
  ...["GbR", "eGbR", "e.K.", "GmbH", "UG (haftungsbeschränkt)", "GmbH & Co. KG", "KG", "KGaA", "OHG", "AG", "eG", "PartG", "PartG mbB"].map(form => ({ value: form, label: form })),
];
/** „Keine Angabe“ and „Einzelunternehmen“ print no legal form in the footer (A08b). */
const printedForm = (legalForm: string | null) => legalForm && !/^einzelunternehm/i.test(legalForm.trim()) ? legalForm : null;

export const registeredForm = (legalForm: string | null) => {
  const form = legalForm ?? "";
  // A company still being founded („GmbH i.G.“, „in Gründung“) has no register entry yet and can save (Design, 1 Nov).
  if (/(^|[^a-zäöüß])i\.\s?g\.?(?![a-zäöüß])|in\s+gründung/i.test(form)) return false;
  return /(^|[^a-zäöüß])(g?gmbh|g?ug|ag|se|kgaa|kg|ohg|e\.?\s?k(fm|fr)?|e\.?\s?g(br)?|partg)(?![a-zäöüß])|eingetragene[rn]?\s+kauf(mann|frau)/i.test(form);
};

export function missingParts(sender: SenderDetails): SenderPart[] {
  const parts: SenderPart[] = [];
  if (!sender.street?.trim() || !sender.postalCode?.trim() || !sender.city.trim()) parts.push("address");
  if (!sender.contactEmail?.trim()) parts.push("contact");
  if (!sender.representative?.trim()) parts.push("representative");
  if (registeredForm(sender.legalForm) && !sender.registerCourt?.trim()) parts.push("registerCourt");
  if (registeredForm(sender.legalForm) && !sender.registerNumber?.trim()) parts.push("registerNumber");
  return parts;
}

/** „Anschrift und „Vertreten durch““; a location's parts name it when `location` is given („Anschrift für Kassel Nord“). */
export function partList(parts: readonly SenderPart[], location?: string) {
  const names = parts.map(part => location && LOCATION_PARTS.includes(part) ? `${PART_NAME[part]} für ${location}` : PART_NAME[part]);
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} und ${names.at(-1)}` : names[0] ?? "";
}

// Legal's wording (1 Nov, E24/E41 and the API refusal): the box and the refusal name the missing parts the same way.
export const MISSING_TITLE = "Es fehlen noch Angaben für den Absender:";
/** The box's text after its bold title. Only a location's own parts missing: sends wait for that location alone (E41). */
export function missingSentence(parts: readonly SenderPart[], location?: string) {
  const only = location && parts.every(part => LOCATION_PARTS.includes(part)) ? `für ${location} ` : "";
  return `${partList(parts, location)}. Sie stehen unter jeder Erinnerung und Kampagne an deine Kunden. Bis dahin gehen ${only}keine Erinnerungen und Kampagnen raus.`;
}
/** The server's refusal (ADDRESS_REQUIRED): no menu path. */
export const missingRefusal = (parts: readonly SenderPart[]) => `${MISSING_TITLE} ${partList(parts)}. Bis dahin gehen keine Erinnerungen und Kampagnen raus.`;

// ---- Normalising and checking: the owner types freely, and what is stored, previewed and printed is the normal form ----

const HAS_CONTROL = /\p{Cc}/u;
const REGISTERS = ["HRA", "HRB", "GnR", "GsR", "PR", "VR"];
export const normalizeText = (value: string) => value.trim();
/** „hrb12345“ → „HRB 12345“; anything that is no register number comes back trimmed, for the check to name. */
export function normalizeRegisterNumber(value: string) {
  const match = /^(hra|hrb|gnr|gsr|pr|vr)\s*(\d{1,6})(?:\s*([a-z]{1,2}))?$/i.exec(value.trim());
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
    // Legal, 1 Nov: an email is required, the phone is optional and checked only when given.
    contactEmail: !email ? "Bitte gib die E-Mail-Adresse ein." : EMAIL.test(email) && email.length <= 320 ? "" : "Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.",
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
  // A registered legal form needs its register entry (Legal, 1 Nov); other forms keep the pair rule (E21).
  const registered = registeredForm(draft.legalForm);
  return {
    legalForm: optionalLine(draft.legalForm, 40),
    registerCourt: !court && registered ? "Bitte gib das Registergericht ein, z. B. Amtsgericht Kassel. Für deine Rechtsform ist es Pflicht."
      : !court && number ? "Zur Registernummer gehört das Registergericht, z. B. Amtsgericht Kassel." : optionalLine(court, 120),
    registerNumber: !number && registered ? "Bitte gib die Registernummer ein, z. B. HRB 12345. Für deine Rechtsform ist sie Pflicht."
      : court && !number ? "Zum Registergericht gehört die Nummer, z. B. HRB 12345."
      : number && !/^(HRA|HRB|GnR|GsR|PR|VR) \d{1,6}( [A-Z]{1,2})?$/.test(number) ? "Bitte gib die Registernummer so an, wie sie im Register steht, z. B. HRB 12345." : "",
    // German IDs are DE and 9 digits (Design, 1 Nov); other EU prefixes keep the general form.
    vatId: !vat ? "" : vat.startsWith("DE") ? (/^DE\d{9}$/.test(vat) ? "" : "Eine deutsche USt-IdNr. besteht aus DE und 9 Ziffern, z. B. DE123456789.")
      : /^[A-Z]{2}[0-9A-Z]{8,12}$/.test(vat) ? "" : "Bitte prüfe die USt-IdNr.",
  };
}

export const firstProblem = (problems: Record<string, string>) => Object.values(problems).find(Boolean) ?? "";

// ---- The shop's name in mail (ENG-285) ----

// Anyone can register a shop and its name reaches strangers' inboxes, so it may carry no link (`://`, `www.`, a dotted
// domain like x.de) and no phone number (six or more digits, a few non-letters such as spaces, dots or brackets between
// them). Tested on the NFKC form without invisible format characters, so full-width or zero-width tricks don't slip by.
const NAME_LINK = /:\/\/|www[.。]|[\p{L}\p{Nd}-][.。]\p{L}{2,}(?![\p{L}\p{Nd}])/iu;
const NAME_PHONE = /\p{Nd}(?:[^\p{L}\p{Nd}]{0,3}\p{Nd}){5}/u;
export function unsafeShopName(name: string) {
  const plain = name.normalize("NFKC").replace(/\p{Cf}/gu, "");
  return NAME_LINK.test(plain) || NAME_PHONE.test(plain);
}
export const SHOP_NAME_REFUSAL = "Der Name deines Geschäfts darf keine Links und keine Telefonnummern enthalten.";

// ---- Legal's footer ----

/** The display name in front of Loynara's sender address: the shop, as every mail to its customers shows it. */
export const senderName = (shopName: string) => `${shopName} via Loynara`;

/**
 * The footer's parts, Legal's text verbatim: the identity sentence, the register and VAT lines only when filled, then the
 * consent line. Null while a required part is missing: such a shop sends nothing promotional. Never a card link.
 */
export function senderFooter(sender: SenderDetails) {
  if (missingParts(sender).length) return null;
  const legalForm = printedForm(sender.legalForm) ? `, ${sender.legalForm}` : "";
  const contact = [sender.contactEmail, sender.contactPhone].filter(Boolean).join(", ");
  return {
    fromName: senderName(sender.shopName),
    identity: `Diese E-Mail kommt von ${sender.shopName}${legalForm}, vertreten durch ${sender.representative}, ${sender.street}, ${sender.postalCode} ${sender.city}. Kontakt: ${contact}.`,
    register: sender.registerCourt && sender.registerNumber ? `Registergericht: ${sender.registerCourt}, ${sender.registerNumber}.` : null,
    vat: sender.vatId ? `USt-IdNr.: ${sender.vatId}` : null,
    consent: `Du bekommst diese E-Mail, weil du auf deiner Karte E-Mails von ${sender.shopName} bestellt hast.`,
  };
}

export type PreviewPiece = { text: string; missing?: true };
/**
 * The footer for the owner's previews (Design, 1 Nov): the same text, never withheld. A missing part shows as its field's
 * name, for the screen to mute, so the preview stays while the owner fills the parts in (A09b). Sending keeps senderFooter's gate.
 */
export function footerPreview(sender: SenderDetails) {
  const part = (value: string | null | undefined, label: string): PreviewPiece => value?.trim() ? { text: value.trim() } : { text: label, missing: true };
  const form = printedForm(sender.legalForm);
  // Marketing's placeholders (round 6): the address is one slot, so a half-filled one reads „Anschrift fehlt“ once.
  const address: PreviewPiece = sender.street?.trim() && sender.postalCode?.trim() && sender.city.trim()
    ? { text: `${sender.street.trim()}, ${sender.postalCode.trim()} ${sender.city.trim()}` } : { text: "Anschrift fehlt", missing: true };
  const identity: PreviewPiece[] = [{ text: `Diese E-Mail kommt von ${sender.shopName}${form ? `, ${form}` : ""}, vertreten durch ` }, part(sender.representative, "Name fehlt"),
    { text: ", " }, address, { text: ". Kontakt: " }, part(sender.contactEmail, "E-Mail-Adresse fehlt"), ...(sender.contactPhone?.trim() ? [{ text: `, ${sender.contactPhone.trim()}` }] : []), { text: "." }];
  const court = sender.registerCourt?.trim(), number = sender.registerNumber?.trim();
  const register: PreviewPiece[] | null = court || number || registeredForm(sender.legalForm)
    ? [{ text: "Registergericht: " }, part(court, "Registergericht fehlt"), { text: ", " }, part(number, "Registernummer fehlt"), { text: "." }] : null;
  return { identity, register, vat: sender.vatId ? `USt-IdNr.: ${sender.vatId}` : null, consent: `Du bekommst diese E-Mail, weil du auf deiner Karte E-Mails von ${sender.shopName} bestellt hast.` };
}
export const pieceText = (pieces: readonly PreviewPiece[]) => pieces.map(piece => piece.text).join("");

/** The footer as the mail prints it. */
export function footerText(footer: NonNullable<ReturnType<typeof senderFooter>>, unsubscribeLink: string, privacyUrl: string) {
  return `${[footer.identity, footer.register, footer.vat].filter(Boolean).join(" ")}\n${footer.consent} Abmelden: ${unsubscribeLink} · Datenschutz: ${privacyUrl}`;
}
