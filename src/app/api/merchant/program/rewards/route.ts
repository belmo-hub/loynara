import { z } from "zod";
import { archiveReward, createReward, editReward, getMerchantRewards, reorderRewards } from "@/lib/product";
import { jsonBody, requireSameOrigin, respondError, sessionUser } from "@/lib/http";

const common = { programSlug: z.string().min(1).max(120) };
const fields = { title: z.string().trim().min(2).max(180), cost: z.number().int().min(1).max(100000), termsText: z.string().trim().max(3000).default("") };
const action = z.discriminatedUnion("action", [
  z.object({ ...common, action: z.literal("create"), ...fields }).strict(),
  z.object({ ...common, action: z.literal("edit"), rewardId: z.uuid(), ...fields }).strict(),
  z.object({ ...common, action: z.literal("reorder"), rewardIds: z.array(z.uuid()).min(1).max(100) }).strict(),
  z.object({ ...common, action: z.literal("archive"), rewardId: z.uuid() }).strict(),
]);

export async function GET(request: Request) {
  try {
    const user = await sessionUser(request);
    const programSlug = new URL(request.url).searchParams.get("programSlug");
    if (!programSlug || programSlug.length > 120) return Response.json({ error: "Invalid programme" }, { status: 400 });
    return Response.json({ rewards: await getMerchantRewards({ actorUserId: user.id, programSlug }) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}

export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const user = await sessionUser(request);
    const input = action.parse(await jsonBody(request, 5000));
    if (input.action === "create") return Response.json(await createReward({ ...input, actorUserId: user.id }), { status: 201, headers: { "Cache-Control": "no-store" } });
    if (input.action === "edit") return Response.json(await editReward({ ...input, actorUserId: user.id }), { headers: { "Cache-Control": "no-store" } });
    if (input.action === "reorder") return Response.json(await reorderRewards({ ...input, actorUserId: user.id }), { headers: { "Cache-Control": "no-store" } });
    return Response.json(await archiveReward({ ...input, actorUserId: user.id }), { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return respondError(error); }
}
