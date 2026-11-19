import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";
import { enforceRateLimit, RateLimitError } from "./rate-limit";
import { recipientHashes, transactionalProvider } from "./transactional-email";

/**
 * ENG-278/ENG-279: mail about the account itself, in fixed words. Nothing the person typed (their name, a shop name) goes
 * into it, and each link is built here from the token, so no request can choose where it leads. Per address and kind,
 * whoever asks, at most three mails an hour and five a day.
 */
async function sendAccountMail(scope: string, email: string, subject: string, body: string): Promise<"sent" | "limited" | "unavailable"> {
  const limits = [{ scope, max: 3, windowSeconds: 60 * 60 }, { scope: `${scope}_day`, max: 5, windowSeconds: 24 * 60 * 60 }];
  try { for (const limit of limits) await enforceRateLimit({ ...limit, identity: email.toLowerCase() }); }
  catch (error) { if (error instanceof RateLimitError) return "limited"; throw error; }
  const provider = transactionalProvider();
  if (!provider) return "unavailable";
  // Not reserved in email_deliveries, which keys on a shop's outbox job: an account has no shop yet. Suppressions hold.
  const [suppressed] = await db.select().from(emailSuppressions).where(inArray(emailSuppressions.recipientHash, recipientHashes(email)));
  if (suppressed && suppressed.reason !== "unsubscribed") return "unavailable";
  const result = await provider.send({ to: email, jobId: randomUUID(), subject, body });
  return result.state === "accepted" || result.state === "delivered" ? "sent" : "unavailable";
}

const appLink = (path: string, query: Record<string, string>) => {
  const link = new URL(path, process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  for (const [key, value] of Object.entries(query)) link.searchParams.set(key, value);
  return link.toString();
};

export function sendAccountVerification(email: string, token: string) {
  return sendAccountMail("auth_verify_email", email, "Bestätige deine E-Mail-Adresse für Loynara",
    `Hallo,\n\nbitte bestätige, dass diese E-Mail-Adresse zu deinem Loynara-Konto gehört:\n${appLink("/api/auth/verify-email", { token, callbackURL: "/merchant" })}\n\nDer Link gilt eine Stunde. Erst nach der Bestätigung schicken wir dir E-Mails zu deinem Geschäft, zum Beispiel den Wochenbericht.\n\nHast du kein Konto bei Loynara angelegt? Dann ignorier diese E-Mail einfach. Ohne Klick passiert nichts.\n\nBei Fragen schreib an support@getloynara.com.`);
}

export function sendPasswordReset(email: string, token: string) {
  return sendAccountMail("auth_reset_email", email, "Neues Passwort für Loynara",
    `Hallo,\n\nfür dein Loynara-Konto wurde ein neues Passwort angefordert. Hier legst du es fest:\n${appLink("/reset-password", { token })}\n\nDer Link gilt eine Stunde und funktioniert nur einmal. Danach bist du auf allen Geräten abgemeldet und meldest dich mit dem neuen Passwort an.\n\nHast du das nicht angefordert? Dann ignorier diese E-Mail einfach. Dein Passwort bleibt, wie es ist.\n\nBei Fragen schreib an support@getloynara.com.`);
}
