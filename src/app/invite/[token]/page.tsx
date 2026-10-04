import { InviteClient } from "@/components/invite-client";
import { inviteSignUpEnabled, pendingInvite } from "@/lib/invite-signup";

// Read per request: the "Konto erstellen" link follows the live registration flag (it is off in production).
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const registrationOpen = process.env.PUBLIC_REGISTRATION_ENABLED === "true";
  // With invite sign-up on, the token holder sees who invited them and creates the account for the invited address.
  const invite = !registrationOpen && inviteSignUpEnabled() ? await pendingInvite(token) : null;
  return <InviteClient token={token} registrationOpen={registrationOpen} invite={invite ? { email: invite.email, role: invite.role, businessName: invite.businessName, locationName: invite.locationName } : undefined} />;
}
