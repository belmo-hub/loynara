import { googleLogoResponse } from "@/lib/wallet/google-logo-route";

export async function GET(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  return googleLogoResponse(request, "square", params);
}
