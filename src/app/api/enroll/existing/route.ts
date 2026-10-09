import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { findReturningCard } from "@/lib/returning-card";

// Does this browser already hold a valid card for the programme? Answers with the card number only, never the card
// token; opening the card goes through /api/enroll/open. A stale remembered card is forgotten on the way.
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "enroll_existing_peer", 240, 15 * 60);
    const slug = new URL(request.url).searchParams.get("slug") ?? "";
    const found = await findReturningCard(request, slug);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    return Response.json(found.state === "existing" ? { existing: true, cardLocator: found.cardLocator } : { existing: false, stale: found.state === "stale" }, { headers });
  } catch (error) { return respondError(error); }
}
