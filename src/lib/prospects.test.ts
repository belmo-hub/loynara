import { describe, expect, it } from "vitest";

import { exportProspectsCsv, generateRequestedInfoDraft, importProspectsCsv, promotionalSendEligibility } from "./prospects";

const header = "business_name,category,city,country,official_website,source_url,public_business_email,public_contact_source_url,retrieved_at,verified_fit_fact,fit_fact_source_url,loyalty_pos_status,loyalty_pos_note,loyalty_pos_source_url,contact_consent_status,permission_evidence,permission_reviewed_by,permission_reviewed_at,suppression_status,next_permitted_action,draft_message,draft_review_status";

const synthetic = {
  business_name: "Synthetic Café North",
  category: "cafe",
  city: "Kassel",
  country: "DE",
  official_website: "https://example.com",
  source_url: "https://example.com/about",
  public_business_email: "info@example.com",
  public_contact_source_url: "https://example.com/contact",
  retrieved_at: "2026-09-25",
  verified_fit_fact: "Offers a weekday lunch menu",
  fit_fact_source_url: "https://example.com/menu",
  loyalty_pos_status: "UNKNOWN",
  loyalty_pos_note: "",
  loyalty_pos_source_url: "",
  contact_consent_status: "CONSENT_UNKNOWN",
  permission_evidence: "",
  permission_reviewed_by: "",
  permission_reviewed_at: "",
  suppression_status: "NONE",
  next_permitted_action: "SEEK_PERMISSION_IN_PERSON",
  draft_message: "",
  draft_review_status: "PENDING",
};

function row(overrides: Partial<typeof synthetic> = {}) {
  const fields = { ...synthetic, ...overrides };
  return Object.values(fields).join(",");
}

describe("prospect CSV import", () => {
  it("defaults an imported address to unknown consent despite a claimed permission in the file", () => {
    const claimedPermission = row({
      contact_consent_status: "EXPRESS_PERMISSION",
      permission_evidence: "Imported list says yes",
      permission_reviewed_by: "Someone",
      permission_reviewed_at: "2026-09-24",
      next_permitted_action: "SEND_NOW",
      draft_review_status: "APPROVED",
    });

    const result = importProspectsCsv(`${header}\n${claimedPermission}`, { targetCountry: "DE" });

    expect(result.issues).toEqual([]);
    expect(result.prospects).toHaveLength(1);
    expect(result.prospects[0]).toMatchObject({
      businessName: "Synthetic Café North",
      publicBusinessEmail: "info@example.com",
      contactConsentStatus: "CONSENT_UNKNOWN",
      permissionEvidence: "",
      permissionReviewedBy: "",
      draftReviewStatus: "PENDING",
      nextPermittedAction: "SEEK_PERMISSION_IN_PERSON",
    });
  });

  it("rejects contact addresses without an evidence URL for publication", () => {
    const result = importProspectsCsv(`${header}\n${row({ public_contact_source_url: "" })}`, { targetCountry: "DE" });

    expect(result.prospects).toEqual([]);
    expect(result.issues).toContainEqual({ row: 2, reason: "Published contact source URL required" });
  });

  it("rejects missing core identity and invalid URLs or dates", () => {
    const result = importProspectsCsv(`${header}\n${row({ business_name: "" })}\n${row({ source_url: "javascript:alert(1)" })}\n${row({ retrieved_at: "25/09/2026" })}`, { targetCountry: "DE" });

    expect(result.prospects).toEqual([]);
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      "Business name, category and city required",
      "Invalid source URL",
      "Invalid retrieval date",
    ]);
  });

  it("requires a separately selected Moroccan geography", () => {
    const input = `${header}\n${row({ country: "MA", city: "Casablanca" })}`;

    expect(importProspectsCsv(input, { targetCountry: "DE" }).issues).toContainEqual({
      row: 2,
      reason: "Country does not match selected geography",
    });
    expect(importProspectsCsv(input, { targetCountry: "MA" }).prospects).toHaveLength(1);
  });

  it("preserves suppression from the file or a separate suppression list", () => {
    const suppressedInFile = importProspectsCsv(`${header}\n${row({ suppression_status: "SUPPRESSED" })}`, { targetCountry: "DE" });
    const suppressedExternally = importProspectsCsv(`${header}\n${row()}`, {
      targetCountry: "DE",
      suppressedContacts: ["INFO@EXAMPLE.COM"],
    });

    for (const result of [suppressedInFile, suppressedExternally]) {
      expect(result.prospects[0]).toMatchObject({
        suppressionStatus: "SUPPRESSED",
        nextPermittedAction: "DO_NOT_CONTACT",
      });
    }
  });

  it("rejects duplicates by business and location, domain, or contact", () => {
    const first = importProspectsCsv(`${header}\n${row()}`, { targetCountry: "DE" }).prospects[0];
    const input = [
      header,
      row({ business_name: "synthetic café north" }),
      row({ business_name: "Synthetic Bakery", official_website: "https://example.com/new" }),
      row({ business_name: "Synthetic Takeaway", official_website: "https://elsewhere.example", public_business_email: "info@example.com" }),
    ].join("\n");

    const result = importProspectsCsv(input, { targetCountry: "DE", existing: [first] });

    expect(result.prospects).toEqual([]);
    expect(result.issues.map((issue) => issue.reason)).toEqual([
      "Possible duplicate prospect",
      "Possible duplicate prospect",
      "Possible duplicate prospect",
    ]);
  });

  it("round trips quoted commas and line breaks, and escapes spreadsheet formulas on export", () => {
    const input = `${header}\n"Synthetic Café, North",cafe,Kassel,DE,https://example.com,https://example.com/about,info@example.com,https://example.com/contact,2026-09-25,"Has lunch, tea\nand cake",https://example.com/menu,UNKNOWN,,,,,,,NONE,,,PENDING`;
    const imported = importProspectsCsv(input, { targetCountry: "DE" });

    expect(imported.issues).toEqual([]);
    expect(imported.prospects[0].verifiedFitFact).toBe("Has lunch, tea\nand cake");
    const exported = exportProspectsCsv([{ ...imported.prospects[0], businessName: "=HYPERLINK(\"https://evil.example\")" }]);
    expect(exported).toContain("'=HYPERLINK");
    expect(exported).toContain('"Has lunch, tea\nand cake"');
    expect(exported).toContain("next_permitted_action");
    expect(exported).toContain("SEEK_PERMISSION_IN_PERSON");
  });
});

describe("outreach review", () => {
  const imported = importProspectsCsv(`${header}\n${row()}`, { targetCountry: "DE" }).prospects[0];

  it("never treats an imported address as eligible for promotional sending", () => {
    expect(promotionalSendEligibility(imported)).toEqual({ eligible: false, reason: "CONSENT_UNKNOWN" });
  });

  it("requires documented permission, reviewer, and approved draft before eligibility", () => {
    const claimed = { ...imported, contactConsentStatus: "EXPRESS_PERMISSION" as const };
    expect(promotionalSendEligibility(claimed).eligible).toBe(false);

    const reviewed = {
      ...claimed,
      permissionEvidence: "Synthetic inbound permission record #1",
      permissionReviewedBy: "Synthetic reviewer",
      permissionReviewedAt: "2026-09-25",
      draftMessage: "Synthetic approved message",
      draftReviewStatus: "APPROVED" as const,
    };
    expect(promotionalSendEligibility(reviewed)).toEqual({ eligible: true, reason: "REVIEWED" });
    expect(promotionalSendEligibility({ ...reviewed, suppressionStatus: "SUPPRESSED" })).toEqual({
      eligible: false,
      reason: "SUPPRESSED",
    });
  });

  it("does not treat a request for product information as general marketing consent", () => {
    const request = {
      ...imported,
      contactConsentStatus: "REQUESTED_INFO" as const,
      permissionEvidence: "Synthetic inbound request #1",
      permissionReviewedBy: "Synthetic reviewer",
      permissionReviewedAt: "2026-09-25",
      draftMessage: "Synthetic approved reply",
      draftReviewStatus: "APPROVED" as const,
    };

    expect(promotionalSendEligibility(request).eligible).toBe(false);
    expect(generateRequestedInfoDraft(request, "de").body).toContain("Offers a weekday lunch menu");
    expect(generateRequestedInfoDraft(request, "fr").body).toContain("Synthetic Café North");
  });

  it("refuses a requested-information draft without documented request and excludes inferred notes", () => {
    expect(() => generateRequestedInfoDraft(imported, "de")).toThrow("Documented information request required");
    const request = {
      ...imported,
      contactConsentStatus: "REQUESTED_INFO" as const,
      permissionEvidence: "Synthetic inbound request #2",
      permissionReviewedBy: "Synthetic reviewer",
      permissionReviewedAt: "2026-09-25",
      loyaltyPosStatus: "INFERRED" as const,
      loyaltyPosNote: "Maybe uses no loyalty system",
      verifiedFitFact: "",
      fitFactSourceUrl: "",
    };
    const draft = generateRequestedInfoDraft(request, "de");

    expect(draft.body).not.toContain("Maybe uses no loyalty system");
    expect(draft.body).not.toContain("Offers a weekday lunch menu");
    expect(draft.body).toContain("Loynara");
  });
});
