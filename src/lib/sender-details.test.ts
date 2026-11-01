import { describe, expect, it } from "vitest";
import { addressProblems, contactProblems, footerText, missingParts, missingSentence, normalizeRegisterNumber, normalizeVatId, partList, registerProblems, representativeProblems, senderFooter, type SenderDetails } from "./sender-details";

const complete: SenderDetails = {
  shopName: "Café Lindenblatt", street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Mara Lind",
  contactEmail: "info@cafe-lindenblatt.de", contactPhone: "0561 739 2214", legalForm: "e.K.", registerCourt: "Amtsgericht Kassel", registerNumber: "HRA 18342", vatId: "DE298417365",
};

describe("required parts (ENG-164)", () => {
  it("names each missing part once, a location's parts with the location when asked", () => {
    expect(missingParts(complete)).toEqual([]);
    expect(missingParts({ ...complete, street: null, contactEmail: null, contactPhone: " ", representative: null })).toEqual(["address", "contact", "representative"]);
    expect(missingParts({ ...complete, contactEmail: null })).toEqual([]);
    expect(partList(["address", "representative"])).toBe("Anschrift und „Vertreten durch“");
    expect(partList(["address"], "Kassel Nord")).toBe("Anschrift für Kassel Nord");
    expect(partList(["address", "contact", "representative"], "Kassel Nord")).toBe("Anschrift für Kassel Nord, Kontakt für Kassel Nord und „Vertreten durch“");
    expect(missingSentence(["address"], "Kassel Nord")).toBe("Anschrift für Kassel Nord. Sie stehen unter jeder E-Mail an deine Kundschaft; bis dahin geht keine E-Mail raus.");
  });
});

describe("the screens' rules, the same on the server", () => {
  it("checks the address", () => {
    expect(addressProblems({ street: "Friedrich-Ebert-Straße 12", postalCode: " 34117 ", city: "Kassel" })).toEqual({ street: "", postalCode: "", city: "" });
    expect(addressProblems({ street: "", postalCode: "3411", city: "" })).toEqual({
      street: "Bitte gib Straße und Hausnummer ein.", postalCode: "Die PLZ hat fünf Ziffern, z. B. 34117.", city: "Bitte gib die Stadt ein." });
    expect(addressProblems({ street: "Hauptstr. 1\nAngebote abbestellen", postalCode: "34117", city: "Kassel" }).street).toBe("Bitte prüfe diese Eingabe.");
  });
  it("needs an email or a phone, and checks each one given", () => {
    expect(contactProblems({ contactEmail: "", contactPhone: "" }).contact).toBe("Gib eine E-Mail-Adresse oder eine Telefonnummer ein.");
    expect(contactProblems({ contactEmail: "name@beispiel.de", contactPhone: "" })).toEqual({ contact: "", contactEmail: "", contactPhone: "" });
    expect(contactProblems({ contactEmail: "kein-at", contactPhone: "" }).contactEmail).toBe("Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.");
    expect(contactProblems({ contactEmail: "", contactPhone: "0561" }).contactPhone).toBe("Die Telefonnummer ist zu kurz, z. B. 0561 739 2214.");
    expect(contactProblems({ contactEmail: "", contactPhone: "ruf an 0561 739" }).contactPhone).toBe("Bitte prüfe die Telefonnummer, z. B. 0561 739 2214.");
    expect(contactProblems({ contactEmail: "", contactPhone: "+49 561 739 2214" }).contactPhone).toBe("");
  });
  it("needs a representative", () => {
    expect(representativeProblems({ representative: " " }).representative).toBe("Bitte gib an, wer dein Geschäft vertritt.");
    expect(representativeProblems({ representative: "Mara Lind" }).representative).toBe("");
  });
  it("normalises register and VAT IDs quietly, and names the wrong ones", () => {
    expect(normalizeRegisterNumber("hrb12345")).toBe("HRB 12345");
    expect(normalizeRegisterNumber(" gnr 7 b ")).toBe("GnR 7 B");
    expect(normalizeVatId(" de 298 417 365 ")).toBe("DE298417365");
    const empty = { legalForm: "", registerCourt: "", registerNumber: "", vatId: "" };
    expect(registerProblems(empty)).toEqual({ legalForm: "", registerCourt: "", registerNumber: "", vatId: "" });
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel", registerNumber: "hrb12345", vatId: "de 298 417 365" })).toEqual({ legalForm: "", registerCourt: "", registerNumber: "", vatId: "" });
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel" }).registerNumber).toBe("Zum Registergericht gehört die Nummer, z. B. HRB 12345.");
    expect(registerProblems({ ...empty, registerNumber: "HRB 1" }).registerCourt).toBe("Zur Registernummer gehört das Registergericht, z. B. Amtsgericht Kassel.");
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel", registerNumber: "12345" }).registerNumber).toBe("Bitte gib die Nummer mit dem Register an, z. B. HRB 12345.");
    // German IDs are DE and 9 digits; other EU prefixes keep the general form.
    expect(registerProblems({ ...empty, vatId: "DE12345678" }).vatId).toBe("Eine deutsche USt-IdNr. ist DE und 9 Ziffern, z. B. DE123456789.");
    expect(registerProblems({ ...empty, vatId: "DE1234567890" }).vatId).toBe("Eine deutsche USt-IdNr. ist DE und 9 Ziffern, z. B. DE123456789.");
    expect(registerProblems({ ...empty, vatId: "ATU12345678" }).vatId).toBe("");
    expect(registerProblems({ ...empty, vatId: "123456789" }).vatId).toBe("Bitte prüfe die USt-IdNr.");
  });
});

describe("Legal's footer", () => {
  it("is the mail's text, with optional parts only when filled, and nothing while a required part is missing", () => {
    const footer = senderFooter(complete)!;
    expect(footerText(footer, "https://u.test/x", "https://app.test/datenschutz")).toBe(
      "Diese E-Mail kommt von Café Lindenblatt, e.K., vertreten durch Mara Lind, Friedrich-Ebert-Straße 12, 34117 Kassel. Kontakt: info@cafe-lindenblatt.de, 0561 739 2214. Registergericht: Amtsgericht Kassel, HRA 18342. USt-IdNr.: DE298417365\n"
      + "Du bekommst diese E-Mail, weil du auf deiner Karte E-Mails von Café Lindenblatt bestellt hast. Abmelden: https://u.test/x · Datenschutz: https://app.test/datenschutz");
    expect(footer.fromName).toBe("Café Lindenblatt via Loynara");
    expect(senderFooter({ ...complete, legalForm: null, registerCourt: null, registerNumber: null, vatId: null })).toMatchObject({ register: null, vat: null });
    expect(senderFooter({ ...complete, representative: null })).toBeNull();
  });
});
