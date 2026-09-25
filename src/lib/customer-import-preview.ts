export type ImportMapping = {
  externalId: string;
  email?: string;
  balance?: string;
  marketingConsent?: string;
  consentSource?: string;
  consentDate?: string;
};

export type ImportPreviewRow = {
  line: number;
  externalId: string | null;
  emailPresent: boolean;
  balance: number | null;
  status: "ready" | "duplicate" | "invalid";
  consentClaim: "unknown" | "not_granted" | "claimed_with_provenance" | "missing_provenance";
  consentSource: string | null;
  consentDate: string | null;
  errors: string[];
};

export type ImportPreview = {
  headers: string[];
  total: number;
  ready: number;
  duplicates: number;
  invalid: number;
  writesPerformed: false;
  rows: ImportPreviewRow[];
};

type RecordRow = { line: number; fields: string[] };

export class ImportPreviewError extends Error {
  constructor(message: string) { super(message); this.name = "ImportPreviewError"; }
}

export function isLocalImportPreviewOrigin(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
      !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  } catch { return false; }
}

function recordsOf(csv: string): RecordRow[] {
  const records: RecordRow[] = [];
  let fields: string[] = [];
  let field = "";
  let quoted = false;
  let afterQuote = false;
  let line = 1;
  let recordLine = 1;

  function finish() {
    fields.push(field);
    if (fields.some(value => value.trim() !== "")) records.push({ line: recordLine, fields });
    fields = [];
    field = "";
    afterQuote = false;
    recordLine = line + 1;
  }

  for (let index = 0; index < csv.length; index++) {
    const char = csv[index];
    if (quoted) {
      if (char === '"') {
        if (csv[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; afterQuote = true; }
      } else if (char === "\r" || char === "\n") {
        if (char === "\r" && csv[index + 1] === "\n") index++;
        field += "\n";
        line++;
      } else field += char;
    } else if (afterQuote) {
      if (char === ",") { fields.push(field); field = ""; afterQuote = false; }
      else if (char === "\r" || char === "\n") {
        if (char === "\r" && csv[index + 1] === "\n") index++;
        finish(); line++;
      } else if (char !== " " && char !== "\t") throw new ImportPreviewError(`Unexpected character after closing quote on line ${line}`);
    } else if (char === '"') {
      if (field !== "") throw new ImportPreviewError(`Unexpected quote on line ${line}`);
      quoted = true;
    } else if (char === ",") { fields.push(field); field = ""; }
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && csv[index + 1] === "\n") index++;
      finish(); line++;
    } else if (char === "\0") throw new ImportPreviewError("CSV contains a null character");
    else field += char;
  }
  if (quoted) throw new ImportPreviewError("Unclosed CSV quote");
  if (fields.length || field || afterQuote) finish();
  return records;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(`${value}T`) && parsed.getTime() <= Date.now();
}

export function previewSyntheticCsv(csv: string, mapping: ImportMapping): ImportPreview {
  if (Buffer.byteLength(csv, "utf8") > 64_000) throw new ImportPreviewError("CSV must be at most 64 KB");
  const records = recordsOf(csv);
  if (!records.length) throw new ImportPreviewError("CSV has no header row");
  if (records.length - 1 > 100) throw new ImportPreviewError("Preview supports at most 100 data rows");
  const headers = records[0].fields.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
  if (headers.length > 20 || headers.some(value => !value || value.length > 80) || new Set(headers.map(value => value.toLowerCase())).size !== headers.length) {
    throw new ImportPreviewError("CSV headers must be unique, nonempty, and at most 80 characters");
  }
  const selected = Object.entries(mapping).filter((entry): entry is [keyof ImportMapping, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  if (!mapping.externalId || selected.some(([, header]) => !headers.includes(header.trim())) ||
    new Set(selected.map(([, header]) => header.trim())).size !== selected.length) throw new ImportPreviewError("Invalid column mapping");
  const column = (name: keyof ImportMapping) => mapping[name] ? headers.indexOf(mapping[name]!.trim()) : -1;
  const index = {
    externalId: column("externalId"), email: column("email"), balance: column("balance"),
    marketingConsent: column("marketingConsent"), consentSource: column("consentSource"), consentDate: column("consentDate"),
  };
  const mappedColumns = new Set(Object.values(index).filter(value => value >= 0));
  const seenIds = new Set<string>();
  const seenEmails = new Set<string>();
  const rows = records.slice(1).map(record => {
    const raw = (at: number) => at < 0 ? "" : (record.fields[at] ?? "").trim();
    const errors: string[] = [];
    if (record.fields.length !== headers.length) errors.push("Column count differs from header");
    if (record.fields.some((value, position) => !mappedColumns.has(position) && value.trim() !== "")) {
      errors.push("Unmapped columns must be empty in a synthetic preview");
    }
    const rawId = raw(index.externalId).toUpperCase();
    const externalId = /^SYN-[A-Z0-9-]{3,40}$/.test(rawId) ? rawId : null;
    if (!externalId) errors.push("Synthetic ID must start with SYN- and contain 3–40 letters, numbers, or hyphens");
    const email = raw(index.email).toLowerCase();
    if (email && !/^[^\s@,]+@example\.test$/.test(email)) errors.push("Only example.test email addresses are allowed in this local synthetic preview");
    const rawBalance = raw(index.balance);
    const balance = rawBalance === "" ? null : /^\d+$/.test(rawBalance) ? Number(rawBalance) : NaN;
    if (Number.isNaN(balance) || (balance !== null && (!Number.isSafeInteger(balance) || balance > 1_000_000))) errors.push("Balance must be an integer from 0 to 1000000");
    const consent = raw(index.marketingConsent).toLowerCase();
    if (consent && !["yes", "no", "ja", "nein"].includes(consent)) errors.push("Marketing claim must be yes or no");
    let consentClaim: ImportPreviewRow["consentClaim"] = "unknown";
    const source = raw(index.consentSource).toLowerCase();
    const recorded = raw(index.consentDate);
    let consentSource: string | null = null;
    let consentDate: string | null = null;
    if (consent === "no" || consent === "nein") consentClaim = "not_granted";
    if (consent === "yes" || consent === "ja") {
      if (["paper_form", "legacy_platform", "customer_form"].includes(source) && validDate(recorded)) {
        consentClaim = "claimed_with_provenance";
        consentSource = source;
        consentDate = recorded;
      } else {
        consentClaim = "missing_provenance";
        errors.push("A claimed consent needs paper_form, legacy_platform, or customer_form as source and a valid YYYY-MM-DD record date");
      }
    }
    let duplicate = false;
    if (externalId) { if (seenIds.has(externalId)) duplicate = true; seenIds.add(externalId); }
    if (email && /^[^\s@,]+@example\.test$/.test(email)) { if (seenEmails.has(email)) duplicate = true; seenEmails.add(email); }
    const status: ImportPreviewRow["status"] = errors.length ? "invalid" : duplicate ? "duplicate" : "ready";
    return { line: record.line, externalId, emailPresent: Boolean(email), balance: Number.isNaN(balance) ? null : balance, status, consentClaim, consentSource, consentDate, errors };
  });
  return {
    headers,
    total: rows.length,
    ready: rows.filter(row => row.status === "ready").length,
    duplicates: rows.filter(row => row.status === "duplicate").length,
    invalid: rows.filter(row => row.status === "invalid").length,
    writesPerformed: false,
    rows,
  };
}
