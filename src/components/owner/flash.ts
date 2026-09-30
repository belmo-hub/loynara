// A one-shot message that survives the page remount caused by a location change.
const KEY = "owner-flash";
export function setFlash(message: string) { try { sessionStorage.setItem(KEY, message); } catch { /* storage may be unavailable */ } }
export function peekFlash(): string { try { return sessionStorage.getItem(KEY) ?? ""; } catch { return ""; } }
export function clearFlash() { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }
