import { describe, expect, it } from "vitest";
import { ClientApiError } from "./client-api";
import { formatCountdown, hasNewRequest, isOpenRequest, pointsEntry, secondsLeft, secondsSince, tapErrorText, type PendingTapRequest } from "./cashier-tap-panel";

const NOW = Date.parse("2026-10-08T10:00:00.000Z");
const inSeconds = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

describe("secondsLeft", () => {
  it("counts whole seconds up to expiry and rounds partial seconds up", () => {
    expect(secondsLeft(inSeconds(300), NOW)).toBe(300);
    expect(secondsLeft(inSeconds(59.4), NOW)).toBe(60);
  });

  it("never goes negative and treats an unparseable expiry as expired", () => {
    expect(secondsLeft(inSeconds(-5), NOW)).toBe(0);
    expect(secondsLeft("not a date", NOW)).toBe(0);
  });
});

describe("isOpenRequest", () => {
  it("is open only while the expiry lies in the future", () => {
    expect(isOpenRequest({ expiresAt: inSeconds(1) }, NOW)).toBe(true);
    expect(isOpenRequest({ expiresAt: inSeconds(0) }, NOW)).toBe(false);
    expect(isOpenRequest({ expiresAt: inSeconds(-1) }, NOW)).toBe(false);
  });

  it("never shows a request with an unparseable expiry", () => {
    expect(isOpenRequest({ expiresAt: "" }, NOW)).toBe(false);
    expect(isOpenRequest({ expiresAt: "garbage" }, NOW)).toBe(false);
  });
});

describe("secondsSince", () => {
  it("returns the whole seconds since the tap", () => {
    expect(secondsSince(inSeconds(-12.9), NOW)).toBe(12);
  });

  it("clamps a tap time in the future (clock skew) to zero", () => {
    expect(secondsSince(inSeconds(3), NOW)).toBe(0);
    expect(secondsSince("nope", NOW)).toBe(0);
  });
});

describe("formatCountdown", () => {
  it("formats minutes and zero-padded seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(300)).toBe("5:00");
  });

  it("clamps negative and fractional input", () => {
    expect(formatCountdown(-3)).toBe("0:00");
    expect(formatCountdown(12.8)).toBe("0:12");
  });
});

describe("hasNewRequest", () => {
  it("is true when any id was not in the previous list", () => {
    expect(hasNewRequest(new Set(["a"]), ["a", "b"])).toBe(true);
  });

  it("is false when every id was already known or the list shrank", () => {
    expect(hasNewRequest(new Set(["a", "b"]), ["a"])).toBe(false);
    expect(hasNewRequest(new Set(["a"]), [])).toBe(false);
  });

  it("treats an empty previous list as all new", () => {
    expect(hasNewRequest(new Set(), ["a"])).toBe(true);
  });
});

describe("tapErrorText", () => {
  it("uses the German texts by default", () => {
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_EXPIRED"))).toBe("Diese Anfrage ist abgelaufen. Bitte die Kundin oder den Kunden das NFC-Schild erneut berühren lassen.");
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_COOLDOWN"))).toBe("Diese Karte hat gerade erst einen Stempel bekommen. Bitte noch nicht bestätigen.");
    expect(tapErrorText(new ClientApiError(403, "x"))).toBe("Für diesen Standort fehlt dir die Berechtigung. Bitte die Geschäftsleitung fragen.");
  });

  it("reports an already confirmed request without implying a second booking", () => {
    const text = "Schon von jemand anderem bestätigt. Es wurde nichts doppelt gebucht.";
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_ALREADY_CONFIRMED"))).toBe(text);
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_ALREADY_CONFIRMED"), "de")).toBe(text);
  });

  it("translates to French", () => {
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_ALREADY_CONFIRMED"), "fr")).toBe("Déjà confirmé par quelqu’un d’autre. Rien n’a été enregistré en double.");
    expect(tapErrorText(new ClientApiError(403, "x"), "fr")).toBe("Il manque l’autorisation pour cet établissement. Demandez-la à la direction.");
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_COOLDOWN"), "fr")).toBe("Cette carte vient de recevoir un tampon. Ne confirmez pas encore.");
  });

  it("explains a lost connection without claiming the request is gone", () => {
    expect(tapErrorText(new ClientApiError(0, "Keine Verbindung."))).toMatch(/vielleicht noch offen/);
  });

  it("hides server text in French and falls back to a generic French message", () => {
    expect(tapErrorText(new ClientApiError(500, "Serverfehler"), "fr")).toBe("L’action a échoué. Veuillez réessayer.");
    expect(tapErrorText(new Error("boom"), "fr")).toBe("L’action a échoué. Veuillez réessayer.");
    expect(tapErrorText("odd")).toBe("Das hat nicht geklappt. Bitte versuche es erneut.");
  });
});

