export type ProspectCountry = "DE" | "MA";

export type Prospect = {
  businessName: string;
  category: string;
  city: string;
  country: ProspectCountry;
  officialWebsite: string;
  sourceUrl: string;
  publicBusinessEmail: string;
  publicContactSourceUrl: string;
  retrievedAt: string;
  verifiedFitFact: string;
  fitFactSourceUrl: string;
  loyaltyPosStatus: "VERIFIED" | "INFERRED" | "UNKNOWN";
  loyaltyPosNote: string;
  loyaltyPosSourceUrl: string;
  contactConsentStatus: "CONSENT_UNKNOWN" | "REQUESTED_INFO" | "EXPRESS_PERMISSION" | "REVIEWED_EXCEPTION";
  permissionEvidence: string;
  permissionReviewedBy: string;
  permissionReviewedAt: string;
  suppressionStatus: "NONE" | "SUPPRESSED";
  draftMessage: string;
  draftReviewStatus: "PENDING" | "APPROVED";
  nextPermittedAction: "SEEK_PERMISSION_IN_PERSON" | "IN_PERSON_DEMO_ONLY" | "DO_NOT_CONTACT" | "REVIEW_DRAFT";
};

export type ProspectImportIssue = { row: number; reason: string };

const headers = [
  "business_name", "category", "city", "country", "official_website", "source_url",
  "public_business_email", "public_contact_source_url", "retrieved_at", "verified_fit_fact",
  "fit_fact_source_url", "loyalty_pos_status", "loyalty_pos_note", "loyalty_pos_source_url",
  "contact_consent_status", "permission_evidence", "permission_reviewed_by", "permission_reviewed_at",
  "suppression_status", "next_permitted_action", "draft_message", "draft_review_status",
] as const;

type ImportOptions = {
  targetCountry: ProspectCountry;
  existing?: readonly Prospect[];
  suppressedContacts?: readonly string[];
};

type CsvRow = { row: number; cells: string[] };

function parseCsv(csv: string): CsvRow[] {
  const input = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const records: CsvRow[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  function finishRecord() {
    cells.push(cell);
    if (cells.some((value) => value !== "")) records.push({ row: recordLine, cells });
    cells = [];
    cell = "";
  }

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
        afterQuote = true;
      } else {
        cell += char;
        if (char === "\n") line++;
      }
    } else if (char === "," || char === "\n") {
      cells.push(cell);
      cell = "";
      afterQuote = false;
      if (char === "\n") {
        if (cells.some((value) => value !== "")) records.push({ row: recordLine, cells });
        cells = [];
        line++;
        recordLine = line;
      }
    } else if (char === '"') {
      if (cell !== "" || afterQuote) throw new Error(`Unexpected quote on line ${line}`);
      inQuotes = true;
    } else {
      if (afterQuote) throw new Error(`Unexpected character after quote on line ${line}`);
      cell += char;
    }
  }
  if (inQuotes) throw new Error(`Unterminated quoted field on line ${recordLine}`);
  if (cells.length > 0 || cell !== "") finishRecord();
  return records;
}

function validUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().startsWith(value);
}

function normalized(value: string): string {
  return value.trim().normalize("NFKC").toLocaleLowerCase("en");
}

function domain(value: string): string {
  if (!value) return "";
  return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
}

function duplicateOf(a: Prospect, b: Prospect): boolean {
  const sameBusinessLocation = normalized(a.businessName) === normalized(b.businessName)
    && normalized(a.city) === normalized(b.city) && a.country === b.country;
  const sameDomain = Boolean(a.officialWebsite && b.officialWebsite && domain(a.officialWebsite) === domain(b.officialWebsite));
  const sameContact = Boolean(a.publicBusinessEmail && b.publicBusinessEmail
    && normalized(a.publicBusinessEmail) === normalized(b.publicBusinessEmail));
  return sameBusinessLocation || sameDomain || sameContact;
}

