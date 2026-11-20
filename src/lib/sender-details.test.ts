import { describe, expect, it } from "vitest";
import { addressProblems, contactProblems, footerPreview, footerText, LEGAL_FORMS, pieceText, missingParts, missingRefusal, missingSentence, registeredForm, normalizeRegisterNumber, normalizeVatId, partList, registerProblems, representativeProblems, senderFooter, type SenderDetails, unsafeShopName } from "./sender-details";

const complete: SenderDetails = {
  shopName: "Café Lindenblatt", street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Mara Lind",
  contactEmail: "info@cafe-lindenblatt.de", contactPhone: "0561 739 2214", legalForm: "e.K.", registerCourt: "Amtsgericht Kassel", registerNumber: "HRA 18342", vatId: "DE298417365",
};

describe("required parts (ENG-164)", () => {
  it("names each missing part once, a location's parts with the location when asked", () => {
    expect(missingParts(complete)).toEqual([]);
    expect(missingParts({ ...complete, street: null, contactEmail: null, contactPhone: " ", representative: null })).toEqual(["address", "contact", "representative"]);
    expect(partList(["address", "representative"])).toBe("Anschrift und „Vertreten durch“");
    expect(partList(["address"], "Kassel Nord")).toBe("Anschrift für Kassel Nord");
    expect(partList(["address", "contact", "representative"], "Kassel Nord")).toBe("Anschrift für Kassel Nord, Kontakt für Kassel Nord und „Vertreten durch“");
    // Legal's wording (1 Nov): E24, E41 (one location's parts: sends wait for that location alone) and the API refusal.
    expect(missingSentence(["address", "representative"])).toBe("Anschrift und „Vertreten durch“. Sie stehen unter jeder Erinnerung und Kampagne an deine Kunden. Bis dahin gehen keine Erinnerungen und Kampagnen raus.");
    expect(missingSentence(["address"], "Kassel Nord")).toBe("Anschrift für Kassel Nord. Sie stehen unter jeder Erinnerung und Kampagne an deine Kunden. Bis dahin gehen für Kassel Nord keine Erinnerungen und Kampagnen raus.");
    expect(missingSentence(["address", "representative"], "Kassel Nord")).toBe("Anschrift für Kassel Nord und „Vertreten durch“. Sie stehen unter jeder Erinnerung und Kampagne an deine Kunden. Bis dahin gehen keine Erinnerungen und Kampagnen raus.");
    expect(missingRefusal(["contact"])).toBe("Es fehlen noch Angaben für den Absender: Kontakt. Bis dahin gehen keine Erinnerungen und Kampagnen raus.");
  });
});

