import { respondError, sessionUser } from "@/lib/http";
import { inviteSignUpEnabled } from "@/lib/invite-signup";
import { listStaff } from "@/lib/staff";

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    // How an invited person gets an account on this deployment, so the owner is told the truth before sharing a link.
    const accountCreation = process.env.PUBLIC_REGISTRATION_ENABLED === "true" ? "public" : inviteSignUpEnabled() ? "invite" : "operator";
    return Response.json({ staff: await listStaff(user.id), accountCreation }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
