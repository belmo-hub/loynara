export type CustomerExportFailure = "invalid-card" | "rate-limit" | "unavailable" | "incomplete";
export class CustomerExportError extends Error {
  constructor(public readonly kind: CustomerExportFailure) { super("Customer export unavailable"); }
}

/** Never turn an HTTP error or an unreadable body into a customer export file. */
export async function readCustomerExport(url: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  try { response = await fetch(url, { credentials: "same-origin", cache: "no-store", signal }); }
  catch { throw new CustomerExportError("incomplete"); }
  if (!response.ok) throw new CustomerExportError(response.status === 404 ? "invalid-card" : response.status === 429 ? "rate-limit" : "unavailable");
  try {
    const blob = await response.blob();
    const data = JSON.parse(await blob.text());
    // This is the existing customer format, not the merchant export or an error
    // response. Retain the original bytes rather than reserializing private data.
    if (data?.formatVersion !== 1 || data.scope !== "pseudonymous-card-activity-without-contact-records" ||
        typeof data.membership?.id !== "string" || !Array.isArray(data.ledger) ||
        !Array.isArray(data.redemptions) || !Array.isArray(data.consentEvents)) throw new Error("Invalid export response");
    return blob;
  } catch { throw new CustomerExportError("incomplete"); }
}
