import { z } from "zod";
import { acknowledgeInactivity, merchantInactivity } from "@/lib/inactivity";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
export async function GET(request: Request) {
  try { const user=await sessionUser(request); return Response.json({ reviews: await merchantInactivity(user.id) },{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return respondError(error); }
}
export async function POST(request: Request) {
  try { requireSameOrigin(request); const user=await sessionUser(request); const {membershipId}=z.object({membershipId:z.uuid()}).strict().parse(await jsonBody(request,1024));
    return Response.json(await acknowledgeInactivity(user.id,membershipId),{headers:{"Cache-Control":"no-store"}}); }
  catch(error) { return respondError(error); }
}
