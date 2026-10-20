import { prepareCustomerPersonalExport } from "./customer-personal-export";
import { respondError } from "./http";
export const personalExportHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export function personalExportError(error: unknown) {
  const response = respondError(error);
  for (const [key, value] of Object.entries(personalExportHeaders)) response.headers.set(key, value);
  return response;
}
export async function personalExportResponse(input: { cardToken?: string; proof?: string }, request: Request) {
  const staged = await prepareCustomerPersonalExport(input, request.signal);
  try {
    return new Response(staged.stream, { headers: { ...personalExportHeaders, "Content-Type": "application/json; charset=utf-8", "Content-Length": String(staged.size), "Content-Disposition": 'attachment; filename="loynara-personal-data.json"' } });
  } catch (error) { await staged.dispose(); throw error; }
}
