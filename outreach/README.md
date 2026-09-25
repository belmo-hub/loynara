# Outreach preparation (no sending)

This folder and `src/lib/prospects.ts` are a file-based preparation aid, separate from merchant and customer data. It contains **no real prospects**, sender account, scraping, email delivery, contact-form submission, or campaign activation. All names and addresses in code tests are synthetic.

## Workflow

1. Copy `prospects-template.csv`. Enter only necessary, publicly available business facts. Record the page URL and retrieval date. Enter an email only when a page actually publishes it, and record that exact page under `public_contact_source_url`. Never guess an address.
2. Choose `targetCountry: "DE"` for Kassel. Selecting `"MA"` is a separate import and requires its own outreach review. The importer rejects rows for any other country.
3. Import with `importProspectsCsv(csv, { targetCountry, existing, suppressedContacts })`. Inspect `issues`; rejected rows are not added. Possible duplicates are rejected for manual review if they share a business and location, website domain, or contact address. A shared domain may be legitimate across locations, so review rather than silently merging.
4. Every imported contact starts at `CONSENT_UNKNOWN`, `PENDING` draft review and an in-person permission step. Imported claims of consent, reviewer, approved draft, or a `SEND_NOW` action are discarded. The importer retains `SUPPRESSED` if it appears in the file or suppression list. It cannot unsuppress an address.
5. Filter the exported CSV by `next_permitted_action`, `suppression_status`, and `loyalty_pos_status` to prepare a manual qualification view. `exportProspectsCsv` quotes CSV correctly and escapes cells that could become spreadsheet formulas. Reimporting an export resets permission and draft approval intentionally.

```ts
import { importProspectsCsv, exportProspectsCsv } from "../src/lib/prospects";

const result = importProspectsCsv(csvText, {
  targetCountry: "DE",
  existing: previouslyReviewedRecords,
  suppressedContacts: suppressionAddresses,
});
const reviewFile = exportProspectsCsv(result.prospects);
```

## Review boundaries

`verified_fit_fact` and `fit_fact_source_url` go together. `loyalty_pos_status` is `VERIFIED`, `INFERRED`, or `UNKNOWN`; use `VERIFIED` only with a supporting URL. Never infer that a business lacks a programme simply because one was not found on a website. Draft generation includes only a sourced fit fact; it does not repeat loyalty/POS guesses.

`REQUESTED_INFO` means a documented inbound request for product details, **not** general promotional consent. `EXPRESS_PERMISSION` or `REVIEWED_EXCEPTION` requires an actual evidence record, reviewer, date, and approved message before `promotionalSendEligibility` returns true. This is a technical preparation check, not a legal opinion or a sending feature. German promotional sending also requires the applicable legal review. Moroccan outreach requires a separate geography-specific review. Suppression always wins.

No message may be sent from this module. Any future send operation must separately recheck suppression and eligibility at delivery time and receive approval for that specific campaign.
