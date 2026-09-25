import { respondError, sessionUser } from "@/lib/http";
import { listStaff } from "@/lib/staff";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    return Response.json({ staff: await listStaff(user.id) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
