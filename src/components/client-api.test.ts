import { afterEach, expect, it, vi } from "vitest";
import { apiJson, ClientApiError, failureText, imageToDataUrl, LOGO_INVALID } from "./client-api";

afterEach(() => vi.unstubAllGlobals());

it("shows a German retry message for a rate-limited read without losing its status or code", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Too many requests. Please try again later.", code: "RATE_LIMIT" }, { status: 429 })));
  const error = await apiJson("/api/merchant/locations").catch(error => error);
  expect(error).toBeInstanceOf(ClientApiError);
  expect(error).toMatchObject({ status: 429, code: "RATE_LIMIT", message: "Zu viele Anfragen. Bitte warte kurz und versuche es erneut." });
});

it("preserves the server's useful explanation for other errors", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ message: "Keine aktive Karte gefunden.", code: "NOT_FOUND" }, { status: 404 })));
  await expect(apiJson("/api/cashier/lookup")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND", message: "Keine aktive Karte gefunden." });
});

it("never shows the server's English diagnostics (ENG-135)", async () => {
  const reply = (error: string, status: number, code?: string) => vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error, code }, { status })));
  reply("Program not found", 404, "NOT_FOUND");
  await expect(apiJson("/api/program/x")).rejects.toMatchObject({ status: 404, message: "Das haben wir nicht gefunden. Bitte lade die Seite neu." });
  reply("Invalid input", 400);
  await expect(apiJson("/api/x")).rejects.toMatchObject({ message: "Das hat nicht geklappt. Prüfe deine Eingaben und versuche es noch einmal." });
  reply("Internal error", 500);
  await expect(apiJson("/api/x")).rejects.toMatchObject({ message: "Gerade hat etwas nicht geklappt. Bitte versuche es gleich noch einmal." });
  reply("Logo format does not match its contents", 400, "INVALID_LOGO");
  await expect(apiJson("/api/x")).rejects.toMatchObject({ code: "INVALID_LOGO", message: LOGO_INVALID });
  reply("Invitation already accepted", 409, "INVITE_USED");
  await expect(apiJson("/api/staff/accept")).rejects.toMatchObject({ message: "Diese Einladung wurde schon angenommen." });
  reply("Sign in required", 401, "UNAUTHENTICATED");
  await expect(apiJson("/api/merchant/locations")).rejects.toMatchObject({ message: "Deine Anmeldung ist abgelaufen. Bitte melde dich erneut an." });
  await expect(apiJson("/api/card/x")).rejects.toMatchObject({ message: "Bitte öffne deine Karte noch einmal über deinen Kartenlink." });
  // A code whose server text is German copy keeps it.
  reply("Für diese Prämie wartet schon eine Änderung auf ihr Datum. Nimm sie zuerst zurück.", 409, "CHANGE_PENDING");
  await expect(apiJson("/api/x")).rejects.toMatchObject({ message: "Für diese Prämie wartet schon eine Änderung auf ihr Datum. Nimm sie zuerst zurück." });
});

it("refuses a logo the server would refuse when it is picked", async () => {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  await expect(imageToDataUrl(new File([new Uint8Array(2_050_000).fill(0).map((_, i) => png[i] ?? 0)], "logo.png", { type: "image/png" })))
    .rejects.toThrow("Dein Logo ist größer als 2 MB. Wähle eine kleinere Datei.");
  // A JPEG renamed to .png: the browser claims image/png from the name.
  await expect(imageToDataUrl(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0])], "logo.png", { type: "image/png" }))).rejects.toThrow(LOGO_INVALID);
  await expect(imageToDataUrl(new File(["GIF89a"], "logo.gif", { type: "image/gif" }))).rejects.toThrow(LOGO_INVALID);
});

it("keeps the server's German words for the codes that only send German", () => {
  // A locked NFC plate, a mistyped plate code, quiet hours, the pilot's NFC rule and a half-finished setup say what to do.
  for (const code of ["INVALID_ACTIVATION", "INVALID_CODE_FORMAT", "QUIET_HOURS", "TAP_AUTOMATIC_NOT_ALLOWED", "SETUP_INCOMPLETE", "END_DATE_TOO_EARLY", "MESSAGE_REFUSED"])
    expect(failureText(400, code, `Deutscher Text für ${code}.`)).toBe(`Deutscher Text für ${code}.`);
  expect(failureText(400, "INVALID_CSV", "CSV has no header row")).toBe("Das hat nicht geklappt. Prüfe deine Eingaben und versuche es noch einmal.");
});