export function importProspectsCsv(csv: string, options: ImportOptions): {
  prospects: Prospect[];
  issues: ProspectImportIssue[];
} {
  let rows: CsvRow[];
  try {
    rows = parseCsv(csv);
  } catch (error) {
    return { prospects: [], issues: [{ row: 1, reason: error instanceof Error ? error.message : "Malformed CSV" }] };
  }
  if (!rows[0] || rows[0].cells.join(",") !== headers.join(",")) {
    return { prospects: [], issues: [{ row: 1, reason: "Invalid header" }] };
  }
  const prospects: Prospect[] = [];
  const issues: ProspectImportIssue[] = [];
  const suppressedContacts = new Set((options.suppressedContacts ?? []).map(normalized));
  for (const { row, cells: rawCells } of rows.slice(1)) {
    const cells = rawCells.map((cell) => cell.trim());
    let reason = "";
    if (cells.length !== headers.length) reason = "Column count mismatch";
    else if (!cells[0] || !cells[1] || !cells[2]) reason = "Business name, category and city required";
    else if (cells[3] !== options.targetCountry) reason = "Country does not match selected geography";
    else if (cells[4] && !validUrl(cells[4])) reason = "Invalid official website URL";
    else if (!validUrl(cells[5])) reason = "Invalid source URL";
    else if (cells[6] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cells[6])) reason = "Invalid public business email";
    else if (cells[6] && !cells[7]) reason = "Published contact source URL required";
    else if (cells[7] && !validUrl(cells[7])) reason = "Invalid published contact source URL";
    else if (!validDate(cells[8])) reason = "Invalid retrieval date";
    else if (cells[9] && !cells[10]) reason = "Verified fit fact source URL required";
    else if (cells[10] && !validUrl(cells[10])) reason = "Invalid fit fact source URL";
    else if (!["VERIFIED", "INFERRED", "UNKNOWN"].includes(cells[11])) reason = "Invalid loyalty/POS status";
    else if (cells[11] === "VERIFIED" && !cells[13]) reason = "Verified loyalty/POS source URL required";
    else if (cells[13] && !validUrl(cells[13])) reason = "Invalid loyalty/POS source URL";
    else if (!["NONE", "SUPPRESSED"].includes(cells[18])) reason = "Invalid suppression status";
    if (reason) {
      issues.push({ row, reason });
      continue;
    }
    const suppressed = cells[18] === "SUPPRESSED" || suppressedContacts.has(normalized(cells[6]));
    const prospect: Prospect = {
      businessName: cells[0], category: cells[1], city: cells[2], country: options.targetCountry,
      officialWebsite: cells[4], sourceUrl: cells[5], publicBusinessEmail: cells[6],
      publicContactSourceUrl: cells[7], retrievedAt: cells[8], verifiedFitFact: cells[9],
      fitFactSourceUrl: cells[10], loyaltyPosStatus: cells[11] as Prospect["loyaltyPosStatus"],
      loyaltyPosNote: cells[12], loyaltyPosSourceUrl: cells[13],
      contactConsentStatus: "CONSENT_UNKNOWN", permissionEvidence: "", permissionReviewedBy: "",
      permissionReviewedAt: "", suppressionStatus: suppressed ? "SUPPRESSED" : "NONE", draftMessage: "",
      draftReviewStatus: "PENDING",
      nextPermittedAction: suppressed ? "DO_NOT_CONTACT" : cells[6] ? "SEEK_PERMISSION_IN_PERSON" : "IN_PERSON_DEMO_ONLY",
    };
    if ([...(options.existing ?? []), ...prospects].some((other) => duplicateOf(prospect, other))) {
      issues.push({ row, reason: "Possible duplicate prospect" });
      continue;
    }
    prospects.push(prospect);
  }
  return { prospects, issues };
}