describe("the screens' rules, the same on the server", () => {
  it("checks the address", () => {
    expect(addressProblems({ street: "Friedrich-Ebert-Straße 12", postalCode: " 34117 ", city: "Kassel" })).toEqual({ street: "", postalCode: "", city: "" });
    expect(addressProblems({ street: "", postalCode: "3411", city: "" })).toEqual({
      street: "Bitte gib Straße und Hausnummer ein.", postalCode: "Die PLZ hat fünf Ziffern, z. B. 34117.", city: "Bitte gib die Stadt ein." });
    expect(addressProblems({ street: "Hauptstr. 1\nAngebote abbestellen", postalCode: "34117", city: "Kassel" }).street).toBe("Bitte prüfe diese Eingabe.");
  });
  it("needs an email at every location; the phone is optional and checked when given (Legal, 1 Nov: § 5 DDG)", () => {
    expect(contactProblems({ contactEmail: "", contactPhone: "" })).toEqual({ contactEmail: "Bitte gib die E-Mail-Adresse ein.", contactPhone: "" });
    expect(contactProblems({ contactEmail: "", contactPhone: "0561 739 2214" }).contactEmail).toBe("Bitte gib die E-Mail-Adresse ein.");
    expect(contactProblems({ contactEmail: "name@beispiel.de", contactPhone: "" })).toEqual({ contactEmail: "", contactPhone: "" });
    expect(contactProblems({ contactEmail: "kein-at", contactPhone: "" }).contactEmail).toBe("Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.");
    expect(contactProblems({ contactEmail: "name@beispiel.de", contactPhone: "0561" }).contactPhone).toBe("Die Telefonnummer ist zu kurz, z. B. 0561 739 2214.");
    expect(contactProblems({ contactEmail: "name@beispiel.de", contactPhone: "ruf an 0561 739" }).contactPhone).toBe("Bitte prüfe die Telefonnummer, z. B. 0561 739 2214.");
    expect(contactProblems({ contactEmail: "name@beispiel.de", contactPhone: "+49 561 739 2214" }).contactPhone).toBe("");
    // A phone alone no longer completes the sender.
    expect(missingParts({ ...complete, contactEmail: null })).toEqual(["contact"]);
  });
  it("needs the register entry exactly when the legal form is a registered one (Legal, 1 Nov)", () => {
    for (const form of ["GmbH", "GmbH & Co. KG", "UG (haftungsbeschränkt)", "e. K.", "e.K.", "eK", "OHG", "PartG mbB", "eG", "AG", "KG", "e.Kfm.", "eingetragener Kaufmann", "Eingetragene Kauffrau", "eGbR", "KGaA", "GmbH & Co. KGaA", "e.Kfr.", "e. Kfm.", "gGmbH", "gUG (haftungsbeschränkt)", "SE"])
      expect(registeredForm(form), form).toBe(true);
    for (const form of ["", "Einzelunternehmen", "GbR", "Freiberufler", "Tagescafé", "Bäckerei Krug", "Seifenladen"]) expect(registeredForm(form), form).toBe(false);
    // Still being founded: no register entry yet, so court and number stay optional.
    for (const form of ["GmbH i.G.", "UG (haftungsbeschränkt) i. G.", "GmbH in Gründung", "GmbH i.G"]) expect(registeredForm(form), form).toBe(false);
    const empty = { legalForm: "", registerCourt: "", registerNumber: "", vatId: "" };
    expect(registerProblems({ ...empty, legalForm: "GmbH" })).toMatchObject({
      registerCourt: "Bitte gib das Registergericht ein, z. B. Amtsgericht Kassel. Für deine Rechtsform ist es Pflicht.",
      registerNumber: "Bitte gib die Registernummer ein, z. B. HRB 12345. Für deine Rechtsform ist sie Pflicht." });
    // Other forms keep the pair rule (E21) and stay optional.
    for (const legalForm of ["", "Einzelunternehmen", "GbR", "Freiberufler"]) expect(registerProblems({ ...empty, legalForm }), legalForm).toMatchObject({ registerCourt: "", registerNumber: "" });
    expect(registerProblems({ ...empty, legalForm: "GmbH", registerCourt: "Amtsgericht Kassel", registerNumber: "HRB 1" })).toMatchObject({ registerCourt: "", registerNumber: "" });
    // A registered form says „Pflicht“ even when the other half is filled (A09b); the pair rule is for the other forms.
    expect(registerProblems({ ...empty, legalForm: "e.K.", registerCourt: "Amtsgericht Kassel" }).registerNumber).toBe("Bitte gib die Registernummer ein, z. B. HRB 12345. Für deine Rechtsform ist sie Pflicht.");
    expect(registerProblems({ ...empty, legalForm: "GbR", registerCourt: "Amtsgericht Kassel" }).registerNumber).toBe("Zum Registergericht gehört die Nummer, z. B. HRB 12345.");
    expect(registerProblems({ ...empty, legalForm: "Einzelunternehmen" })).toMatchObject({ registerCourt: "", registerNumber: "" });
    expect(missingParts({ ...complete, legalForm: "UG (haftungsbeschränkt)", registerCourt: null, registerNumber: null })).toEqual(["registerCourt", "registerNumber"]);
    expect(missingParts({ ...complete, legalForm: "GmbH", registerCourt: "Amtsgericht Kassel", registerNumber: null })).toEqual(["registerNumber"]);
    expect(missingParts({ ...complete, legalForm: "Einzelunternehmen", registerCourt: null, registerNumber: null })).toEqual([]);
    // The box and refusal name „Registergericht und Registernummer“, or the one missing (Marketing, round 3).
    expect(missingRefusal(["registerCourt", "registerNumber"])).toBe("Es fehlen noch Angaben für den Absender: Registergericht und Registernummer. Bis dahin gehen keine Erinnerungen und Kampagnen raus.");
    expect(missingSentence(["address", "registerNumber"], "Kassel Nord")).toBe("Anschrift für Kassel Nord und Registernummer. Sie stehen unter jeder Erinnerung und Kampagne an deine Kunden. Bis dahin gehen keine Erinnerungen und Kampagnen raus.");
    expect(senderFooter({ ...complete, legalForm: "GmbH", registerCourt: null, registerNumber: null })).toBeNull();
  });
  it("needs a representative", () => {
    expect(representativeProblems({ representative: " " }).representative).toBe("Bitte gib an, wer dein Geschäft vertritt.");
    expect(representativeProblems({ representative: "Mara Lind" }).representative).toBe("");
  });
  it("normalises register and VAT IDs quietly, and names the wrong ones", () => {
    expect(normalizeRegisterNumber("hrb12345")).toBe("HRB 12345");
    expect(normalizeRegisterNumber("HRB  12345")).toBe("HRB 12345");
    expect(normalizeRegisterNumber("HRA \t7  b")).toBe("HRA 7 B");
    expect(normalizeRegisterNumber(" gnr 7 b ")).toBe("GnR 7 B");
    expect(normalizeVatId(" de 298 417 365 ")).toBe("DE298417365");
    const empty = { legalForm: "", registerCourt: "", registerNumber: "", vatId: "" };
    expect(registerProblems(empty)).toEqual({ legalForm: "", registerCourt: "", registerNumber: "", vatId: "" });
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel", registerNumber: "hrb12345", vatId: "de 298 417 365" })).toEqual({ legalForm: "", registerCourt: "", registerNumber: "", vatId: "" });
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel" }).registerNumber).toBe("Zum Registergericht gehört die Nummer, z. B. HRB 12345.");
    expect(registerProblems({ ...empty, registerNumber: "HRB 1" }).registerCourt).toBe("Zur Registernummer gehört das Registergericht, z. B. Amtsgericht Kassel.");
    expect(registerProblems({ ...empty, registerCourt: "Amtsgericht Kassel", registerNumber: "12345" }).registerNumber).toBe("Bitte gib die Registernummer so an, wie sie im Register steht, z. B. HRB 12345.");
    // German IDs are DE and 9 digits; other EU prefixes keep the general form.
    expect(registerProblems({ ...empty, vatId: "DE12345678" }).vatId).toBe("Eine deutsche USt-IdNr. besteht aus DE und 9 Ziffern, z. B. DE123456789.");
    expect(registerProblems({ ...empty, vatId: "DE1234567890" }).vatId).toBe("Eine deutsche USt-IdNr. besteht aus DE und 9 Ziffern, z. B. DE123456789.");
    expect(registerProblems({ ...empty, vatId: "ATU12345678" }).vatId).toBe("");
    expect(registerProblems({ ...empty, vatId: "123456789" }).vatId).toBe("Bitte prüfe die USt-IdNr.");
  });
});

