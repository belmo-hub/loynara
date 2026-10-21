/** The plate QR encodes https://…/p/<label>; a typed label (any case) works too. Null when it is neither. */
export function plateLabelFromScan(text: string): string | null {
  let candidate = text.trim();
  try { const match = /^\/p\/([^/?#]+)/.exec(new URL(candidate).pathname); if (match) candidate = decodeURIComponent(match[1]); } catch { /* not a URL: a typed label */ }
  candidate = candidate.toUpperCase();
  return /^[A-Z]{1,4}-[0-9]{1,6}$/.test(candidate) ? candidate : null;
}
