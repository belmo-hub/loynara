import { respondError } from "@/lib/http";
import { enforcePeerLimit } from "@/lib/rate-limit";
import { findReturningCard } from "@/lib/returning-card";

// "Meine Karte öffnen" on the join page: a plain navigation that the server answers with a redirect to the card this
// browser already holds, after validating it again. Without a valid card it returns to the join page.
export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "enroll_open_peer", 120, 15 * 60);
    const slug = new URL(request.url).searchParams.get("slug") ?? "";
    const found = await findReturningCard(request, slug);
    const headers = new Headers({ "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
    if (found.state === "existing") {
      headers.set("Location", `/card/${encodeURIComponent(found.cardToken)}`);
      return new Response(null, { status: 303, headers });
    }
    headers.set("Location", found.programId ? `/join/${encodeURIComponent(slug)}` : "/");
    return new Response(null, { status: 303, headers });
  } catch (error) { return respondError(error); }
}