describe("the Rechtsform choices (Design, Marketing and Legal, 1 Nov)", () => {
  it("are the agreed list, and exactly the registered ones need court and number", () => {
    expect(LEGAL_FORMS.map(form => form.label)).toEqual(["Keine Angabe", "Einzelunternehmen (ohne Handelsregister)", "GbR", "eGbR", "e.K.", "GmbH", "UG (haftungsbeschränkt)",
      "GmbH & Co. KG", "KG", "KGaA", "OHG", "AG", "eG", "PartG", "PartG mbB"]);
    const registered = LEGAL_FORMS.filter(form => registeredForm(form.value)).map(form => form.value);
    expect(registered).toEqual(["eGbR", "e.K.", "GmbH", "UG (haftungsbeschränkt)", "GmbH & Co. KG", "KG", "KGaA", "OHG", "AG", "eG", "PartG", "PartG mbB"]);
  });
  it("prints no legal form for „Keine Angabe“ or „Einzelunternehmen“, and every other one after the name (A08b)", () => {
    expect(senderFooter({ ...complete, legalForm: null, registerCourt: null, registerNumber: null })!.identity).toMatch(/^Diese E-Mail kommt von Café Lindenblatt, vertreten durch/);
    expect(senderFooter({ ...complete, legalForm: "Einzelunternehmen", registerCourt: null, registerNumber: null })!.identity).toMatch(/^Diese E-Mail kommt von Café Lindenblatt, vertreten durch/);
    expect(senderFooter({ ...complete, legalForm: "GbR", registerCourt: null, registerNumber: null })!.identity).toMatch(/^Diese E-Mail kommt von Café Lindenblatt, GbR, vertreten durch/);
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

describe("the owner's footer preview (Design, 1 Nov)", () => {
  it("is the mail's text once everything is filled", () => {
    const preview = footerPreview(complete), mail = senderFooter(complete)!;
    expect(pieceText(preview.identity)).toBe(mail.identity);
    expect(pieceText(preview.register!)).toBe(mail.register);
    expect(preview.vat).toBe(mail.vat);
    expect(preview.identity.some(piece => piece.missing)).toBe(false);
  });
  it("never disappears: a missing part shows as its field's name, marked missing", () => {
    const preview = footerPreview({ ...complete, representative: null, street: null, contactEmail: null });
    // Marketing's placeholders (round 6), in the slot of the missing value; a half-filled address reads „Anschrift fehlt“ once.
    expect(preview.identity.filter(piece => piece.missing).map(piece => piece.text)).toEqual(["Name fehlt", "Anschrift fehlt", "E-Mail-Adresse fehlt"]);
    expect(pieceText(preview.identity)).toBe("Diese E-Mail kommt von Café Lindenblatt, e.K., vertreten durch Name fehlt, Anschrift fehlt. Kontakt: E-Mail-Adresse fehlt, 0561 739 2214.");
    // A09b: a registered form without its entry still shows the register line, with both halves to fill.
    const registered = footerPreview({ ...complete, legalForm: "GmbH", registerCourt: null, registerNumber: null });
    expect(registered.register!.filter(piece => piece.missing).map(piece => piece.text)).toEqual(["Registergericht fehlt", "Registernummer fehlt"]);
    expect(footerPreview({ ...complete, legalForm: "Einzelunternehmen", registerCourt: null, registerNumber: null }).register).toBeNull();
  });
});

describe("the shop's name in mail (ENG-285)", () => {
  it("refuses links and phone numbers, and keeps ordinary names", () => {
    for (const name of ["Bitte hier einloggen: https://evil.example/login", "Gewinn auf www.gewinn", "Café gewinn.de", "Pizza GEWINN.DE heute", "Ruf an 0900123456", "Ruf an 0900 123 456", "Tel 0561/73-92-21", "Shop ftp://x"])
      expect(unsafeShopName(name), name).toBe(true);
    for (const name of ["Café am Markt", "Pizzeria Da Mario 2000", "St. Pauli Bar", "Barber & Co. KG", "e.K. Friseur", "Salon 34117 Kassel", "Bäckerei Müller-Lüdenscheidt", "No. 1 Döner"])
      expect(unsafeShopName(name), name).toBe(false);
  });
});
