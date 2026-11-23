// Passkey labels and outcomes (Design, #349 round 2, 23 Nov). Pure, so the client and the server share them.

/** Where a passkey is kept, from its authenticator's AAGUID (the FIDO list of passkey providers). */
const PROVIDERS: Record<string, string> = {
  "fbfc3007-154e-4ecc-8c0b-6e020557d7bd": "iCloud-Schlüsselbund",
  "dd4ec289-e01d-41c9-bb89-70fa845d4bf2": "iCloud-Schlüsselbund",
  "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4": "Google Passwortmanager",
  "53414d53-554e-4700-0000-000000000000": "Samsung Pass",
  "bada5566-a7aa-401f-bd96-45619a55120d": "1Password",
  "d548826e-79b4-db40-a3d8-11116f7e8349": "Bitwarden",
  "531126d6-e717-415c-9320-3d9aa6981239": "Dashlane",
  "08987058-cadc-4b81-b6e1-30de50dcbe96": "Windows Hello",
  "9ddd1817-af5a-4672-a2b9-3e3dd95000a9": "Windows Hello",
  "6028b017-b1d4-4c02-b4b3-afcdafc96bb2": "Windows Hello",
  "adce0002-35bc-c60a-648b-0b25f1f05503": "Chrome auf dem Mac",
};

/** The device from a user agent, for a passkey whose provider is unknown. */
export function deviceName(userAgent = "") {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? "Android-Handy" : "Android-Tablet";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "Windows-PC";
  return "Passkey";
}

/** The label stored when a passkey is added: its provider when known, otherwise the device it was added on. */
export const passkeyName = (aaguid: string | undefined, userAgent: string | undefined) => (aaguid && PROVIDERS[aaguid.toLowerCase()]) || deviceName(userAgent);

type WebAuthnFailure = { code?: string; message?: string; cause?: { name?: string } | null };
/**
 * True when the person closed or let lapse the system prompt (Face ID, fingerprint, PIN): that is a choice, said nothing
 * about. Browsers report it as NotAllowedError, which the WebAuthn library passes on as ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY
 * (the passkey client keeps the code and the message, not the cause), or as an aborted ceremony.
 */
export function passkeyCancelled(error: WebAuthnFailure | null | undefined) {
  if (!error) return false;
  if (error.cause?.name === "NotAllowedError" || error.cause?.name === "AbortError") return true;
  if (["ERROR_CEREMONY_ABORTED", "AUTH_CANCELLED", "REGISTRATION_CANCELLED"].includes(error.code ?? "")) return true;
  // A passthrough is a cancel unless its message names a real fault (wrong origin or RP, unsupported, insecure).
  return error.code === "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY" && !/security|origin|rp ?id|not supported|invalid ?state/i.test(error.message ?? "");
}
