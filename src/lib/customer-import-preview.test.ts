import { describe, expect, it } from "vitest";
import { previewSyntheticCsv, isLocalImportPreviewOrigin } from "./customer-import-preview";

const mapped = { externalId: "Legacy ID", email: "Email", balance: "Stamps", marketingConsent: "Marketing", consentSource: "Source", consentDate: "Date" };

describe("synthetic customer CSV preview", () => {
  it("maps quoted CSV values and reports consent claims without returning contact details", () => {
    const csv = 'Legacy ID,Email,Stamps,Marketing,Source,Date\r\n"SYN-001","ada@example.test",5,yes,paper_form,2026-09-20\r\nSYN-002,,0,no,,\r\n';
    const preview = previewSyntheticCsv(csv, mapped);
    expect(preview).toMatchObject({ total: 2, ready: 2, duplicates: 0, invalid: 0, writesPerformed: false });
    expect(preview.rows).toMatchObject([
      { line: 2, externalId: "SYN-001", balance: 5, status: "ready", consentClaim: "claimed_with_provenance", consentSource: "paper_form", consentDate: "2026-09-20" },
      { line: 3, externalId: "SYN-002", balance: 0, status: "ready", consentClaim: "not_granted" },
    ]);
    expect(JSON.stringify(preview)).not.toContain("ada@example.test");
  });

  it("marks repeated IDs or emails and invalid synthetic values without writing them", () => {
    const csv = [
      "legacy,email,balance,consent,source,date",
      "SYN-001,one@example.test,2,yes,paper_form,2026-09-20",
      "SYN-001,two@example.test,3,no,,",
      "SYN-003,one@example.test,4,no,,",
      "SYN-004,real@merchant.de,5,yes,,",
      "SYN-005,valid@example.test,-1,maybe,paper_form,2026-09-20",
    ].join("\n");
    const result = previewSyntheticCsv(csv, { externalId: "legacy", email: "email", balance: "balance", marketingConsent: "consent", consentSource: "source", consentDate: "date" });
    expect(result).toMatchObject({ total: 5, ready: 1, duplicates: 2, invalid: 2, writesPerformed: false });
    expect(result.rows.map(row => row.status)).toEqual(["ready", "duplicate", "duplicate", "invalid", "invalid"]);
    expect(result.rows[3].errors).toContain("Only example.test email addresses are allowed in this local synthetic preview");
    expect(result.rows[3].consentClaim).toBe("missing_provenance");
  });

  it("rejects malformed CSV, repeated headers, missing mappings, and oversized input", () => {
    expect(() => previewSyntheticCsv('id,email\n"SYN-001,a@example.test', { externalId: "id" })).toThrow(/quote/i);
    expect(() => previewSyntheticCsv("id,id\nSYN-001,x", { externalId: "id" })).toThrow(/header/i);
    expect(() => previewSyntheticCsv("id\nSYN-001", { externalId: "missing" })).toThrow(/mapping/i);
    expect(() => previewSyntheticCsv(`id\n${"SYN-001\n".repeat(101)}`, { externalId: "id" })).toThrow(/100/);
  });

  it("refuses unmapped nonempty cells so a hidden contact column cannot enter the preview", () => {
    const result = previewSyntheticCsv("id,private_name\nSYN-001,Real person", { externalId: "id" });
    expect(result.rows[0]).toMatchObject({ status: "invalid" });
    expect(result.rows[0].errors).toContain("Unmapped columns must be empty in a synthetic preview");
    expect(JSON.stringify(result)).not.toContain("Real person");
  });

  it("accepts only named synthetic provenance categories", () => {
    const result = previewSyntheticCsv("id,consent,source,date\nSYN-001,yes,person_name,2026-09-20", { externalId: "id", marketingConsent: "consent", consentSource: "source", consentDate: "date" });
    expect(result.rows[0]).toMatchObject({ status: "invalid", consentClaim: "missing_provenance", consentSource: null });
    expect(JSON.stringify(result)).not.toContain("person_name");
  });

  it("enables the preview only for an explicit loopback public origin", () => {
    expect(isLocalImportPreviewOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalImportPreviewOrigin("http://127.0.0.1:3001")).toBe(true);
    expect(isLocalImportPreviewOrigin("https://test.example.com")).toBe(false);
    expect(isLocalImportPreviewOrigin(undefined)).toBe(false);
  });
});