describe("server timing re-anchored to the phone clock", () => {
  it("uses the server's remaining and elapsed time, whatever the phone's clock says", async () => {
    const { anchorToLocalClock } = await import("./cashier-tap-panel");
    const skewedPhoneNow = Date.parse("2030-01-01T00:00:00Z");
    const item = { id: "r1", createdAt: "2026-10-08T10:00:00Z", expiresAt: "2026-10-08T10:05:00Z", balance: 2, cardLocator: "K-7QX2MA", expiresInMs: 120_000, ageMs: 180_000 };
    const anchored = anchorToLocalClock(item, skewedPhoneNow);
    expect(Date.parse(anchored.expiresAt) - skewedPhoneNow).toBe(120_000);
    expect(skewedPhoneNow - Date.parse(anchored.createdAt)).toBe(180_000);
    const legacy = { id: "r2", createdAt: "a", expiresAt: "b", balance: 0, cardLocator: "K-AAAAAA" };
    expect(anchorToLocalClock(legacy, skewedPhoneNow)).toBe(legacy);
  });
});

describe("points entry on an NFC request", () => {
  const base: PendingTapRequest = { id: "r", createdAt: "", expiresAt: "", balance: 0, cardLocator: "K-7QX2MA", programType: "points", pointsPerCurrencyUnit: 2, currency: "EUR", ruleVersionId: "rule-1" };
  it("reads a purchase amount the way the counter does and previews the points", () => {
    const purchase = { ...base, earningMode: "purchase" as const };
    expect(pointsEntry(purchase, "16,70")).toEqual({ award: { purchaseAmountMinor: 1670, ruleVersionId: "rule-1" }, points: 33 });
    expect(pointsEntry(purchase, "5")).toEqual({ award: { purchaseAmountMinor: 500, ruleVersionId: "rule-1" }, points: 10 });
    for (const raw of ["", "0", "-3", "1,234", "abc", "0,49"]) expect(pointsEntry(purchase, raw)).toBeNull();   // 0,49 € earns no point at 2/€
  });
  it("takes whole points for a manual programme", () => {
    const manual = { ...base, earningMode: "manual" as const };
    expect(pointsEntry(manual, " 7 ")).toEqual({ award: { quantity: 7 }, points: 7 });
    for (const raw of ["", "0", "2,5", "-1", "07"]) expect(pointsEntry(manual, raw)).toBeNull();
  });
});

describe("tapErrorText for points", () => {
  it("explains limits, a changed rule and a second, different entry in German", () => {
    expect(tapErrorText(new ClientApiError(422, "x", "LIMIT_EXCEEDED"))).toBe("Kaufbetrag oder Punkte überschreiten das Limit dieser Rolle. Bitte die Inhaberin oder den Inhaber zur Prüfung hinzuziehen.");
    expect(tapErrorText(new ClientApiError(409, "x", "STALE_RULE"))).toBe("Die Punkteregel hat sich geändert. Bitte den Betrag erneut prüfen.");
    expect(tapErrorText(new ClientApiError(409, "x", "KEY_REUSED"))).toBe("Schon mit einer anderen Eingabe bestätigt. Es wurde nichts doppelt gebucht.");
    expect(tapErrorText(new ClientApiError(409, "x", "TAP_COOLDOWN"), "de", true)).toBe("Auf dieser Karte wurden gerade erst Punkte gebucht. Bitte noch nicht bestätigen.");
  });
});
