import { InviteClient } from "@/components/invite-client";

// Read per request: the "Konto erstellen" link follows the live registration flag (it is off in production).
export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <InviteClient token={token} registrationOpen={process.env.PUBLIC_REGISTRATION_ENABLED === "true"} />;
}
