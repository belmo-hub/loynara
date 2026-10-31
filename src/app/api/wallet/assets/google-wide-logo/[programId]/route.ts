import { googleLogoResponse } from "@/lib/wallet/google-logo-route";

export async function GET(_request: Request, { params }: { params: Promise<{ programId: string }> }) {
  return googleLogoResponse("wide", params);
}
