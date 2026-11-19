import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { emailSuppressions } from "@/db/schema";
import { enforceRateLimit, RateLimitError } from "./rate-limit";
import { recipientHashes, transactionalProvider } from "./transactional-email";

// Per address, whoever asks: sign-up and the resend button together send at most three links an hour and five a day.
const perAddress = [{ scope: "auth_verify_email", max: 3, windowSeconds: 60 * 60 }, { scope: "auth_verify_email_day", max: 5, windowSeconds: 24 * 60 * 60 }];

/**
 * ENG-278: the link that confirms an account's address, in fixed words. Nothing the person typed (their name, a shop
 * name) goes into the mail, and the link itself is built here from the token, so no request can choose where it leads.
 */
export async function sendAccountVerification(email: string, token: string): Promise<"sent" | "limited" | "unavailable"> {
  try { for (const limit of perAddress) await enforceRateLimit({ ...limit, identity: email.toLowerCase() }); }
  catch (error) { if (error instanceof RateLimitError) return "limited"; throw error; }
  const provider = transactionalProvider();
  if (!provider) return "unavailable";
  // Not reserved in email_deliveries, which keys on a shop's outbox job: an account has no shop yet. Suppressions hold.
  const [suppressed] = await db.select().from(emailSuppressions).where(inArray(emailSuppressions.recipientHash, recipientHashes(email)));
  if (suppressed && suppressed.reason !== "unsubscribed") return "unavailable";
  const link = new URL("/api/auth/verify-email", process.env.BETTER_AUTH_URL ?? "http://localhost:3000");
  link.searchParams.set("token", token);
  link.searchParams.set("callbackURL", "/merchant");
  const result = await provider.send({
    to: email,
    jobId: randomUUID(),
    subject: "Bestätige deine E-Mail-Adresse für Loynara",
    body: `Hallo,\n\nbitte bestätige, dass diese E-Mail-Adresse zu deinem Loynara-Konto gehört:\n${link.toString()}\n\nDer Link gilt eine Stunde. Erst nach der Bestätigung schicken wir dir E-Mails zu deinem Geschäft, zum Beispiel den Wochenbericht.\n\nHast du kein Konto bei Loynara angelegt? Dann ignorier diese E-Mail einfach. Ohne Klick passiert nichts.\n\nBei Fragen schreib an support@getloynara.com.`,
  });
  return result.state === "accepted" || result.state === "delivered" ? "sent" : "unavailable";
}