function csvCell(value: string): string {
  const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  return /[,"\n\r]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function exportProspectsCsv(prospects: readonly Prospect[]): string {
  const lines = prospects.map((p) => [
    p.businessName, p.category, p.city, p.country, p.officialWebsite, p.sourceUrl,
    p.publicBusinessEmail, p.publicContactSourceUrl, p.retrievedAt, p.verifiedFitFact,
    p.fitFactSourceUrl, p.loyaltyPosStatus, p.loyaltyPosNote, p.loyaltyPosSourceUrl,
    p.contactConsentStatus, p.permissionEvidence, p.permissionReviewedBy, p.permissionReviewedAt,
    p.suppressionStatus, p.nextPermittedAction, p.draftMessage, p.draftReviewStatus,
  ].map(csvCell).join(","));
  return [headers.join(","), ...lines].join("\r\n") + "\r\n";
}

export function promotionalSendEligibility(prospect: Prospect): { eligible: boolean; reason: string } {
  if (prospect.suppressionStatus === "SUPPRESSED") return { eligible: false, reason: "SUPPRESSED" };
  if (!prospect.publicBusinessEmail) return { eligible: false, reason: "NO_PUBLISHED_CONTACT" };
  if (prospect.contactConsentStatus === "CONSENT_UNKNOWN") return { eligible: false, reason: "CONSENT_UNKNOWN" };
  if (prospect.contactConsentStatus === "REQUESTED_INFO") return { eligible: false, reason: "NOT_MARKETING_CONSENT" };
  if (!prospect.permissionEvidence.trim() || !prospect.permissionReviewedBy.trim() || !validDate(prospect.permissionReviewedAt)) {
    return { eligible: false, reason: "PERMISSION_REVIEW_REQUIRED" };
  }
  if (prospect.draftReviewStatus !== "APPROVED" || !prospect.draftMessage.trim()) {
    return { eligible: false, reason: "DRAFT_REVIEW_REQUIRED" };
  }
  return { eligible: true, reason: "REVIEWED" };
}

export function generateRequestedInfoDraft(prospect: Prospect, locale: "de" | "fr"): { subject: string; body: string } {
  if (prospect.contactConsentStatus !== "REQUESTED_INFO" || !prospect.permissionEvidence.trim()
    || !prospect.permissionReviewedBy.trim() || !validDate(prospect.permissionReviewedAt)
    || prospect.suppressionStatus === "SUPPRESSED") {
    throw new Error("Documented information request required");
  }
  const business = prospect.businessName.replace(/\s+/g, " ").trim();
  const fact = prospect.verifiedFitFact && validUrl(prospect.fitFactSourceUrl)
    ? prospect.verifiedFitFact.replace(/\s+/g, " ").trim()
    : "";
  if (locale === "de") {
    return {
      subject: `Ihre Anfrage zu Loynara – ${business}`,
      body: [
        "Guten Tag,",
        "",
        `vielen Dank für Ihre Anfrage zu Loynara für ${business}.`,
        fact ? `Mir ist zu Ihrem Betrieb diese veröffentlichte Angabe aufgefallen: ${fact} (Quelle: ${prospect.fitFactSourceUrl}).` : "",
        "Gern zeige ich Ihnen in einer kurzen Demo, wie ein digitales Treueprogramm für Ihren Betrieb eingerichtet und am Tresen genutzt werden kann.",
        "Falls Sie möchten, schicken Sie mir einen passenden Termin.",
        "",
        "Viele Grüße",
        "[Name und Unternehmen]",
      ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n"),
    };
  }
  return {
    subject: `Votre demande d’informations sur Loynara – ${business}`,
    body: [
      "Bonjour,",
      "",
      `Merci pour votre demande d’informations sur Loynara pour ${business}.`,
      fact ? `J’ai relevé cette information publique sur votre activité : ${fact} (source : ${prospect.fitFactSourceUrl}).` : "",
      "Je peux vous montrer, lors d’une courte démonstration, comment configurer un programme de fidélité numérique et l’utiliser au comptoir.",
      "Si vous le souhaitez, indiquez-moi un créneau qui vous convient.",
      "",
      "Cordialement,",
      "[Nom et entreprise]",
    ].filter((line, index, lines) => line !== "" || (index > 0 && lines[index - 1] !== "")).join("\n"),
  };
}
