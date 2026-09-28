import { z } from "zod";
import { cancelCampaign, createDraftCampaign, editDraftCampaign, listCampaigns, pauseCampaign, scheduleCampaign } from "@/lib/campaigns";
import { audienceDefinitionSchema } from "@/lib/segments";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";
import { enforcePeerLimit, enforceRateLimit } from "@/lib/rate-limit";
import { promotionalEmailMode } from "@/lib/transactional-email";

const content = { title: z.string().trim().min(2).max(180), subject: z.string().trim().min(2).max(120), body: z.string().trim().min(5).max(3000), audienceDefinition: audienceDefinitionSchema };
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), programSlug: z.string().min(1).max(120), ...content }).strict(),
  z.object({ action: z.literal("edit"), campaignId: z.uuid(), ...content }).strict(),
  z.object({ action: z.literal("schedule"), campaignId: z.uuid(), scheduledAt: z.iso.datetime() }).strict(),
  z.object({ action: z.literal("pause"), campaignId: z.uuid() }).strict(),
  z.object({ action: z.literal("cancel"), campaignId: z.uuid() }).strict(),
]);
const noStore = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export async function GET(request: Request) {
  try {
    await enforcePeerLimit(request, "merchant_campaign_list_peer", 120, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_campaign_list_user", identity: user.id, max: 60, windowSeconds: 15 * 60 });
    const programSlug = new URL(request.url).searchParams.get("programSlug");
    if (!programSlug) return Response.json({ error: "Missing programme" }, { status: 400 });
    return Response.json({ campaigns: await listCampaigns({ actorUserId: user.id, programSlug }), deliveryMode: promotionalEmailMode() }, { headers: noStore });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    await enforcePeerLimit(request, "merchant_campaign_mutation_peer", 60, 15 * 60);
    const user = await sessionUser(request);
    await enforceRateLimit({ scope: "merchant_campaign_mutation_user", identity: user.id, max: 30, windowSeconds: 15 * 60 });
    const input = action.parse(await jsonBody(request, 6000));
    if (input.action === "create") {
      const { programSlug, title, subject, body, audienceDefinition } = input;
      return Response.json({ campaign: await createDraftCampaign({ actorUserId: user.id, programSlug, title, subject, body, audienceDefinition }) }, { status: 201, headers: noStore });
    }
    if (input.action === "edit") {
      const { campaignId, title, subject, body, audienceDefinition } = input;
      return Response.json({ campaign: await editDraftCampaign({ actorUserId: user.id, campaignId, title, subject, body, audienceDefinition }) }, { headers: noStore });
    }
    if (input.action === "schedule") return Response.json(await scheduleCampaign({ actorUserId: user.id, campaignId: input.campaignId, scheduledAt: new Date(input.scheduledAt) }), { headers: noStore });
    if (input.action === "pause") return Response.json(await pauseCampaign({ actorUserId: user.id, campaignId: input.campaignId }), { headers: noStore });
    return Response.json(await cancelCampaign({ actorUserId: user.id, campaignId: input.campaignId }), { headers: noStore });
  } catch (error) { return respondError(error); }
}
