import { and, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { demoRequests } from "@/db/schema";
import { jsonBody, requireSameOrigin, respondError } from "@/lib/http";
import { DomainError } from "@/lib/loyalty";
import { enforcePeerLimit } from "@/lib/rate-limit";

const schema = z.object({
  name: z.string().trim().min(2).max(100),
  business: z.string().trim().min(2).max(120),
  email: z.email().max(320),
  city: z.string().trim().min(2).max(100),
  website: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "demo_request", 10, 24 * 60 * 60);
    const input = schema.parse(await jsonBody(request, 10_000));
    if (input.website) return Response.json({ message: "Danke! Deine Anfrage wurde gespeichert." });
    const email = input.email.toLowerCase();
    const [recent] = await db.select({ count: sql<number>`count(*)::int` }).from(demoRequests).where(and(eq(demoRequests.email, email), gte(demoRequests.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))));
    if (recent.count >= 3) throw new DomainError("RATE_LIMIT", "Bitte versuche es morgen erneut");
    await db.insert(demoRequests).values({ name: input.name, business: input.business, city: input.city, email });
    return Response.json({ message: "Danke! Deine Anfrage wurde gespeichert. Wir melden uns persönlich." }, { status: 201 });
  } catch (error) { return respondError(error); }
}
